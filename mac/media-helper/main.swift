// media-helper: the hub's experimental reach into whatever is playing.
//
//   media-helper status                       {"accessibility":true|false}
//   media-helper key play|next|previous       posts the system media key (needs Accessibility)
//   media-helper now                          NowPlaying JSON (shared/types.ts), or
//                                             {"error":"unavailable"} and exit 3
//
// Keys are the system-defined NX_KEYTYPE_* events, down then up, posted to the
// HID tap — the same events the keyboard's media keys send, so every player
// hears them without being named. macOS only delivers them to a process the
// user has allowed under System Settings → Privacy & Security → Accessibility;
// without it the key command answers {"error":"no-accessibility"} and exits 2.
//
// `now` reads MediaRemote, a private framework, through dlopen, the way the
// mediaremote-adapter does. macOS may refuse it (exit 3); the hub then shows
// the controls only.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

let NX_KEYTYPE_PLAY: Int32 = 16
let NX_KEYTYPE_NEXT: Int32 = 17
let NX_KEYTYPE_PREVIOUS: Int32 = 18

func printJSON(_ value: Any) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else {
        FileHandle.standardError.write(Data("media-helper: couldn't encode the output\n".utf8))
        exit(1)
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write(Data("media-helper: \(message)\n".utf8))
    exit(code)
}

let arguments = CommandLine.arguments.dropFirst()
let command = arguments.first ?? ""

switch command {
case "status":
    printJSON(["accessibility": AXIsProcessTrusted()])

case "key":
    guard let name = arguments.dropFirst().first,
          let keyType = ["play": NX_KEYTYPE_PLAY, "next": NX_KEYTYPE_NEXT, "previous": NX_KEYTYPE_PREVIOUS][name]
    else { fail("usage: media-helper key play|next|previous", code: 64) }

    guard AXIsProcessTrusted() else {
        printJSON(["error": "no-accessibility"])
        exit(2)
    }

    // A system-defined event carries the key code high and the down/up flag low.
    func post(_ flags: Int) {
        let event = NSEvent.otherEvent(
            with: .systemDefined,
            location: .zero,
            modifierFlags: NSEvent.ModifierFlags(rawValue: UInt(flags << 8)),
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: 0,
            context: nil,
            subtype: 8,
            data1: (Int(keyType) << 16) | (flags << 8),
            data2: -1
        )
        event?.cgEvent?.post(tap: .cghidEventTap)
    }
    post(0xa) // key down
    post(0xb) // key up

case "now":
    guard let framework = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW) else {
        printJSON(["error": "unavailable"])
        exit(3)
    }
    typealias GetInfo = @convention(c) (DispatchQueue, @escaping @convention(block) (CFDictionary?) -> Void) -> Void
    typealias GetPID = @convention(c) (DispatchQueue, @escaping @convention(block) (Int32) -> Void) -> Void
    typealias GetState = @convention(c) (DispatchQueue, @escaping @convention(block) (Int32) -> Void) -> Void

    guard
        let info = dlsym(framework, "MRMediaRemoteGetNowPlayingInfo").map({ unsafeBitCast($0, to: GetInfo.self) }),
        let pid = dlsym(framework, "MRMediaRemoteGetNowPlayingApplicationPID").map({ unsafeBitCast($0, to: GetPID.self) }),
        let state = dlsym(framework, "MRMediaRemoteGetNowPlayingApplicationIsPlaying").map({ unsafeBitCast($0, to: GetState.self) })
    else {
        printJSON(["error": "unavailable"])
        exit(3)
    }

    let done = DispatchSemaphore(value: 0)
    var playing = true

    state(DispatchQueue.global()) { isPlaying in
        playing = isPlaying != 0
        done.signal()
    }
    guard done.wait(timeout: .now() + 2) == .success else {
        printJSON(["error": "unavailable"])
        exit(3)
    }

    var found: [String: Any]?
    var appPID: Int32 = 0
    pid(DispatchQueue.global()) { appPID = $0 }
    info(DispatchQueue.global()) { dictionary in
        found = dictionary as? [String: Any]
        done.signal()
    }
    guard done.wait(timeout: .now() + 2) == .success, appPID > 0 else {
        printJSON(["error": "unavailable"])
        exit(3)
    }
    guard let info = found else {
        // No player: the track is null rather than an error, so the panel keeps its controls.
        printJSON(NSNull())
        exit(0)
    }

    func text(_ key: String) -> String {
        (info[key] as? String) ?? ""
    }

    // Artwork arrives as raw image data; the panel takes a data URL.
    var artwork: Any = NSNull()
    if let data = info["kMRMediaRemoteNowPlayingInfoArtworkData"] as? Data, !data.isEmpty {
        let type = (info["kMRMediaRemoteNowPlayingInfoArtworkMIMEType"] as? String) ?? "image/jpeg"
        artwork = "data:\(type);base64,\(data.base64EncodedString())"
    }

    var track: [String: Any] = [
        "title": text("kMRMediaRemoteNowPlayingInfoTitle"),
        "artist": text("kMRMediaRemoteNowPlayingInfoArtist"),
        "album": orNull(text("kMRMediaRemoteNowPlayingInfoAlbum")),
        "artwork": artwork,
        "playing": playing,
    ]
    if (track["title"] as? String ?? "").isEmpty { track["title"] = "Unknown track" }
    printJSON(track)

default:
    fail("usage: media-helper status | key play|next|previous | now", code: 64)
}

func orNull(_ value: String) -> Any {
    value.isEmpty ? NSNull() : value
}
