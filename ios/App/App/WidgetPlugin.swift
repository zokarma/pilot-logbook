import Foundation
import Capacitor
import WidgetKit

/// Writes aggregated logbook stats to the App Group shared UserDefaults so the
/// home-screen widget can display hours and next document expiry without
/// embedding Supabase credentials in the widget extension.
///
/// Called from the web layer (DataContext.tsx) on every data mutation.
@objc(WidgetPlugin)
public class WidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetPlugin"
    public let jsName = "Widget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setData", returnType: CAPPluginReturnPromise),
    ]

    private static let suite = "group.ca.pilotlogbook.app"

    @objc func setData(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: Self.suite) else {
            // App Group not yet configured in Xcode — silently succeed so the
            // web layer doesn't surface an error to the pilot.
            call.resolve()
            return
        }
        defaults.set(call.getDouble("hoursToday")    ?? 0,  forKey: "wg_hoursToday")
        defaults.set(call.getDouble("hoursThisMonth") ?? 0, forKey: "wg_hoursThisMonth")
        defaults.set(call.getDouble("hoursThisYear")  ?? 0, forKey: "wg_hoursThisYear")
        defaults.set(call.getString("nextExpiryLabel") ?? "", forKey: "wg_nextExpiryLabel")
        defaults.set(call.getString("nextExpiryDate")  ?? "", forKey: "wg_nextExpiryDate")
        defaults.set(call.getInt("nextExpiryDays")    ?? -1, forKey: "wg_nextExpiryDays")
        defaults.set(Date().timeIntervalSince1970,           forKey: "wg_lastUpdated")
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
