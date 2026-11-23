// The window, the menu bar, and the server's lifetime.

import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let webController = WebViewController()
    private var window: NSWindow?
    private var server: ServerProcess?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = makeMainMenu()
        let window = makeWindow()
        self.window = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        startServer()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        server?.stop()
    }

    private func startServer() {
        guard let file = Bundle.main.url(forResource: "hub-paths", withExtension: "json"),
              let paths = try? HubPaths.load(from: file)
        else {
            NSLog("Hub: Contents/Resources/hub-paths.json is missing or unreadable; rebuild with npm run app")
            webController.showStartError(logFile: NSHomeDirectory() + "/PersonalHub/logs/app-server.log")
            return
        }
        let port = paths.port()
        let server = ServerProcess(launcher: paths.launcher())
        self.server = server
        DispatchQueue.global(qos: .userInitiated).async { [webController] in
            let result = server.ensureRunning(port: port)
            DispatchQueue.main.async {
                if result == .failed {
                    webController.showStartError(logFile: paths.logFile)
                } else {
                    webController.loadHub(port: port)
                }
            }
        }
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.title = "Hub"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(srgbRed: 14 / 255, green: 16 / 255, blue: 23 / 255, alpha: 1) // Dusk paper
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 720, height: 520)
        window.contentViewController = webController
        window.setContentSize(NSSize(width: 1440, height: 900))

        let autosaveName = "HubMainWindow"
        if !window.setFrameUsingName(autosaveName) { window.center() }
        window.setFrameAutosaveName(autosaveName)
        // The web view fills the title bar too; pages mark their own drag regions with
        // `-webkit-app-region: drag`, and WebViewController drags from those (no overlay).
        return window
    }

    private func makeMainMenu() -> NSMenu {
        let main = NSMenu()

        let hub = NSMenu(title: "Hub")
        hub.addItem(withTitle: "About Hub", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        hub.addItem(.separator())
        hub.addItem(withTitle: "Hide Hub", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        hub.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
            .keyEquivalentModifierMask = [.command, .option]
        hub.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        hub.addItem(.separator())
        hub.addItem(withTitle: "Quit Hub", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        add(hub, to: main)

        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        add(edit, to: main)

        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(WebViewController.reloadPage(_:)), keyEquivalent: "r")
            .target = webController
        view.addItem(withTitle: "Back", action: #selector(WebViewController.goBack(_:)), keyEquivalent: "[")
            .target = webController
        add(view, to: main)

        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        add(windowMenu, to: main)
        NSApp.windowsMenu = windowMenu

        return main
    }

    private func add(_ menu: NSMenu, to main: NSMenu) {
        let item = NSMenuItem(title: menu.title, action: nil, keyEquivalent: "")
        item.submenu = menu
        main.addItem(item)
    }
}
