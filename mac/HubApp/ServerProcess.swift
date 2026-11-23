// Starts the hub's Node server when nothing answers on its port, watches the one
// it started, and stops it again on quit, but only if this app started it.

import Foundation

enum ServerStartResult {
    /// A server was already answering (launchd, or `npm start` in Terminal).
    case reused
    /// This app spawned the server and it answered.
    case started
    /// Nothing answered in time.
    case failed
}

/// A spawned server. `Process` is one; tests use fakes.
protocol ServerChild: AnyObject {
    var isRunning: Bool { get }
    func terminate()
    func forceKill()
    /// Calls `handler` when the process exits, on any thread.
    func onExit(_ handler: @escaping () -> Void)
}

extension Process: ServerChild {
    func forceKill() { kill(processIdentifier, SIGKILL) }
    func onExit(_ handler: @escaping () -> Void) { terminationHandler = { _ in handler() } }
}

/// One per app run. `ensureRunning` blocks, so call it off the main thread; it can
/// be called again (⌘R) after the server went down.
final class ServerProcess {
    typealias Launcher = () throws -> ServerChild

    private let launch: Launcher
    private let onUnexpectedExit: () -> Void
    private let startTimeout: TimeInterval
    private let pollInterval: TimeInterval
    private let pingTimeout: TimeInterval
    private let session: URLSession
    private let lock = NSLock()
    private var child: ServerChild?
    private var childAnswered = false
    private var stopped = false

    /// `onUnexpectedExit` runs, on any thread, when a server this app started and
    /// that had answered exits without `stop()`; once per server.
    init(launcher: @escaping Launcher, onUnexpectedExit: @escaping () -> Void = {},
         startTimeout: TimeInterval = 15, pollInterval: TimeInterval = 0.25, pingTimeout: TimeInterval = 1) {
        launch = launcher
        self.onUnexpectedExit = onUnexpectedExit
        self.startTimeout = startTimeout
        self.pollInterval = pollInterval
        self.pingTimeout = pingTimeout
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = pingTimeout
        config.timeoutIntervalForResource = pingTimeout
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.connectionProxyDictionary = [:]
        session = URLSession(configuration: config)
    }

    /// Reuses a server that answers `/api/ping`; otherwise spawns one and polls
    /// until it answers, it exits, or `startTimeout` passes.
    func ensureRunning(port: Int) -> ServerStartResult {
        if ping(port: port) { return .reused }
        terminateChild() // an earlier server of ours that stopped answering

        let spawned: ServerChild
        do {
            spawned = try launch()
        } catch {
            NSLog("%@", "Hub: couldn't start the server: \(error)")
            return .failed
        }
        guard adopt(spawned) else { return .failed }
        spawned.onExit { [weak self, weak spawned] in
            if let self, let spawned { self.childExited(spawned) }
        }

        let deadline = Date().addingTimeInterval(startTimeout)
        while true {
            if ping(port: port) { return answered(spawned) }
            if !spawned.isRunning {
                // It may have lost the port to another server that answers now.
                if ping(port: port) { return answered(spawned) }
                break
            }
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 { break }
            Thread.sleep(forTimeInterval: min(pollInterval, remaining))
        }
        // A server that was still booting can answer the moment the deadline passes.
        if ping(port: port) { return answered(spawned) }
        terminateChild()
        return .failed
    }

    /// Stops the server this app started. A reused server is left alone. Returns
    /// at once; SIGTERM and any SIGKILL are sent on another thread.
    func stop() {
        lock.lock()
        stopped = true
        lock.unlock()
        terminateChild(inBackground: true)
    }

    /// Test seam: start tracking `spawned` without running the poll loop.
    func trackedForTesting(_ spawned: ServerChild) { _ = adopt(spawned) }

    /// Keeps the spawned server unless `stop()` already ran (the app quit mid-start).
    private func adopt(_ spawned: ServerChild) -> Bool {
        lock.lock()
        let keep = !stopped
        if keep {
            child = spawned
            childAnswered = false
        }
        lock.unlock()
        if !keep { spawned.terminate() }
        return keep
    }

    /// A server answered: ours while it is still running, else another one took the port.
    /// Our own server is never "reused": when it answers just as it exits, nothing is
    /// left for `stop()` to end, but it answered, so report `.started`.
    private func answered(_ spawned: ServerChild) -> ServerStartResult {
        lock.lock()
        let tracked = child === spawned
        let running = tracked && spawned.isRunning
        if running {
            childAnswered = true
        } else if tracked {
            child = nil
        }
        lock.unlock()
        guard tracked else { return .reused }
        // An exit just before `childAnswered` was set was ignored; catch it here,
        // but only for a server that had answered while running.
        if running && !spawned.isRunning { childExited(spawned) }
        return .started
    }

    /// Reports the exit of our answering server once, and never after `stop()`.
    private func childExited(_ exited: ServerChild) {
        lock.lock()
        let unexpected = !stopped && childAnswered && child === exited
        if unexpected {
            child = nil
            childAnswered = false
        }
        lock.unlock()
        if unexpected { onUnexpectedExit() }
    }

    /// SIGTERM, then SIGKILL if it is still running after 3 s.
    private func terminateChild(inBackground: Bool = false) {
        lock.lock()
        let running = child
        child = nil
        childAnswered = false
        lock.unlock()
        guard let running, running.isRunning else { return }
        let stop: () -> Void = { [self] in
            _ = self // keep the stopper alive while `stop()` returns at once
            running.terminate()
            let deadline = Date().addingTimeInterval(3)
            while running.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
            if running.isRunning { running.forceKill() }
        }
        if inBackground {
            // An explicitly typed block: a bare closure literal here becomes the async overload.
            let background: () -> Void = stop
            DispatchQueue.global(qos: .userInitiated).async(execute: background)
        } else {
            stop()
        }
    }

    /// `GET http://127.0.0.1:<port>/api/ping` answered `200 {"ok":true}`.
    private func ping(port: Int) -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/ping") else { return false }
        let answered = Flag()
        let done = DispatchSemaphore(value: 0)
        session.dataTask(with: url) { data, response, _ in
            if (response as? HTTPURLResponse)?.statusCode == 200, let data,
               let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               body["ok"] as? Bool == true {
                answered.value = true
            }
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + pingTimeout + 1)
        return answered.value
    }
}

private final class Flag: @unchecked Sendable {
    var value = false
}

/// Where node, the repo and the data folder are. `node` and `repo` come from
/// `Contents/Resources/hub-paths.json`, written by `scripts/build-app.sh`.
struct HubPaths {
    static let defaultPort = 4747

    let node: String
    let repo: String
    let dataDir: String

    var serverScript: String { repo + "/server/main.ts" }
    var logFile: String { dataDir + "/logs/app-server.log" }

    /// The data folder is `~/PersonalHub`, or `$HUB_APP_DATA_DIR` when set
    /// (for trying the app against a scratch folder: `open --env HUB_APP_DATA_DIR=… Hub.app`).
    static func load(from file: URL,
                     environment: [String: String] = ProcessInfo.processInfo.environment) throws -> HubPaths {
        struct Saved: Decodable { let node: String; let repo: String }
        let saved = try JSONDecoder().decode(Saved.self, from: Data(contentsOf: file))
        let override = environment["HUB_APP_DATA_DIR"].flatMap { $0.isEmpty ? nil : $0 }
        let dataDir = override.map { ($0 as NSString).expandingTildeInPath } ?? NSHomeDirectory() + "/PersonalHub"
        return HubPaths(node: saved.node, repo: saved.repo, dataDir: dataDir)
    }

    /// `port` from `<dataDir>/config.json`, else 4747. A number or a numeric string.
    /// Creates the data folder first: the server writes its config there on first run.
    func port() -> Int {
        try? FileManager.default.createDirectory(atPath: dataDir, withIntermediateDirectories: true)
        guard let data = FileManager.default.contents(atPath: dataDir + "/config.json"),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let port = Self.portNumber(config["port"]), (1...65_535).contains(port)
        else { return Self.defaultPort }
        return port
    }

    private static func portNumber(_ value: Any?) -> Int? {
        if let number = value as? Int { return number }
        if let number = value as? Double { return Int(exactly: number) }
        if let text = value as? String { return Int(text.trimmingCharacters(in: .whitespaces)) }
        return nil
    }

    /// Spawns `<node> <repo>/server/main.ts` with `HUB_DATA_DIR`
    /// set, appending its output to `logs/app-server.log`.
    func launcher() -> ServerProcess.Launcher {
        return {
            let files = FileManager.default
            try files.createDirectory(atPath: (logFile as NSString).deletingLastPathComponent,
                                      withIntermediateDirectories: true)
            if !files.fileExists(atPath: logFile) { files.createFile(atPath: logFile, contents: nil) }
            guard let log = FileHandle(forWritingAtPath: logFile) else { throw CocoaError(.fileWriteNoPermission) }
            try log.seekToEnd()
            try log.write(contentsOf: Data("\n--- Hub.app started the server at \(Date()) ---\n".utf8))

            var environment = ProcessInfo.processInfo.environment
            environment["HUB_DATA_DIR"] = dataDir
            // Apps get a bare PATH; put node's folder and the usual tool folders first (git, gh).
            let nodeDir = (node as NSString).deletingLastPathComponent
            environment["PATH"] = [nodeDir, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
                                   environment["PATH"] ?? "/usr/sbin:/sbin"].joined(separator: ":")

            let process = Process()
            process.executableURL = URL(fileURLWithPath: node)
            process.arguments = [serverScript]
            process.currentDirectoryURL = URL(fileURLWithPath: repo)
            process.environment = environment
            process.standardOutput = log
            process.standardError = log
            do {
                try process.run()
            } catch {
                try? log.write(contentsOf: Data("Couldn't run \(node): \(error.localizedDescription)\n".utf8))
                throw error
            }
            return process
        }
    }
}
