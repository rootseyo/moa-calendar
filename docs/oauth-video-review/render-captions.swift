import AppKit
import Foundation

let planURL = URL(fileURLWithPath: CommandLine.arguments[1])
let items = try JSONSerialization.jsonObject(with: Data(contentsOf: planURL)) as! [[String: Any]]
for item in items {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1920, pixelsHigh: 80,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSColor(calibratedRed: 0.05, green: 0.09, blue: 0.12, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: 1920, height: 80).fill()
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    style.lineSpacing = 2
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 26, weight: .medium),
        .foregroundColor: NSColor.white,
        .paragraphStyle: style
    ]
    (item["text"] as! NSString).draw(in: NSRect(x: 40, y: 6, width: 1840, height: 68), withAttributes: attributes)
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: item["image"] as! String))
}
print("Rendered \(items.count) English caption cards.")
