import AppKit
import Foundation

@objc
public final class AppDelegate: NSObject, NSApplicationDelegate {
    public var windowController: MainWindowController!
    private var midnightTimer: Timer?
    private var lastRenderedDay: Int = -1

    public func applicationDidFinishLaunching(_ notification: Notification) {
        // 1. Initialize Window Controller
        windowController = MainWindowController()
        windowController.showWindow(nil)

        // 2. Setup Application Menus
        AppMenu.setupMenu(delegate: self, windowController: windowController)

        // 3. Initialize & Refresh Dynamic Dock Icon
        updateDockIcon()

        // 4. Setup Day Change Observer & Midnight Timer
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(dayChangedNotification),
            name: .NSCalendarDayChanged,
            object: nil
        )
        scheduleMidnightCheck()

        NSApp.activate(ignoringOtherApps: true)
    }

    public func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            windowController.window?.makeKeyAndOrderFront(nil)
        }
        return true
    }

    // MARK: - Dynamic Dock Icon Management

    @objc public func updateDockIcon() {
        let now = Date()
        let currentDay = Calendar.current.component(.day, from: now)
        guard currentDay != lastRenderedDay else { return }
        lastRenderedDay = currentDay

        DispatchQueue.main.async {
            let iconImage = CalendarIconRenderer.renderIcon(date: now, size: 512, forDock: true)
            NSApp.applicationIconImage = iconImage
            NSApp.dockTile.display()
        }
    }

    @objc private func dayChangedNotification() {
        updateDockIcon()
        scheduleMidnightCheck()
    }

    private func scheduleMidnightCheck() {
        midnightTimer?.invalidate()
        let calendar = Calendar.current
        guard let tomorrow = calendar.date(byAdding: .day, value: 1, to: Date()),
              let midnight = calendar.date(bySettingHour: 0, minute: 0, second: 2, of: tomorrow) else {
            return
        }

        let interval = midnight.timeIntervalSinceNow
        guard interval > 0 else { return }

        midnightTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { [weak self] _ in
            self?.updateDockIcon()
            self?.scheduleMidnightCheck()
        }
    }

    // MARK: - Menu Actions

    @objc public func showAbout() {
        let options: [NSApplication.AboutPanelOptionKey: Any] = [
            .applicationName: "모아 캘린더",
            .applicationVersion: "1.0.0",
            .version: "macOS Edition",
            .credits: NSAttributedString(
                string: "각자의 하루를, 우리의 시간으로.\n실시간 공유 캘린더 서비스",
                attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.secondaryLabelColor]
            )
        ]
        NSApp.orderFrontStandardAboutPanel(options: options)
    }

    @objc public func showPreferences() {
        windowController.promptForServerURL()
    }

    @objc public func createNewEvent() {
        windowController.createNewEvent()
    }

    @objc public func reloadPage() {
        windowController.reloadPage()
    }

    @objc public func resetZoom() {
        windowController.resetZoom()
    }

    @objc public func zoomIn() {
        windowController.zoomIn()
    }

    @objc public func zoomOut() {
        windowController.zoomOut()
    }

    @objc public func jumpToToday() {
        windowController.jumpToToday()
    }

    @objc public func selectDayView() {
        windowController.setViewMode("day")
    }

    @objc public func selectWeekView() {
        windowController.setViewMode("week")
    }

    @objc public func selectMonthView() {
        windowController.setViewMode("month")
    }

    @objc public func prevMonth() {
        windowController.navigateMonth("prev")
    }

    @objc public func nextMonth() {
        windowController.navigateMonth("next")
    }

    @objc public func openWebsite() {
        NSWorkspace.shared.open(MainWindowController.currentServerURL)
    }
}
