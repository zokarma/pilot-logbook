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
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanImage", returnType: CAPPluginReturnPromise)
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

    // MARK: - scanImage (uploaded photo / document, no camera)

    /// Runs the same OCR + Foundation-Models pipeline as `scan`, but on images
    /// the pilot picked from the photo library or Files instead of the camera.
    /// `images` is an array of base64 strings (data-URL prefix tolerated); each
    /// may be a photo or a PDF (rendered page-by-page).
    @objc func scanImage(_ call: CAPPluginCall) {
        let extract = call.getString("extract") ?? "flights"
        var base64List = call.getArray("images", String.self) ?? []
        if base64List.isEmpty, let one = call.getString("image") { base64List = [one] }
        guard !base64List.isEmpty else {
            call.reject("No image provided.")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            var images: [UIImage] = []
            for b64 in base64List {
                // Tolerate a "data:...;base64," prefix.
                let payload: String
                if let comma = b64.range(of: ",") { payload = String(b64[comma.upperBound...]) } else { payload = b64 }
                guard let data = Data(base64Encoded: payload) else { continue }
                if let pdfPages = Self.imagesFromPDF(data) {
                    images.append(contentsOf: pdfPages)
                } else if let img = UIImage(data: data) {
                    // Photos carry EXIF rotation; Vision reads the raw bitmap and
                    // ignores it, so bake the orientation in before OCR.
                    images.append(Self.upright(img))
                }
            }
            guard !images.isEmpty else {
                call.reject("Could not read that file as an image or PDF.")
                return
            }
            let (pages, fullText) = Self.recognizeText(in: images)
            let result: [String: Any] = ["pages": pages]
            self.resolveWithExtraction(call: call, result: result, text: fullText, extract: extract)
        }
    }

    /// Redraws an image with its EXIF orientation baked into the pixels, so
    /// Vision (which reads the raw CGImage) sees upright text.
    private static func upright(_ image: UIImage) -> UIImage {
        if image.imageOrientation == .up { return image }
        let renderer = UIGraphicsImageRenderer(size: image.size)
        return renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: image.size)) }
    }

    /// Renders each page of a PDF to a UIImage for OCR. Returns nil if the data
    /// isn't a valid PDF (so the caller falls back to decoding it as an image).
    private static func imagesFromPDF(_ data: Data) -> [UIImage]? {
        guard let provider = CGDataProvider(data: data as CFData),
              let pdf = CGPDFDocument(provider), pdf.numberOfPages > 0 else { return nil }
        let scale: CGFloat = 2.0 // upscale for sharper OCR on small text
        var out: [UIImage] = []
        for i in 1...pdf.numberOfPages {
            guard let page = pdf.page(at: i) else { continue }
            let box = page.getBoxRect(.mediaBox)
            let size = CGSize(width: box.width * scale, height: box.height * scale)
            let renderer = UIGraphicsImageRenderer(size: size)
            out.append(renderer.image { ctx in
                UIColor.white.set()
                ctx.fill(CGRect(origin: .zero, size: size))
                ctx.cgContext.translateBy(x: 0, y: size.height)
                ctx.cgContext.scaleBy(x: scale, y: -scale)
                ctx.cgContext.drawPDFPage(page)
            })
        }
        return out.isEmpty ? nil : out
    }

    // MARK: - Vision OCR (offline)

    // One recognized text fragment plus where it sits on the page (normalized
    // Vision coords: origin bottom-left, y increases upward).
    private struct Frag { let text: String; let conf: Float; let midY: CGFloat; let minX: CGFloat; let height: CGFloat }

    private static func recognizeText(in images: [UIImage]) -> ([[String: Any]], String) {
        var pages: [[String: Any]] = []
        var fullText = ""
        for image in images {
            guard let cgImage = image.cgImage else { continue }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            // Language correction mangles aviation codes (CYYZ, C-FABC, IFR).
            request.usesLanguageCorrection = false
            request.recognitionLanguages = ["en-CA", "en-US"]
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            try? handler.perform([request])

            // Collect fragments WITH position, then rebuild physical rows.
            // A logbook is a table; Vision emits one observation per cell and in
            // roughly column order, so a naive newline-join produces a vertical
            // token dump ("Year / Month: / Aircraft / Type / 02-2 …") that no
            // parser can read. Grouping by vertical band restores one flight per
            // line for both the heuristic parser and the on-device AI.
            var frags: [Frag] = []
            for observation in request.results ?? [] {
                guard let candidate = observation.topCandidates(1).first else { continue }
                let bb = observation.boundingBox
                frags.append(Frag(text: candidate.string, conf: candidate.confidence,
                                  midY: bb.midY, minX: bb.minX, height: bb.height))
            }

            var lines: [[String: Any]] = []
            var pageText = ""
            for row in Self.groupIntoRows(frags) {
                let text = Self.rowText(row) // spacing mirrors column positions
                let conf = row.map { $0.conf }.reduce(0, +) / Float(max(row.count, 1))
                // Raw fragment positions let the web parser assign hour columns
                // by x-coordinate rather than guessing from order.
                let fragData = row.map { f -> [String: Any] in ["t": f.text, "x": Double(f.minX)] }
                lines.append(["text": text, "confidence": conf, "frags": fragData])
                pageText += text + "\n"
            }
            pages.append(["text": pageText, "lines": lines])
            fullText += pageText + "\n"
        }
        return (pages, fullText)
    }

    // Cluster fragments into horizontal rows by vertical position (top-to-bottom),
    // then order each row left-to-right. Tolerance is compared against the row's
    // running average Y (not the first fragment) so slightly curved or skewed rows
    // don't split in the middle.
    private static func groupIntoRows(_ frags: [Frag]) -> [[Frag]] {
        guard !frags.isEmpty else { return [] }
        let sorted = frags.sorted { $0.midY > $1.midY } // larger y = higher up
        var rows: [[Frag]] = []
        var current: [Frag] = []
        var rowAvgY: CGFloat = 0
        for f in sorted {
            if !current.isEmpty {
                let maxH = (current.map { $0.height } + [f.height]).max()!
                let tol = maxH * 0.55
                if abs(f.midY - rowAvgY) <= tol {
                    current.append(f)
                    rowAvgY = current.reduce(0.0) { $0 + $1.midY } / CGFloat(current.count)
                    continue
                }
                rows.append(current.sorted { $0.minX < $1.minX })
            }
            current = [f]
            rowAvgY = f.midY
        }
        if !current.isEmpty { rows.append(current.sorted { $0.minX < $1.minX }) }
        return rows
    }

    // Render a row (already left-to-right) as text whose horizontal spacing
    // mirrors each fragment's column position, so a logbook's numeric grid stays
    // aligned across rows and both the AI and the heuristic parser can tell which
    // column a value belongs to. Extra spaces are harmless to the parser (it
    // splits on whitespace) and make the raw diagnostics panel readable.
    private static func rowText(_ row: [Frag]) -> String {
        let scale: CGFloat = 110 // ~monospace columns across a page width
        var line = ""
        for f in row {
            let col = max(0, Int((f.minX * scale).rounded()))
            if line.count < col {
                line += String(repeating: " ", count: col - line.count)
            } else if !line.isEmpty {
                line += " "
            }
            line += f.text
        }
        return line
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
            You extract EVERY flight row from OCR text of a pilot logbook or \
            aircraft journey-log page. The text has been reassembled into rows, \
            but columns may be ragged. Return one entry per flight row — do not \
            skip rows, do not merge two rows into one, and do not stop early. \
            Extract only what is written; never invent values, and leave a field \
            nil when a row does not clearly show it. The Year and Month are often \
            printed once (as column headers or at the top of the page) and apply \
            to every row beneath them until they change — combine that Year and \
            Month with each row's day to build the date as YYYY-MM-DD. Hour \
            columns are decimals.
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
