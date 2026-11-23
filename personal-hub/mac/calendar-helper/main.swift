// calendar-helper: the hub's read-only window on the Calendar app, through EventKit.
//
//   calendar-helper status                          {"authorized":true|false}
//   calendar-helper request                         asks macOS for full calendar access, then prints the same
//   calendar-helper events --from <ISO> --to <ISO>  CalendarEvent[] JSON (shared/types.ts)
//
// Without full access, `events` prints {"error":"denied"} and exits 2, which tells
// the hub to fall back to the Calendar app. Built by scripts/build-helpers.sh with
// Info.plist embedded, so macOS can show why the hub wants the calendar.

import CoreGraphics
import EventKit
import Foundation

let store = EKEventStore()

func printJSON(_ value: Any) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else {
        FileHandle.standardError.write(Data("calendar-helper: couldn't encode the output\n".utf8))
        exit(1)
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write(Data("calendar-helper: \(message)\n".utf8))
    exit(code)
}

func isAuthorized() -> Bool {
    EKEventStore.authorizationStatus(for: .event) == .fullAccess
}

// ISO-8601 instants, with or without fractional seconds (JavaScript's toISOString has them).
let isoOut: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()
let isoIn = ISO8601DateFormatter()

func parseInstant(_ text: String) -> Date? {
    isoOut.date(from: text) ?? isoIn.date(from: text)
}

func option(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

/// A calendar's colour as #rrggbb in sRGB.
func hex(_ color: CGColor?) -> String {
    guard
        let srgb = CGColorSpace(name: CGColorSpace.sRGB),
        let converted = color?.converted(to: srgb, intent: .defaultIntent, options: nil),
        let c = converted.components, c.count >= 3
    else { return "#8c93b0" }
    let byte = { (v: CGFloat) in Int((min(max(v, 0), 1) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", byte(c[0]), byte(c[1]), byte(c[2]))
}

func orNull(_ text: String?) -> Any {
    guard let text, !text.isEmpty else { return NSNull() }
    return text
}

func eventJSON(_ event: EKEvent) -> [String: Any] {
    // A repeating event's occurrences share an identifier; the start makes each one unique.
    let base = event.eventIdentifier ?? event.calendarItemIdentifier
    let start = event.startDate ?? Date()
    let end = event.endDate ?? start
    return [
        "id": "\(base)@\(Int(start.timeIntervalSince1970))",
        "title": event.title ?? "",
        "start": isoOut.string(from: start),
        "end": isoOut.string(from: end),
        "allDay": event.isAllDay,
        "calendar": event.calendar?.title ?? "",
        "color": hex(event.calendar?.cgColor),
        "location": orNull(event.location),
        "notes": orNull(event.notes),
        "url": orNull(event.url?.absoluteString),
    ]
}

let command = CommandLine.arguments.dropFirst().first ?? ""

switch command {
case "status":
    printJSON(["authorized": isAuthorized()])

case "request":
    if !isAuthorized() {
        let done = DispatchSemaphore(value: 0)
        store.requestFullAccessToEvents { _, error in
            if let error { FileHandle.standardError.write(Data("calendar-helper: \(error.localizedDescription)\n".utf8)) }
            done.signal()
        }
        done.wait()
    }
    printJSON(["authorized": isAuthorized()])

case "events":
    guard let fromText = option("--from"), let toText = option("--to"),
          let from = parseInstant(fromText), let to = parseInstant(toText), from < to
    else { fail("usage: calendar-helper events --from <ISO> --to <ISO>", code: 64) }
    guard isAuthorized() else {
        printJSON(["error": "denied"])
        exit(2)
    }
    let predicate = store.predicateForEvents(withStart: from, end: to, calendars: nil)
    let events = store.events(matching: predicate).sorted { ($0.startDate ?? from) < ($1.startDate ?? from) }
    printJSON(events.map(eventJSON))

default:
    fail("usage: calendar-helper status | request | events --from <ISO> --to <ISO>", code: 64)
}
