import AppKit
import Foundation
import UserNotifications

public final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    public static let shared = NotificationManager()

    public static let categoryEventReminder = "MOA_EVENT_REMINDER"
    public static let actionViewEvent = "MOA_ACTION_VIEW"
    public static let actionDismiss = "MOA_ACTION_DISMISS"

    private let center = UNUserNotificationCenter.current()
    private let scheduledIdsKey = "MoaScheduledReminderIds"

    private override init() {
        super.init()
    }

    public func setup() {
        center.delegate = self
        setupCategories()
        requestAuthorization(forcePrompt: false)
    }

    // MARK: - Category & Action Configuration

    private func setupCategories() {
        let viewAction = UNNotificationAction(
            identifier: NotificationManager.actionViewEvent,
            title: "일정 확인",
            options: [.foreground]
        )
        let dismissAction = UNNotificationAction(
            identifier: NotificationManager.actionDismiss,
            title: "닫기",
            options: [.destructive]
        )

        let reminderCategory = UNNotificationCategory(
            identifier: NotificationManager.categoryEventReminder,
            actions: [viewAction, dismissAction],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )

        center.setNotificationCategories([reminderCategory])
    }

    // MARK: - Authorization

    public func requestAuthorization(forcePrompt: Bool = false, completion: ((Bool) -> Void)? = nil) {
        center.getNotificationSettings { [weak self] settings in
            switch settings.authorizationStatus {
            case .notDetermined:
                self?.center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
                    if let error = error {
                        NSLog("[NotificationManager] Permission request error: \(error)")
                    }
                    completion?(granted)
                }
            case .authorized, .provisional:
                completion?(true)
            case .denied:
                if forcePrompt {
                    DispatchQueue.main.async {
                        self?.showPermissionAlert()
                    }
                }
                completion?(false)
            @unknown default:
                completion?(false)
            }
        }
    }

    public func showPermissionAlert() {
        let alert = NSAlert()
        alert.messageText = "알림 권한 설정"
        alert.informativeText = "모아 캘린더의 일정 시작 전 리마인더 알림을 수신하려면 시스템 설정에서 알림을 허용해 주세요."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "시스템 설정 열기")
        alert.addButton(withTitle: "취소")

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            openSystemNotificationSettings()
        }
    }

    public func showNotificationStatusAlert() {
        center.getNotificationSettings { [weak self] settings in
            DispatchQueue.main.async {
                let alert = NSAlert()
                alert.alertStyle = .informational
                switch settings.authorizationStatus {
                case .authorized, .provisional:
                    alert.messageText = "알림이 활성화되어 있습니다"
                    alert.informativeText = "모아 캘린더의 일정 리마인더와 실시간 알림을 정상적으로 수신하고 있습니다."
                    alert.addButton(withTitle: "확인")
                    alert.addButton(withTitle: "테스트 알림 발송")
                    let res = alert.runModal()
                    if res == .alertSecondButtonReturn {
                        self?.sendTestNotification()
                    }
                case .denied:
                    alert.messageText = "알림 권한이 차단되어 있습니다"
                    alert.informativeText = "macOS '시스템 설정 > 알림 > 모아 캘린더'에서 알림을 허용해 주시면 일정 시작 전 리마인더를 받을 수 있습니다."
                    alert.addButton(withTitle: "시스템 설정 열기")
                    alert.addButton(withTitle: "취소")
                    let res = alert.runModal()
                    if res == .alertFirstButtonReturn {
                        self?.openSystemNotificationSettings()
                    }
                case .notDetermined:
                    alert.messageText = "알림 권한 확인"
                    alert.informativeText = "모아 캘린더의 알림 권한을 승인하시겠습니까?"
                    alert.addButton(withTitle: "알림 허용")
                    alert.addButton(withTitle: "나중에")
                    let res = alert.runModal()
                    if res == .alertFirstButtonReturn {
                        self?.requestAuthorization(forcePrompt: true)
                    }
                @unknown default:
                    break
                }
            }
        }
    }

    public func openSystemNotificationSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.notifications") {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: - Immediate & Test Notifications

    public func sendNotification(title: String, body: String, identifier: String? = nil, userInfo: [String: Any]? = nil) {
        requestAuthorization(forcePrompt: false) { [weak self] granted in
            guard granted, let self = self else { return }

            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            if let userInfo = userInfo {
                content.userInfo = userInfo
            }
            content.categoryIdentifier = NotificationManager.categoryEventReminder

            let reqId = identifier ?? "moa-notify-\(UUID().uuidString)"
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
            let request = UNNotificationRequest(identifier: reqId, content: content, trigger: trigger)

            self.center.add(request) { error in
                if let error = error {
                    NSLog("[NotificationManager] Send notification error: \(error)")
                }
            }
        }
    }

    public func sendTestNotification() {
        requestAuthorization(forcePrompt: true) { [weak self] granted in
            guard granted, let self = self else { return }

            let content = UNMutableNotificationContent()
            content.title = "모아 캘린더 알림 테스트"
            content.body = "macOS 네이티브 알림이 정상적으로 작동하고 있어요!"
            content.sound = .default
            content.categoryIdentifier = NotificationManager.categoryEventReminder
            content.userInfo = ["type": "test_notification"]

            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
            let request = UNNotificationRequest(
                identifier: "moa-test-\(Int(Date().timeIntervalSince1970))",
                content: content,
                trigger: trigger
            )

            self.center.add(request) { error in
                if let error = error {
                    NSLog("[NotificationManager] Test notification failed: \(error)")
                }
            }
        }
    }

    // MARK: - Event Reminder Scheduling

    public func syncEventsAndScheduleReminders(eventsJson: String) {
        guard let data = eventsJson.data(using: .utf8),
              let rawList = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return
        }

        let now = Date()
        var newScheduledIds = Set<String>()

        for item in rawList {
            guard let id = item["id"] as? String, !id.isEmpty,
                  let title = item["title"] as? String, !title.isEmpty,
                  let startStr = item["start"] as? String, !startStr.isEmpty else {
                continue
            }

            let isCancelled = (item["is_cancelled"] as? Bool) == true || (item["is_cancelled"] as? Int) == 1
            if isCancelled { continue }

            let reminderEnabled = (item["reminder_enabled"] as? Bool) == true || (item["reminder_enabled"] as? Int) == 1
            if !reminderEnabled { continue }

            var reminderMinutes = 10
            if let minsInt = item["reminder_minutes"] as? Int {
                reminderMinutes = minsInt
            } else if let minsNum = item["reminder_minutes"] as? NSNumber {
                reminderMinutes = minsNum.intValue
            } else if let minsStr = item["reminder_minutes"] as? String, let parsed = Int(minsStr) {
                reminderMinutes = parsed
            }

            guard let startDate = NotificationManager.parseDateString(startStr) else {
                continue
            }

            let triggerDate = startDate.addingTimeInterval(-Double(reminderMinutes) * 60.0)
            guard triggerDate > now else {
                continue
            }

            let notifId = "moa-reminder-\(id)"
            newScheduledIds.insert(id)

            let content = UNMutableNotificationContent()
            content.title = title
            if reminderMinutes <= 0 {
                content.body = "일정이 지금 시작돼요."
            } else if reminderMinutes == 60 {
                content.body = "1시간 후 일정이 시작돼요."
            } else if reminderMinutes > 60 && reminderMinutes % 60 == 0 {
                content.body = "\(reminderMinutes / 60)시간 후 일정이 시작돼요."
            } else {
                content.body = "\(reminderMinutes)분 후 일정이 시작돼요."
            }
            content.sound = .default
            content.categoryIdentifier = NotificationManager.categoryEventReminder

            let datePrefix = String(startStr.prefix(10))
            content.userInfo = [
                "event_id": id,
                "date": datePrefix,
                "title": title
            ]

            let components = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute, .second],
                from: triggerDate
            )
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            let request = UNNotificationRequest(identifier: notifId, content: content, trigger: trigger)

            center.add(request) { error in
                if let error = error {
                    NSLog("[NotificationManager] Schedule reminder error for \(id): \(error)")
                }
            }
        }

        // Cancel reminders for events that are no longer active
        let defaults = UserDefaults.standard
        let prevIds = Set(defaults.stringArray(forKey: scheduledIdsKey) ?? [])
        let removedIds = prevIds.subtracting(newScheduledIds)
        if !removedIds.isEmpty {
            let staleNotifIds = removedIds.map { "moa-reminder-\($0)" }
            center.removePendingNotificationRequests(withIdentifiers: staleNotifIds)
        }
        defaults.set(Array(newScheduledIds), forKey: scheduledIdsKey)
    }

    // MARK: - Date Parsing Helper

    public static func parseDateString(_ string: String) -> Date? {
        let clean = string.trimmingCharacters(in: .whitespacesAndNewlines)

        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = isoFormatter.date(from: clean) { return d }
        isoFormatter.formatOptions = [.withInternetDateTime]
        if let d = isoFormatter.date(from: clean) { return d }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current

        let formats = [
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd HH:mm",
            "yyyy-MM-dd"
        ]
        for format in formats {
            formatter.dateFormat = format
            if let d = formatter.date(from: clean) { return d }
        }
        return nil
    }

    // MARK: - UNUserNotificationCenterDelegate

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if #available(macOS 11.0, *) {
            completionHandler([.banner, .sound, .badge, .list])
        } else {
            completionHandler([.alert, .sound, .badge])
        }
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }

        if response.actionIdentifier == NotificationManager.actionDismiss {
            return
        }

        let userInfo = response.notification.request.content.userInfo
        let eventId = userInfo["event_id"] as? String ?? ""
        let date = userInfo["date"] as? String ?? ""

        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)
            if let appDelegate = NSApp.delegate as? AppDelegate,
               let windowController = appDelegate.windowController {
                windowController.window?.makeKeyAndOrderFront(nil)
                if !eventId.isEmpty {
                    windowController.openEvent(id: eventId, date: date)
                }
            }
        }
    }
}
