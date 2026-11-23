// Tests for ServerProcess and HubPaths. A plain executable: it prints each
// result and exits non-zero on any failure. Run with `bash scripts/build-app.sh --test`.
// Test ports are 4823–4829, never the hub's 4747.

import Foundation
import Network

/// Answers every request with `200 {"ok":true}`, like the hub's `/api/ping`.
/// `deferred()` holds the port from the start but answers 503 until `start()`.
final class PingListener {
    private let listener: NWListener
    private let answering = TestFlag()
    private let ready = DispatchSemaphore(value: 0)

    private let answerDelay: TimeInterval
    private var refusalEnds: Date?

    /// `refusingFor` keeps it on 503 for that long after creation.
    init(port: Int, answeringNow: Bool = true, answeringAfter: TimeInterval = 0, refusingFor: TimeInterval? = nil) throws {
        answering.value = answeringNow
        answerDelay = answeringAfter
        refusalEnds = refusingFor.map { Date().addingTimeInterval($0) }
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: UInt16(port))!)
        listener.stateUpdateHandler = { [ready] state in
            if case .ready = state { ready.signal() }
        }
        listener.newConnectionHandler = { [answering, answerDelay, self] connection in
            connection.start(queue: .global())
            connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { _, _, _, _ in
                if answerDelay > 0 { Thread.sleep(forTimeInterval: answerDelay) }
                let up = answering.value || self.refusalEnds.map { Date() >= $0 } == true
                let (status, body) = up ? ("200 OK", #"{"ok":true}"#) : ("503 Unavailable", "{}")
                let response = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\n"
                    + "Content-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
                connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
            }
        }
        listener.start(queue: .global())
        guard ready.wait(timeout: .now() + 2) == .success else {
            listener.cancel()
            throw TestError("listener on port \(port) never became ready")
        }
    }

    /// A server that holds its port but isn't ready yet: it refuses pings until `start()`.
    static func deferred(port: Int) throws -> PingListener {
        try PingListener(port: port, answeringNow: false)
    }

    func start() { answering.value = true }

    func close() { listener.cancel() }
}

/// A marker shared across queues; `Flag` in ServerProcess.swift is private. Written
/// with the current time so a stale read looks like an old date, not a value.
final class TestFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var written: Date?
    var value: Bool {
        get { lock.lock(); defer { lock.unlock() }; return written != nil }
        set { lock.lock(); written = newValue ? Date() : nil; lock.unlock() }
    }
}

final class FakeChild: ServerChild {
    private(set) var isRunning: Bool
    private(set) var terminated = 0
    private(set) var killed = 0
    private var exitHandler: (() -> Void)?

    init(running: Bool, terminateBody: @escaping () -> Void = {}) {
        isRunning = running
        self.terminateBody = terminateBody
    }
    /// `terminate()` may run on a background thread (`stop()` returns at once).
    func terminate() { terminateBody(); lock.lock(); terminated += 1; isRunning = false; lock.unlock() }
    private let lock = NSLock()
    private let terminateBody: () -> Void
    func forceKill() { killed += 1; isRunning = false }
    func onExit(_ handler: @escaping () -> Void) { exitHandler = handler }
}

struct TestError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

func expect(_ condition: Bool, _ message: @autoclosure () -> String) throws {
    if !condition { throw TestError(message()) }
}

func temporaryDirectory() throws -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("hubapp-test-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

@main
struct ServerProcessTests {
    static func main() {
        var failures = 0
        func test(_ name: String, _ body: () throws -> Void) {
            do {
                try body()
                print("✓ \(name)")
            } catch {
                failures += 1
                print("✗ \(name): \(error)")
            }
        }

        test("reuses a running server") {
            let hub = try PingListener(port: 4823)
            defer { hub.close() }
            var launches = 0
            let server = ServerProcess(launcher: { launches += 1; return FakeChild(running: true) })
            let result = server.ensureRunning(port: 4823)
            try expect(result == .reused, "expected .reused, got \(result)")
            try expect(launches == 0, "spawned \(launches) servers")
        }

        test("reports a timeout") {
            let child = FakeChild(running: true) // runs, never answers
            let server = ServerProcess(launcher: { child }, startTimeout: 0.2)
            let start = Date()
            let result = server.ensureRunning(port: 4824)
            let elapsed = Date().timeIntervalSince(start)
            try expect(result == .failed, "expected .failed, got \(result)")
            try expect(elapsed >= 0.2 && elapsed < 0.7, "took \(elapsed) s with a 0.2 s timeout")
            try expect(child.terminated == 1, "the unanswering server was not stopped")
        }

        test("only stops what it started") {
            let launchd = try PingListener(port: 4825)
            defer { launchd.close() }
            var children: [FakeChild] = []
            let server = ServerProcess(launcher: {
                let child = FakeChild(running: true)
                children.append(child)
                return child
            })
            let result = server.ensureRunning(port: 4825)
            try expect(result == .reused, "expected .reused, got \(result)")
            server.stop()
            try expect(children.isEmpty, "spawned a server next to a running one")
            try expect(children.allSatisfy { $0.terminated == 0 && $0.killed == 0 }, "sent a signal")
        }

        test("stops the server it started") {
            var spawned: PingListener?
            defer { spawned?.close() }
            let child = FakeChild(running: true)
            let server = ServerProcess(launcher: {
                spawned = try PingListener(port: 4826)
                return child
            })
            let result = server.ensureRunning(port: 4826)
            try expect(result == .started, "expected .started, got \(result)")
            try expect(child.terminated == 0, "stopped before quit")
            server.stop()
            let deadline = Date().addingTimeInterval(2)
            while child.terminated == 0 && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
            Thread.sleep(forTimeInterval: 0.1) // let a stray SIGKILL land, if there is one
            try expect(child.terminated == 1, "stop() did not terminate its own server")
            try expect(child.killed == 0, "force-killed a server that had exited")
        }

        test("fails fast when the server exits") {
            let server = ServerProcess(launcher: { FakeChild(running: false) }, startTimeout: 5)
            let start = Date()
            let result = server.ensureRunning(port: 4827)
            let elapsed = Date().timeIntervalSince(start)
            try expect(result == .failed, "expected .failed, got \(result)")
            try expect(elapsed < 1, "waited \(elapsed) s for a server that had exited")
        }

        test("reads the port from config.json") {
            let dir = try temporaryDirectory()
            defer { try? FileManager.default.removeItem(at: dir) }
            let config = dir.appendingPathComponent("config.json")
            let paths = HubPaths(node: "/usr/bin/true", repo: "/repo", dataDir: dir.path)
            try expect(paths.port() == 4747, "no config should mean 4747, got \(paths.port())")
            try Data(#"{"port": 4828, "timeZone": null}"#.utf8).write(to: config)
            try expect(paths.port() == 4828, "expected 4828, got \(paths.port())")
            try Data(#"{"port": "4828"}"#.utf8).write(to: config)
            try expect(paths.port() == 4828, "a numeric string should mean 4828, got \(paths.port())")
            try Data(#"{"port": 0}"#.utf8).write(to: config)
            try expect(paths.port() == 4747, "out of range should mean 4747, got \(paths.port())")
            try Data(#"{"port": "abc"}"#.utf8).write(to: config)
            try expect(paths.port() == 4747, "a non-numeric string should mean 4747, got \(paths.port())")
            try Data("{not json".utf8).write(to: config)
            try expect(paths.port() == 4747, "a broken config should mean 4747, got \(paths.port())")
        }

        test("stops its server off the main thread") {
            // Blocks 0.5 s when told to terminate: a synchronous `stop()` would block its caller.
            let child = FakeChild(running: true, terminateBody: { Thread.sleep(forTimeInterval: 0.5) })
            let server = ServerProcess(launcher: { child })
            server.trackedForTesting(child)
            let start = Date()
            server.stop()
            let elapsed = Date().timeIntervalSince(start)
            try expect(elapsed < 0.2, "stop() blocked its caller for \(elapsed) s")
            let deadline = Date().addingTimeInterval(3)
            while child.terminated == 0 && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
            try expect(child.terminated == 1, "stop() never terminated its own server")
        }

        test("loads hub-paths.json and honours HUB_APP_DATA_DIR") {
            let dir = try temporaryDirectory()
            defer { try? FileManager.default.removeItem(at: dir) }
            let file = dir.appendingPathComponent("hub-paths.json")
            try Data(#"{"node": "/opt/node/bin/node", "repo": "/Users/you/Next"}"#.utf8).write(to: file)

            let standard = try HubPaths.load(from: file, environment: [:])
            try expect(standard.node == "/opt/node/bin/node", "node is \(standard.node)")
            try expect(standard.serverScript == "/Users/you/Next/personal-hub/server/main.ts", "script is \(standard.serverScript)")
            try expect(standard.dataDir == NSHomeDirectory() + "/PersonalHub", "data dir is \(standard.dataDir)")
            try expect(standard.logFile == NSHomeDirectory() + "/PersonalHub/logs/app-server.log", "log is \(standard.logFile)")

            let overridden = try HubPaths.load(from: file, environment: ["HUB_APP_DATA_DIR": "/tmp/hub-test"])
            try expect(overridden.dataDir == "/tmp/hub-test", "data dir is \(overridden.dataDir)")
        }

        test("launches node with HUB_DATA_DIR and logs to app-server.log") {
            let dir = try temporaryDirectory()
            defer { try? FileManager.default.removeItem(at: dir) }
            let repo = dir.appendingPathComponent("repo")
            let script = repo.appendingPathComponent("personal-hub/server/main.ts")
            try FileManager.default.createDirectory(at: script.deletingLastPathComponent(), withIntermediateDirectories: true)
            // /bin/sh stands in for node, so this "main.ts" is a shell script.
            try Data("echo \"data=$HUB_DATA_DIR cwd=$(pwd -P)\"\n".utf8).write(to: script)
            let dataDir = dir.appendingPathComponent("data").path
            let paths = HubPaths(node: "/bin/sh", repo: repo.path, dataDir: dataDir)

            let child = try paths.launcher()()
            let deadline = Date().addingTimeInterval(5)
            while child.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
            try expect(!child.isRunning, "the stand-in server never exited")
            let log = try String(contentsOfFile: paths.logFile, encoding: .utf8)
            // `pwd -P` gives /private/var/…; Foundation won't, so match the unique tail.
            let cwdTail = "\(dir.lastPathComponent)/repo/personal-hub\n"
            try expect(log.contains("data=\(dataDir) "), "log does not show HUB_DATA_DIR: \(log)")
            try expect(log.contains(cwdTail), "log does not show the personal-hub cwd: \(log)")
        }

        test("logs why node couldn't run") {
            let dir = try temporaryDirectory()
            defer { try? FileManager.default.removeItem(at: dir) }
            let paths = HubPaths(node: dir.path + "/missing/node", repo: dir.path, dataDir: dir.path)
            var threw = false
            do { _ = try paths.launcher()() } catch { threw = true }
            try expect(threw, "launching a missing node did not throw")
            let log = try String(contentsOfFile: paths.logFile, encoding: .utf8)
            try expect(log.contains("Couldn't run \(paths.node)"), "log does not say why: \(log)")
        }

        test("becomes ready just after the start timeout") {
            let child = FakeChild(running: true)
            let listener = try PingListener.deferred(port: 4829) // refusing pings until it is ready
            defer { listener.close() }
            // Hungry refuses for its first 0.2 s, so the loop's checks stay cheap and
            // it reaches the 0.3 s deadline. The server boots at 0.2 s, before that:
            // only the re-ping after the loop can see it answer.
            let hungry = try PingListener(port: 4828, refusingFor: 0.2)
            defer { hungry.close() }
            let server = ServerProcess(launcher: { child }, startTimeout: 0.3, pollInterval: 0.0,
                                       pingTimeout: 0.35)
            let boot = Thread {
                let due = Date().addingTimeInterval(0.2)
                while Date() < due { Thread.sleep(forTimeInterval: 0.005) }
                listener.start()
            }
            boot.start()
            let t0 = Date()
            let result = server.ensureRunning(port: 4829)
            try expect(result == .started, "expected .started, got \(result) after \(Date().timeIntervalSince(t0)) s")
            try expect(child.terminated == 0, "stopped a server that had answered")
            server.stop()
            let deadline = Date().addingTimeInterval(2)
            while child.terminated == 0 && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
            try expect(child.terminated == 1, "stop() did not terminate its own server")
        }

        print(failures == 0 ? "All tests passed" : "\(failures) test(s) failed")
        exit(failures == 0 ? 0 : 1)
    }
}
