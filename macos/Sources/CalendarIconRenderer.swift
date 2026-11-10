import AppKit
import Foundation

public final class CalendarIconRenderer {
    public static let signatureGreen = NSColor(calibratedRed: 56/255, green: 102/255, blue: 78/255, alpha: 1.0) // #38664e
    public static let darkText = NSColor(calibratedRed: 36/255, green: 54/255, blue: 44/255, alpha: 1.0)       // #24362c
    public static let softBg = NSColor.white

    public static func renderIcon(date: Date = Date(), size: CGFloat = 512, forDock: Bool = false) -> NSImage {
        let image = NSImage(size: NSSize(width: size, height: size))
        image.lockFocus()

        let scale = size / 512.0

        // 1. Fill canvas closely (tight inset ~12px on 512x512)
        let cardInset: CGFloat = 12.0 * scale
        let cardRect = NSRect(
            x: cardInset,
            y: cardInset,
            width: size - (cardInset * 2),
            height: size - (cardInset * 2)
        )
        let cornerRadius: CGFloat = 104.0 * scale

        // 2. Drop shadow for depth on macOS desktop / dock
        let shadow = NSShadow()
        shadow.shadowColor = NSColor(calibratedWhite: 0, alpha: 0.18)
        shadow.shadowOffset = NSSize(width: 0, height: -4 * scale)
        shadow.shadowBlurRadius = 10 * scale
        shadow.set()

        // 3. White Card Base
        let path = NSBezierPath(roundedRect: cardRect, xRadius: cornerRadius, yRadius: cornerRadius)
        softBg.setFill()
        path.fill()

        // Reset shadow
        NSShadow().set()

        // 4. Thick signature green outline (Border)
        let borderWidth: CGFloat = max(2.5, 20.0 * scale)
        signatureGreen.setStroke()
        let innerRadius = max(0, cornerRadius - borderWidth / 2)
        let borderPath = NSBezierPath(
            roundedRect: cardRect.insetBy(dx: borderWidth / 2, dy: borderWidth / 2),
            xRadius: innerRadius,
            yRadius: innerRadius
        )
        borderPath.lineWidth = borderWidth
        borderPath.stroke()

        // 5. Clip to card bounds for header & content
        NSGraphicsContext.saveGraphicsState()
        path.addClip()

        // 6. Header banner (Signature Green) - fills upper portion of card
        let headerHeight: CGFloat = 152.0 * scale
        let headerRect = NSRect(
            x: cardRect.minX,
            y: cardRect.maxY - headerHeight,
            width: cardRect.width,
            height: headerHeight
        )
        signatureGreen.setFill()
        headerRect.fill()

        // 7. Day of week ("화요일" or localized) - very large, bold, crystal clear white
        let weekdayFormatter = DateFormatter()
        weekdayFormatter.locale = Locale(identifier: "ko_KR")
        weekdayFormatter.dateFormat = size < 64 ? "E" : "EEEE"
        let weekdayStr = weekdayFormatter.string(from: date)

        let headerStyle = NSMutableParagraphStyle()
        headerStyle.alignment = .center
        let headerFontSize = max(14.0, 84.0 * scale)
        let headerFont = NSFont.systemFont(ofSize: headerFontSize, weight: .heavy)
        let headerAttrs: [NSAttributedString.Key: Any] = [
            .font: headerFont,
            .foregroundColor: NSColor.white,
            .paragraphStyle: headerStyle
        ]
        let headerTextSize = (weekdayStr as NSString).size(withAttributes: headerAttrs)
        let headerTextY = headerRect.minY + (headerHeight - headerTextSize.height) / 2
        let headerTextRect = NSRect(x: headerRect.minX, y: headerTextY, width: headerRect.width, height: headerTextSize.height)
        (weekdayStr as NSString).draw(in: headerTextRect, withAttributes: headerAttrs)

        // 8. Huge Date Number (Center)
        let dayFormatter = DateFormatter()
        dayFormatter.dateFormat = "d"
        let dayStr = dayFormatter.string(from: date)

        let dayStyle = NSMutableParagraphStyle()
        dayStyle.alignment = .center
        let dayFontSize = max(20.0, 230.0 * scale)
        let dayFont = NSFont.systemFont(ofSize: dayFontSize, weight: .heavy)
        let dayAttrs: [NSAttributedString.Key: Any] = [
            .font: dayFont,
            .foregroundColor: darkText,
            .paragraphStyle: dayStyle
        ]
        let dayTextSize = (dayStr as NSString).size(withAttributes: dayAttrs)
        let dayAreaHeight = cardRect.maxY - headerHeight - cardRect.minY
        let dayTextY = cardRect.minY + (dayAreaHeight - dayTextSize.height) / 2 + (21.0 * scale)
        let dayTextRect = NSRect(x: cardRect.minX, y: dayTextY, width: cardRect.width, height: dayTextSize.height)
        (dayStr as NSString).draw(in: dayTextRect, withAttributes: dayAttrs)

        NSGraphicsContext.restoreGraphicsState()

        image.unlockFocus()
        return image
    }
}
