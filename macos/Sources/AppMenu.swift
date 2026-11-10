import AppKit

public final class AppMenu {
    public static func setupMenu(delegate: AppDelegate, windowController: MainWindowController) {
        let mainMenu = NSMenu()

        // 1. App Submenu
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu

        let appName = "모아 캘린더"
        appMenu.addItem(withTitle: "\(appName)에 관하여", action: #selector(delegate.showAbout), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        let prefItem = NSMenuItem(title: "서버 설정...", action: #selector(delegate.showPreferences), keyEquivalent: ",")
        appMenu.addItem(prefItem)
        appMenu.addItem(NSMenuItem.separator())

        let servicesItem = NSMenuItem(title: "서비스", action: nil, keyEquivalent: "")
        let servicesMenu = NSMenu()
        servicesItem.submenu = servicesMenu
        NSApp.servicesMenu = servicesMenu
        appMenu.addItem(servicesItem)
        appMenu.addItem(NSMenuItem.separator())

        appMenu.addItem(withTitle: "\(appName) 가리기", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthersItem = NSMenuItem(title: "기타 가리기", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthersItem.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthersItem)
        appMenu.addItem(withTitle: "모두 보기", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "\(appName) 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        // 2. File Submenu
        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "파일")
        fileMenuItem.submenu = fileMenu

        fileMenu.addItem(withTitle: "새 일정 만들기...", action: #selector(delegate.createNewEvent), keyEquivalent: "n")
        fileMenu.addItem(NSMenuItem.separator())
        fileMenu.addItem(withTitle: "창 닫기", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

        // 3. Edit Submenu
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "편집")
        editMenuItem.submenu = editMenu
        editMenu.addItem(withTitle: "실행 취소", action: Selector(("undo:")), keyEquivalent: "z")
        let redoItem = NSMenuItem(title: "실행 복귀", action: Selector(("redo:")), keyEquivalent: "z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redoItem)
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "오려두기", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "복사", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "붙여넣기", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "모두 선택", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        // 4. View Submenu
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "보기")
        viewMenuItem.submenu = viewMenu

        viewMenu.addItem(withTitle: "페이지 새로고침", action: #selector(delegate.reloadPage), keyEquivalent: "r")
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(withTitle: "실제 크기", action: #selector(delegate.resetZoom), keyEquivalent: "0")
        viewMenu.addItem(withTitle: "확대", action: #selector(delegate.zoomIn), keyEquivalent: "+")
        let zoomInAlt = NSMenuItem(title: "확대", action: #selector(delegate.zoomIn), keyEquivalent: "=")
        zoomInAlt.isAlternate = true
        viewMenu.addItem(zoomInAlt)
        viewMenu.addItem(withTitle: "축소", action: #selector(delegate.zoomOut), keyEquivalent: "-")
        viewMenu.addItem(NSMenuItem.separator())
        let fullScreenItem = NSMenuItem(title: "전체 화면 시작", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreenItem.keyEquivalentModifierMask = [.command, .control]
        viewMenu.addItem(fullScreenItem)

        // 5. Calendar Submenu (Specialized shortcuts)
        let calMenuItem = NSMenuItem()
        mainMenu.addItem(calMenuItem)
        let calMenu = NSMenu(title: "캘린더")
        calMenuItem.submenu = calMenu

        calMenu.addItem(withTitle: "오늘로 이동", action: #selector(delegate.jumpToToday), keyEquivalent: "t")
        calMenu.addItem(NSMenuItem.separator())
        calMenu.addItem(withTitle: "일간 보기", action: #selector(delegate.selectDayView), keyEquivalent: "1")
        calMenu.addItem(withTitle: "주간 보기", action: #selector(delegate.selectWeekView), keyEquivalent: "2")
        calMenu.addItem(withTitle: "월간 보기", action: #selector(delegate.selectMonthView), keyEquivalent: "3")
        calMenu.addItem(NSMenuItem.separator())
        calMenu.addItem(withTitle: "이전 달", action: #selector(delegate.prevMonth), keyEquivalent: "[")
        calMenu.addItem(withTitle: "다음 달", action: #selector(delegate.nextMonth), keyEquivalent: "]")

        // 6. Window Submenu
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "윈도우")
        windowMenuItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "최소화", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "확대/축소", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(NSMenuItem.separator())
        windowMenu.addItem(withTitle: "모두 앞으로 가져오기", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")

        // 7. Help Submenu
        let helpMenuItem = NSMenuItem()
        mainMenu.addItem(helpMenuItem)
        let helpMenu = NSMenu(title: "도움말")
        helpMenuItem.submenu = helpMenu
        helpMenu.addItem(withTitle: "모아 캘린더 웹사이트 방문...", action: #selector(delegate.openWebsite), keyEquivalent: "")

        NSApp.mainMenu = mainMenu
    }
}
