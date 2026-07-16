import WidgetKit
import SwiftUI

// MARK: - Constants

private let appGroupID   = "group.ca.pilotlogbook.app"
private let loggerURL    = URL(string: "pilotlogbook://logger")!
private let newFlightURL = URL(string: "pilotlogbook://new-flight")!

// MARK: - Shared data (read from App Group UserDefaults written by WidgetPlugin)

struct WidgetData {
    let hoursToday:      Double
    let hoursThisMonth:  Double
    let hoursThisYear:   Double
    let nextExpiryLabel: String
    let nextExpiryDate:  String
    let nextExpiryDays:  Int    // -1 = no upcoming expiry

    static var placeholder: WidgetData {
        WidgetData(hoursToday: 1.5, hoursThisMonth: 24.2, hoursThisYear: 187.4,
                   nextExpiryLabel: "Category 1 Medical",
                   nextExpiryDate: "2025-06-15", nextExpiryDays: 45)
    }

    static var empty: WidgetData {
        WidgetData(hoursToday: 0, hoursThisMonth: 0, hoursThisYear: 0,
                   nextExpiryLabel: "", nextExpiryDate: "", nextExpiryDays: -1)
    }

    static func load() -> WidgetData {
        guard let d = UserDefaults(suiteName: appGroupID) else { return .empty }
        return WidgetData(
            hoursToday:      d.double(forKey: "wg_hoursToday"),
            hoursThisMonth:  d.double(forKey: "wg_hoursThisMonth"),
            hoursThisYear:   d.double(forKey: "wg_hoursThisYear"),
            nextExpiryLabel: d.string(forKey: "wg_nextExpiryLabel") ?? "",
            nextExpiryDate:  d.string(forKey: "wg_nextExpiryDate")  ?? "",
            nextExpiryDays:  d.object(forKey: "wg_nextExpiryDays") != nil
                             ? d.integer(forKey: "wg_nextExpiryDays") : -1
        )
    }
}

// MARK: - Timeline

struct LogbookEntry: TimelineEntry {
    let date: Date
    let widgetData: WidgetData
}

struct LogbookProvider: TimelineProvider {
    func placeholder(in context: Context) -> LogbookEntry {
        LogbookEntry(date: .now, widgetData: .placeholder)
    }
    func getSnapshot(in context: Context, completion: @escaping (LogbookEntry) -> Void) {
        completion(LogbookEntry(date: .now,
                                widgetData: context.isPreview ? .placeholder : .load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<LogbookEntry>) -> Void) {
        let entry = LogbookEntry(date: .now, widgetData: .load())
        // Refresh hourly; the app also triggers reload on every data mutation.
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: .now)!
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Design tokens

private let bgColor     = Color(red: 0.04, green: 0.07, blue: 0.13)
private let widgetAccent = Color(red: 0.36, green: 0.87, blue: 0.87)

private func hoursStr(_ h: Double) -> String { String(format: "%.1f", h) }

private func expiryTint(days: Int) -> Color {
    switch days {
    case ..<0:    return .secondary
    case 0...30:  return Color(red: 1.0, green: 0.4,  blue: 0.4)
    case 31...90: return Color(red: 1.0, green: 0.78, blue: 0.2)
    default:      return widgetAccent
    }
}

// MARK: - Reusable sub-views

struct HourCell: View {
    let label: String
    let hours: Double
    var body: some View {
        VStack(spacing: 2) {
            Text(hoursStr(hours))
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Lock screen views

struct CircularLockScreenView: View {
    let entry: LogbookEntry
    private var d: WidgetData { entry.widgetData }
    var body: some View {
        Gauge(value: min(d.hoursThisMonth, 100), in: 0...100) {
            Image(systemName: "airplane")
                .widgetAccentable()
        } currentValueLabel: {
            Text(hoursStr(d.hoursThisMonth))
                .font(.system(.caption, design: .rounded, weight: .bold))
                .minimumScaleFactor(0.5)
        }
        .gaugeStyle(.accessoryCircular)
    }
}

struct RectangularLockScreenView: View {
    let entry: LogbookEntry
    private var d: WidgetData { entry.widgetData }
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label("Hours", systemImage: "airplane")
                .font(.caption2.bold())
                .widgetAccentable()
            HStack(spacing: 12) {
                lockCell("Today", d.hoursToday)
                lockCell("Month", d.hoursThisMonth)
                lockCell("Year",  d.hoursThisYear)
            }
        }
    }
    private func lockCell(_ label: String, _ hours: Double) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(hoursStr(hours))
                .font(.system(size: 13, weight: .bold, design: .rounded))
            Text(label)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
        }
    }
}

struct InlineLockScreenView: View {
    let entry: LogbookEntry
    private var d: WidgetData { entry.widgetData }
    var body: some View {
        Label("\(hoursStr(d.hoursThisMonth))h this month", systemImage: "airplane")
    }
}

// MARK: - Stats — small

struct SmallStatsView: View {
    let entry: LogbookEntry
    private var d: WidgetData { entry.widgetData }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Hours", systemImage: "airplane")
                .font(.caption2.bold())
                .foregroundStyle(widgetAccent)
            Spacer(minLength: 0)
            Text(hoursStr(d.hoursThisMonth))
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.7)
            Text("this month")
                .font(.caption2)
                .foregroundStyle(.secondary)
            if d.nextExpiryDays >= 0 && !d.nextExpiryLabel.isEmpty {
                Rectangle().fill(Color.white.opacity(0.12)).frame(height: 0.5)
                Text(shortExpiry)
                    .font(.caption2.bold())
                    .foregroundStyle(expiryTint(days: d.nextExpiryDays))
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var shortExpiry: String {
        switch d.nextExpiryDays {
        case 0:  return "Expires today"
        case 1:  return "Expires tomorrow"
        default: return "Exp. \(d.nextExpiryDays)d · \(d.nextExpiryLabel)"
        }
    }
}

// MARK: - Stats — medium

struct MediumStatsView: View {
    let entry: LogbookEntry
    private var d: WidgetData { entry.widgetData }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Pilot Logbook", systemImage: "airplane")
                .font(.caption.bold())
                .foregroundStyle(widgetAccent)
            HStack(spacing: 0) {
                HourCell(label: "Today", hours: d.hoursToday)
                HourCell(label: "Month", hours: d.hoursThisMonth)
                HourCell(label: "Year",  hours: d.hoursThisYear)
            }
            if d.nextExpiryDays >= 0 && !d.nextExpiryLabel.isEmpty {
                Rectangle().fill(Color.white.opacity(0.12)).frame(height: 0.5)
                Label(expiryLine, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2.bold())
                    .foregroundStyle(expiryTint(days: d.nextExpiryDays))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var expiryLine: String {
        let name = d.nextExpiryLabel
        switch d.nextExpiryDays {
        case 0:      return "\(name) expires today"
        case 1:      return "\(name) expires tomorrow"
        case 2...90: return "\(name) in \(d.nextExpiryDays) days"
        default:     return "\(name)  ·  \(d.nextExpiryDate)"
        }
    }
}

// MARK: - Stats widget

struct StatsEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: LogbookEntry

    private var isLockScreen: Bool {
        family == .accessoryCircular || family == .accessoryRectangular || family == .accessoryInline
    }

    var body: some View {
        Group {
            switch family {
            case .systemMedium:         MediumStatsView(entry: entry)
            case .accessoryCircular:    CircularLockScreenView(entry: entry)
            case .accessoryRectangular: RectangularLockScreenView(entry: entry)
            case .accessoryInline:      InlineLockScreenView(entry: entry)
            default:                    SmallStatsView(entry: entry)
            }
        }
        .containerBackground(isLockScreen ? .clear : bgColor, for: .widget)
        .widgetURL(loggerURL)
    }
}

struct StatsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ca.pilotlogbook.stats",
                            provider: LogbookProvider()) { entry in
            StatsEntryView(entry: entry)
        }
        .configurationDisplayName("Hours Summary")
        .description("Today, month, and year flight hours plus your next document expiry.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Log Flight widget

struct LogFlightView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 36))
                .foregroundStyle(widgetAccent)
            Text("Log Flight")
                .font(.caption.bold())
                .foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(bgColor, for: .widget)
        .widgetURL(newFlightURL)
    }
}

struct LogFlightWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ca.pilotlogbook.logflight",
                            provider: LogbookProvider()) { _ in
            LogFlightView()
        }
        .configurationDisplayName("Log a Flight")
        .description("Tap to jump straight to the new-flight entry form.")
        .supportedFamilies([.systemSmall])
    }
}

// MARK: - Previews

#Preview("Stats small", as: .systemSmall) {
    StatsWidget()
} timeline: {
    LogbookEntry(date: .now, widgetData: .placeholder)
}

#Preview("Stats medium", as: .systemMedium) {
    StatsWidget()
} timeline: {
    LogbookEntry(date: .now, widgetData: .placeholder)
}

#Preview("Lock screen circular", as: .accessoryCircular) {
    StatsWidget()
} timeline: {
    LogbookEntry(date: .now, widgetData: .placeholder)
}

#Preview("Lock screen rectangular", as: .accessoryRectangular) {
    StatsWidget()
} timeline: {
    LogbookEntry(date: .now, widgetData: .placeholder)
}

#Preview("Lock screen inline", as: .accessoryInline) {
    StatsWidget()
} timeline: {
    LogbookEntry(date: .now, widgetData: .placeholder)
}

#Preview("Log Flight", as: .systemSmall) {
    LogFlightWidget()
} timeline: {
    LogbookEntry(date: .now, widgetData: .empty)
}
