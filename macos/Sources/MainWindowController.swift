import AppKit
import WebKit

public final class MainWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var progressIndicator: NSProgressIndicator!
    private var topDragBar: WindowTopDragBar!
    private var observation: NSKeyValueObservation?
    private var loadingObservation: NSKeyValueObservation?
    private var pendingEventToOpen: (id: String, date: String)?

    public static let defaultServerURL = "https://dwm.brightnetworks.kr"
    private static let serverURLKey = "MoaCalendarServerURL"
    private let topDragBarHeight: CGFloat = 28.0 // Dedicated 28px dark green title/drag bar aligned with macOS traffic lights

    public static var currentServerURL: URL {
        get {
            if let saved = UserDefaults.standard.string(forKey: serverURLKey),
               let url = URL(string: saved), !saved.isEmpty {
                return url
            }
            return URL(string: defaultServerURL)!
        }
        set {
            UserDefaults.standard.set(newValue.absoluteString, forKey: serverURLKey)
        }
    }

    public init() {
        let window = NSWindow(
            contentRect: NSRect(x: 100, y: 100, width: 1140, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "모아 캘린더"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.backgroundColor = NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return isDark
                ? NSColor(calibratedRed: 20/255, green: 27/255, blue: 24/255, alpha: 1.0)
                : NSColor(calibratedRed: 248/255, green: 250/255, blue: 247/255, alpha: 1.0)
        }
        window.minSize = NSSize(width: 720, height: 520)
        window.setFrameAutosaveName("MoaCalendarMainWindowFrame")

        super.init(window: window)
        window.delegate = self

        setupWebView()
        setupProgressBar()
        loadCurrentURL()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        observation?.invalidate()
        loadingObservation?.invalidate()
    }

    private func setupWebView() {
        guard let window = self.window, let contentView = window.contentView else { return }

        // Enable CoreAnimation layer hosting on the window content view
        contentView.wantsLayer = true

        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore.default()
        config.applicationNameForUserAgent = "MoaCalendarNative/1.0 (Macintosh; Intel Mac OS X)"

        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs

        // Native window drag handler injection
        let contentController = WKUserContentController()
        contentController.add(self, name: "windowDrag")
        contentController.add(self, name: "moaNotification")

        let bridgeScriptSource = """
        (function() {
          window.MoaMacBridge = {
            isMacApp: true,
            platform: 'macos',
            syncEventsData: function(events, calendars) {
              try {
                var evStr = typeof events === 'string' ? events : JSON.stringify(events || []);
                var calStr = typeof calendars === 'string' ? calendars : JSON.stringify(calendars || []);
                if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.moaNotification) {
                  window.webkit.messageHandlers.moaNotification.postMessage({
                    action: 'syncEvents',
                    events: evStr,
                    calendars: calStr
                  });
                }
              } catch (e) {
                console.warn('[MoaMacBridge] syncEventsData error:', e);
              }
            },
            showNotification: function(title, options) {
              try {
                if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.moaNotification) {
                  window.webkit.messageHandlers.moaNotification.postMessage({
                    action: 'showNotification',
                    title: String(title || ''),
                    options: options || {}
                  });
                }
              } catch (e) {
                console.warn('[MoaMacBridge] showNotification error:', e);
              }
            },
            testNotification: function() {
              try {
                if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.moaNotification) {
                  window.webkit.messageHandlers.moaNotification.postMessage({
                    action: 'testNotification'
                  });
                }
              } catch (e) {
                console.warn('[MoaMacBridge] testNotification error:', e);
              }
            },
            requestPermission: function() {
              try {
                if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.moaNotification) {
                  window.webkit.messageHandlers.moaNotification.postMessage({
                    action: 'requestPermission'
                  });
                }
              } catch (e) {
                console.warn('[MoaMacBridge] requestPermission error:', e);
              }
            }
          };

          // Web Notification API Bridge / Polyfill
          try {
            function MacNotification(title, options) {
              options = options || {};
              window.MoaMacBridge.showNotification(title, options);
              this.title = title;
              this.body = options.body || '';
              this.tag = options.tag || '';
              this.data = options.data || null;
              this.close = function() {};
            }
            MacNotification.permission = 'granted';
            MacNotification.requestPermission = function(callback) {
              window.MoaMacBridge.requestPermission();
              if (typeof callback === 'function') callback('granted');
              return Promise.resolve('granted');
            };
            window.Notification = MacNotification;
          } catch (e) {
            console.warn('[MoaMacBridge] Notification bridge setup failed:', e);
          }
        })();
        """
        let bridgeUserScript = WKUserScript(source: bridgeScriptSource, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        contentController.addUserScript(bridgeUserScript)

        let dragScriptSource = """
        (function() {
          function injectDragStyles() {
            if (document.getElementById('macos-native-drag-style')) return;
            const style = document.createElement('style');
            style.id = 'macos-native-drag-style';
            style.textContent = `
              .topbar, .calendar-title-group, .calendar-title, .sidebar-brand, .calendar-toolbar, .month-heading {
                -webkit-app-region: drag !important;
                user-select: none !important;
                -webkit-user-select: none !important;
              }
              button, a, input, select, textarea, [role="button"], [role="tab"], .topbar-actions, .icon, #mobile-search-trigger, #mobile-more-trigger, #share, .today-button, .view-btn, .month-nav, .dday-widget, .dday-widget-bar, .calendar-view-controls, #calendar, .month-grid, .weekdays {
                -webkit-app-region: no-drag !important;
              }
            `;
            (document.head || document.documentElement).appendChild(style);
          }

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectDragStyles);
          } else {
            injectDragStyles();
          }

          document.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            if (e.target.closest('button, a, input, select, textarea, [role="button"], [role="tab"], .dday-widget, .dday-widget-bar, .icon, #today, .view-btn, .month-nav, #open-schedule-share-btn, .event-pill, .day, .week-col, dialog, .profile, #calendar, .month-grid, .weekdays')) {
              return;
            }
            if (e.target.closest('.topbar, .calendar-title-group, .calendar-heading-block, .sidebar-brand, #main-sidebar, .calendar-toolbar, .month-heading')) {
              if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.windowDrag) {
                window.webkit.messageHandlers.windowDrag.postMessage('drag');
              }
            }
          }, true);
        })();
        """
        let userScript = WKUserScript(source: dragScriptSource, injectionTime: .atDocumentEnd, forMainFrameOnly: false)
        contentController.addUserScript(userScript)
        config.userContentController = contentController

        let bounds = contentView.bounds
        let webFrame = NSRect(x: 0, y: 0, width: bounds.width, height: bounds.height - topDragBarHeight)
        webView = WKWebView(frame: webFrame, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.wantsLayer = true
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.underPageBackgroundColor = NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return isDark
                ? NSColor(calibratedRed: 20/255, green: 27/255, blue: 24/255, alpha: 1.0)
                : NSColor(calibratedRed: 248/255, green: 250/255, blue: 247/255, alpha: 1.0)
        }

        contentView.addSubview(webView)
        setupTopDragBar()
    }

    private func setupTopDragBar() {
        guard let window = self.window, let contentView = window.contentView else { return }
        let bounds = contentView.bounds
        let barFrame = NSRect(x: 0, y: bounds.height - topDragBarHeight, width: bounds.width, height: topDragBarHeight)
        topDragBar = WindowTopDragBar(frame: barFrame)
        topDragBar.autoresizingMask = [.width, .minYMargin]
        topDragBar.onRefresh = { [weak self] in
            self?.reloadPage()
        }
        contentView.addSubview(topDragBar)
    }

    private func setupProgressBar() {
        guard let window = self.window, let contentView = window.contentView else { return }
        progressIndicator = NSProgressIndicator(frame: NSRect(x: 0, y: contentView.bounds.height - topDragBarHeight - 2, width: contentView.bounds.width, height: 2))
        progressIndicator.autoresizingMask = [.width, .minYMargin]
        progressIndicator.wantsLayer = true
        progressIndicator.isIndeterminate = false
        progressIndicator.minValue = 0.0
        progressIndicator.maxValue = 1.0
        progressIndicator.style = .bar
        progressIndicator.isHidden = true
        contentView.addSubview(progressIndicator)

        observation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] _, change in
            guard let self = self, let progress = change.newValue else { return }
            self.progressIndicator.doubleValue = progress
            if progress >= 1.0 {
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = 0.2
                    self.progressIndicator.animator().alphaValue = 0.0
                } completionHandler: {
                    self.progressIndicator.isHidden = true
                    self.progressIndicator.alphaValue = 1.0
                }
            } else {
                self.progressIndicator.isHidden = false
                self.progressIndicator.alphaValue = 1.0
            }
        }

        loadingObservation = webView.observe(\.isLoading, options: [.new]) { [weak self] _, change in
            guard let self = self, let isLoading = change.newValue else { return }
            DispatchQueue.main.async {
                self.topDragBar?.setRefreshing(isLoading)
            }
        }
    }

    public func loadCurrentURL() {
        let target = MainWindowController.currentServerURL
        let request = URLRequest(url: target, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30)
        webView.load(request)
    }

    // MARK: - WKScriptMessageHandler

    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "windowDrag" {
            if let currentEvent = NSApp.currentEvent {
                self.window?.performDrag(with: currentEvent)
            }
        } else if message.name == "moaNotification" {
            handleNotificationBridgeMessage(message)
        }
    }

    private func handleNotificationBridgeMessage(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        switch action {
        case "syncEvents":
            let eventsJson = body["events"] as? String ?? "[]"
            NotificationManager.shared.syncEventsAndScheduleReminders(eventsJson: eventsJson)
        case "showNotification":
            let title = body["title"] as? String ?? "모아 캘린더"
            let options = body["options"] as? [String: Any] ?? [:]
            let bodyText = options["body"] as? String ?? ""
            let tag = options["tag"] as? String
            NotificationManager.shared.sendNotification(
                title: title,
                body: bodyText,
                identifier: tag,
                userInfo: options
            )
        case "testNotification":
            NotificationManager.shared.sendTestNotification()
        case "requestPermission":
            NotificationManager.shared.requestAuthorization(forcePrompt: true)
        default:
            break
        }
    }

    public func openEvent(id: String, date: String) {
        let escapedId = id.replacingOccurrences(of: "'", with: "\\'")
        let escapedDate = date.replacingOccurrences(of: "'", with: "\\'")
        let script = "if (typeof window.handleMoaWidgetAction === 'function') { window.handleMoaWidgetAction('view_event', '\(escapedDate)', '\(escapedId)'); }"

        if webView.isLoading {
            pendingEventToOpen = (id: id, date: date)
        } else {
            webView.evaluateJavaScript(script) { [weak self] _, error in
                if error != nil {
                    self?.pendingEventToOpen = (id: id, date: date)
                }
            }
        }
    }

    // MARK: - Native Calendar Actions triggered by Menu / Shortcuts

    public func jumpToToday() {
        webView.evaluateJavaScript("document.getElementById('today')?.click();", completionHandler: nil)
    }

    public func createNewEvent() {
        webView.evaluateJavaScript("document.getElementById('new-event')?.click() || document.getElementById('mobile-day-add')?.click();", completionHandler: nil)
    }

    public func setViewMode(_ mode: String) {
        webView.evaluateJavaScript("document.querySelector('[data-view=\"\(mode)\"]')?.click();", completionHandler: nil)
    }

    public func navigateMonth(_ direction: String) {
        let btnId = direction == "prev" ? "prev" : "next"
        webView.evaluateJavaScript("document.getElementById('\(btnId)')?.click();", completionHandler: nil)
    }

    public func reloadPage() {
        if webView.url == nil {
            loadCurrentURL()
        } else {
            webView.reload()
        }
    }

    public func zoomIn() {
        webView.pageZoom += 0.1
    }

    public func zoomOut() {
        webView.pageZoom = max(0.5, webView.pageZoom - 0.1)
    }

    public func resetZoom() {
        webView.pageZoom = 1.0
    }

    public func goBack() {
        if webView.canGoBack {
            webView.goBack()
        }
    }

    public func goForward() {
        if webView.canGoForward {
            webView.goForward()
        }
    }

    // MARK: - Server URL Configuration Alert

    public func promptForServerURL() {
        let alert = NSAlert()
        alert.messageText = "서버 접속 주소 설정"
        alert.informativeText = "모아 캘린더 서버 URL을 입력하세요. (기본값: \(MainWindowController.defaultServerURL))"
        alert.alertStyle = .informational

        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        input.stringValue = MainWindowController.currentServerURL.absoluteString
        alert.accessoryView = input

        alert.addButton(withTitle: "저장 및 접속")
        alert.addButton(withTitle: "기본값 복원")
        alert.addButton(withTitle: "취소")

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            let text = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if let newURL = URL(string: text), newURL.scheme != nil {
                MainWindowController.currentServerURL = newURL
                loadCurrentURL()
            }
        } else if response == .alertSecondButtonReturn {
            MainWindowController.currentServerURL = URL(string: MainWindowController.defaultServerURL)!
            loadCurrentURL()
        }
    }

    // MARK: - NSWindowDelegate

    public func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    // MARK: - WKNavigationDelegate

    public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {}

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let pending = pendingEventToOpen {
            pendingEventToOpen = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                self?.openEvent(id: pending.id, date: pending.date)
            }
        }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {}

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {}

    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if let scheme = url.scheme, scheme != "http" && scheme != "https" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        if navigationAction.targetFrame == nil {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    // MARK: - WKUIDelegate

    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    @available(macOS 13.0, *)
    public func webView(_ webView: WKWebView, requestNotificationPermissionFor securityOrigin: WKSecurityOrigin, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        NotificationManager.shared.requestAuthorization { granted in
            decisionHandler(granted ? .grant : .deny)
        }
    }
}

// MARK: - Native Top Window Drag Bar (28px dark green bar with refresh button)

final class TopBarIconButton: NSButton {
    private var trackingAreaRef: NSTrackingArea?
    private var isHovered = false

    override var mouseDownCanMoveWindow: Bool { false }

    override init(frame: NSRect) {
        super.init(frame: frame)
        commonInit()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        commonInit()
    }

    private func commonInit() {
        isBordered = false
        bezelStyle = .regularSquare
        imagePosition = .imageOnly
        wantsLayer = true
        layer?.cornerRadius = 5
        contentTintColor = NSColor.white.withAlphaComponent(0.9)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let existing = trackingAreaRef {
            removeTrackingArea(existing)
        }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        trackingAreaRef = area
    }

    override func mouseEntered(with event: NSEvent) {
        isHovered = true
        layer?.backgroundColor = NSColor.white.withAlphaComponent(0.16).cgColor
    }

    override func mouseExited(with event: NSEvent) {
        isHovered = false
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    override func highlight(_ flag: Bool) {
        super.highlight(flag)
        if flag {
            layer?.backgroundColor = NSColor.white.withAlphaComponent(0.24).cgColor
        } else {
            layer?.backgroundColor = isHovered ? NSColor.white.withAlphaComponent(0.16).cgColor : NSColor.clear.cgColor
        }
    }
}

final class WindowTopDragBar: NSView {
    public static let barColor = NSColor(calibratedRed: 42/255, green: 76/255, blue: 58/255, alpha: 1.0) // #2a4c3a: deep brand green
    public var onRefresh: (() -> Void)?
    private let refreshButton = TopBarIconButton(frame: .zero)

    override var mouseDownCanMoveWindow: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        setupView()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupView()
    }

    private func setupView() {
        self.wantsLayer = true
        self.layer?.backgroundColor = WindowTopDragBar.barColor.cgColor

        let symbolConfig = NSImage.SymbolConfiguration(pointSize: 12, weight: .semibold)
        if let icon = NSImage(systemSymbolName: "arrow.clockwise", accessibilityDescription: "페이지 새로고침")?
            .withSymbolConfiguration(symbolConfig) {
            refreshButton.image = icon
        } else {
            refreshButton.title = "↻"
        }
        refreshButton.toolTip = "페이지 새로고침 (⌘R)"
        refreshButton.setAccessibilityLabel("페이지 새로고침")
        refreshButton.target = self
        refreshButton.action = #selector(handleRefreshClick)
        refreshButton.translatesAutoresizingMaskIntoConstraints = false

        addSubview(refreshButton)
        NSLayoutConstraint.activate([
            refreshButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            refreshButton.centerYAnchor.constraint(equalTo: centerYAnchor),
            refreshButton.widthAnchor.constraint(equalToConstant: 24),
            refreshButton.heightAnchor.constraint(equalToConstant: 22)
        ])
    }

    public func setRefreshing(_ refreshing: Bool) {
        refreshButton.alphaValue = refreshing ? 0.55 : 1.0
    }

    @objc private func handleRefreshClick() {
        onRefresh?()
    }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 {
            window?.zoom(nil)
        } else {
            window?.performDrag(with: event)
        }
    }
}
