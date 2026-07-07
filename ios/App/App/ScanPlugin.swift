import Foundation
import UIKit
import Capacitor
import Vision
import VisionKit
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Native scan pipeline: VisionKit document camera (edge detect, deskew,
/// multi-page) → Vision text recognition (fully offline) → optional
/// Foundation-Models structured extraction (iOS 26+, Apple Intelligence).
///
/// Returns raw OCR pages plus the optional `fmFlights` / `fmDocument`
/// extraction; the web layer (src/lib/scan.ts) merges both into per-field
/// confidence candidates and ALWAYS routes them through a confirm sheet —
/// scanned entries are never auto-saved.
@objc(ScanPlugin)
public class ScanPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate {
    public let identifier = "ScanPlugin"
    public let jsName = "Scan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]

    private var savedCall: CAPPluginCall?

    // MARK: - availability

    @objc func availability(_ call: CAPPluginCall) {
        var appleIntelligence = false
        // A human-readable reason the on-device model is/ isn't usable, so the
        // confirm sheet can tell the pilot how to turn it on instead of
        // silently falling back to basic OCR.
        var aiReason = "unavailable"
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                appleIntelligence = true
                aiReason = "available"
            case .unavailable(.deviceNotEligible):
                aiReason = "device-not-eligible"
            case .unavailable(.appleIntelligenceNotEnabled):
                aiReason = "not-enabled"
            case .unavailable(.modelNotReady):
                aiReason = "model-downloading"
            case .unavailable:
                aiReason = "unavailable"
            }
        } else {
            aiReason = "os-too-old"
        }
        #else
        aiReason = "framework-missing"
        #endif
        call.resolve([
            "docCamera": VNDocumentCameraViewController.isSupported,
            "appleIntelligence": appleIntelligence,
            "aiReason": aiReason
        ])
    }

    // MARK: - scan

    @objc func scan(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("Document scanning is not supported on this device.")
            return
        }
        guard savedCall == nil else {
            call.reject("A scan is already in progress.")
            return
        }
        savedCall = call
        call.keepAlive = true
        DispatchQueue.main.async {
            let camera = VNDocumentCameraViewController()
            camera.delegate = self
            self.bridge?.viewController?.present(camera, animated: true)
        }
    }

    // MARK: - VNDocumentCameraViewControllerDelegate

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        takeCall()?.reject("cancelled")
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController,
                                             didFailWithError error: Error) {
        controller.dismiss(animated: true)
        takeCall()?.reject("Scan failed: \(error.localizedDescription)")
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController,
                                             didFinishWith scan: VNDocumentCameraScan) {
        controller.dismiss(animated: true)
        guard let call = takeCall() else { return }
        let images = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
        let extract = call.getString("extract") ?? "flights"

        DispatchQueue.global(qos: .userInitiated).async {
            let (pages, fullText) = Self.recognizeText(in: images)
            let result: [String: Any] = ["pages": pages]
            self.resolveWithExtraction(call: call, result: result, text: fullText, extract: extract)
        }
    }

    private func takeCall() -> CAPPluginCall? {
        let call = savedCall
        savedCall = nil
        return call
    }

    // MARK: - Vision OCR (offline)

    private static func recognizeText(in images: [UIImage]) -> ([[String: Any]], String) {
        var pages: [[String: Any]] = []
        var fullText = ""
        for image in images {
            guard let cgImage = image.cgImage else { continue }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.recognitionLanguages = ["en-CA", "en-US"]
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            try? handler.perform([request])

            var lines: [[String: Any]] = []
            var pageText = ""
            for observation in request.results ?? [] {
                guard let candidate = observation.topCandidates(1).first else { continue }
                lines.append(["text": candidate.string, "confidence": candidate.confidence])
                pageText += candidate.string + "\n"
            }
            pages.append(["text": pageText, "lines": lines])
            fullText += pageText + "\n"
        }
        return (pages, fullText)
    }

    // MARK: - Foundation Models structured extraction (iOS 26+, on-device)

    private func resolveWithExtraction(call: CAPPluginCall, result: [String: Any],
                                       text: String, extract: String) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *),
           case .available = SystemLanguageModel.default.availability,
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Task {
                var enriched = result
                do {
                    if extract == "document" {
                        let doc = try await FMExtractor.document(from: text)
                        enriched["fmDocument"] = doc.asDictionary
                    } else {
                        let flights = try await FMExtractor.flights(from: text)
                        enriched["fmFlights"] = flights.map { $0.asDictionary }
                    }
                } catch {
                    // Model refused / context overflow / etc. — the OCR pages
                    // alone are still a full result for the heuristic parser.
                }
                call.resolve(enriched)
            }
            return
        }
        #endif
        call.resolve(result)
    }
}

#if canImport(FoundationModels)

@available(iOS 26.0, *)
@Generable
struct FMScanFlight {
    @Guide(description: "Flight date in YYYY-MM-DD format")
    var date: String?
    @Guide(description: "Aircraft type designator, e.g. C172 or DHC-8")
    var aircraftType: String?
    @Guide(description: "Aircraft registration / tail number, e.g. C-GABC")
    var registration: String?
    @Guide(description: "Pilot role for this flight: Captain, First Officer, Dual, Student, Dual Given or Dual Received")
    var loggedRole: String?
    @Guide(description: "Departure airport ICAO code, e.g. CYYZ")
    var from: String?
    @Guide(description: "Arrival airport ICAO code, e.g. CYOW")
    var to: String?
    @Guide(description: "Single-engine hours as a decimal, e.g. 1.5")
    var se: Double?
    @Guide(description: "Multi-engine hours as a decimal")
    var me: Double?
    @Guide(description: "Cross-country hours as a decimal")
    var xc: Double?
    @Guide(description: "Day flying hours as a decimal")
    var dayHours: Double?
    @Guide(description: "Night flying hours as a decimal")
    var nightHours: Double?
    @Guide(description: "Actual instrument (IFR) hours as a decimal")
    var ifrActual: Double?
    @Guide(description: "Simulated instrument / hood hours as a decimal")
    var ifrSim: Double?
    @Guide(description: "Remarks or notes for the flight")
    var notes: String?
    @Guide(description: "Name of the pilot-in-command, if written")
    var pic: String?
    @Guide(description: "Name of the second-in-command / student, if written")
    var sic: String?

    var asDictionary: [String: Any] {
        var d: [String: Any] = [:]
        if let v = date { d["date"] = v }
        if let v = aircraftType { d["aircraftType"] = v }
        if let v = registration { d["registration"] = v }
        if let v = loggedRole { d["loggedRole"] = v }
        if let v = from { d["from"] = v }
        if let v = to { d["to"] = v }
        if let v = se { d["se"] = v }
        if let v = me { d["me"] = v }
        if let v = xc { d["xc"] = v }
        if let v = dayHours { d["dayHours"] = v }
        if let v = nightHours { d["nightHours"] = v }
        if let v = ifrActual { d["ifrActual"] = v }
        if let v = ifrSim { d["ifrSim"] = v }
        if let v = notes { d["notes"] = v }
        if let v = pic { d["pic"] = v }
        if let v = sic { d["sic"] = v }
        return d
    }
}

@available(iOS 26.0, *)
@Generable
struct FMScanFlightList {
    @Guide(description: "Every flight row found in the logbook page text")
    var flights: [FMScanFlight]
}

@available(iOS 26.0, *)
@Generable
struct FMScanDocument {
    @Guide(description: "Document type, e.g. Private Pilot Licence (PPL), Category 1 Medical, Instrument Rating")
    var type: String?
    @Guide(description: "Licence / permit / certificate number")
    var number: String?
    @Guide(description: "Issue date in YYYY-MM-DD format")
    var issueDate: String?
    @Guide(description: "Medical examination date in YYYY-MM-DD format, if this is a medical certificate")
    var examDate: String?
    @Guide(description: "Expiry date in YYYY-MM-DD format")
    var expiryDate: String?

    var asDictionary: [String: Any] {
        var d: [String: Any] = [:]
        if let v = type { d["type"] = v }
        if let v = number { d["number"] = v }
        if let v = issueDate { d["issueDate"] = v }
        if let v = examDate { d["examDate"] = v }
        if let v = expiryDate { d["expiryDate"] = v }
        return d
    }
}

@available(iOS 26.0, *)
enum FMExtractor {
    static func flights(from text: String) async throws -> [FMScanFlight] {
        let session = LanguageModelSession(instructions: """
            You extract flight rows from OCR text of a pilot logbook or aircraft \
            journey log page. Extract only what is written — never invent values. \
            Dates become YYYY-MM-DD. Hour columns are decimals. Leave a field nil \
            when the page does not clearly show it.
            """)
        let response = try await session.respond(to: text, generating: FMScanFlightList.self)
        return response.content.flights
    }

    static func document(from text: String) async throws -> FMScanDocument {
        let session = LanguageModelSession(instructions: """
            You extract the key fields from OCR text of an aviation document \
            (pilot licence, medical certificate, rating or training certificate). \
            Extract only what is written — never invent values. Dates become \
            YYYY-MM-DD. Leave a field nil when the document does not clearly show it.
            """)
        let response = try await session.respond(to: text, generating: FMScanDocument.self)
        return response.content
    }
}

#endif
