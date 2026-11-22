// Starts the hub's Node server when nothing answers on its port, and stops it
// again on quit, but only if this app started it.

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
}

extension Process: ServerChild {
    func forceKill() { kill(processIdentifier, SIGKILL) }
}

/// One per app run. `ensureRunning` blocks, so call it off the main thread.
final class ServerProcess {
    typealias Launcher = () throws -> ServerChild

    private let launch: Launcher
    private let startTimeout: TimeInterval
    private let pollInterval: TimeInterval
    private let pingTimeout: TimeInterval
    private let session: URLSession
    private let lock = NSLock()
    private var child: ServerChild?
    private var stopped = false

    init(launcher: @escaping Launcher, startTimeout: TimeInterval = 15, pollInterval: TimeInterval = 0.25,
         pingTimeout: TimeInterval = 1) {
        launch = launcher
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

        let spawned: ServerChild
        do { spawned = try launch() } catch { return .failed }
        guard adopt(spawned) else { return .failed }

        let deadline = Date().addingTimeInterval(startTimeout)
        while true {
            if ping(port: port) { return .started }
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 || !spawned.isRunning { break }
            Thread.sleep(forTimeInterval: min(pollInterval, remaining))
        }
        terminateChild()
        return .failed
    }

    /// Stops the server this app started. A reused server is left alone.
    func stop() {
        lock.lock()
        stopped = true
        lock.unlock()
        terminateChild()
    }

    /// Keeps the spawned server unless `stop()` already ran (the app quit mid-start).
    private func adopt(_ spawned: ServerChild) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if stopped {
            spawned.terminate()
            return false
        }
        child = spawned
        return true
    }

    /// SIGTERM, then SIGKILL if it is still running after 3 s.
    private func terminateChild() {
        lock.lock()
        let running = child
        child = nil
        lock.unlock()
        guard let running, running.isRunning else { return }
        running.terminate()
        let deadline = Date().addingTimeInterval(3)
        while running.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
        if running.isRunning { running.forceKill() }
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

    var serverScript: String { repo + "/personal-hub/server/main.ts" }
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

    /// `port` from `<dataDir>/config.json`, else 4747.
    func port() -> Int {
        guard let data = FileManager.default.contents(atPath: dataDir + "/config.json"),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let port = config["port"] as? Int, (1...65_535).contains(port)
        else { return Self.defaultPort }
        return port
    }

    /// Spawns `<node> <repo>/personal-hub/server/main.ts` with `HUB_DATA_DIR`
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
            // Apps get a bare PATH; put node's folder first so the server finds its tools (git, gh).
            let nodeDir = (node as NSString).deletingLastPathComponent
            environment["PATH"] = nodeDir + ":" + (environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin")

            let process = Process()
            process.executableURL = URL(fileURLWithPath: node)
            process.arguments = [serverScript]
            process.currentDirectoryURL = URL(fileURLWithPath: repo + "/personal-hub")
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
