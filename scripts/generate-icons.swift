import AppKit
import Foundation

let output = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "public")
let green = NSColor(calibratedRed: 56/255, green: 102/255, blue: 78/255, alpha: 1)
func rounded(_ rect: NSRect, _ radius: CGFloat, _ color: NSColor) {
 color.setFill(); NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
}
func mark(_ rect: NSRect) {
 NSGraphicsContext.saveGraphicsState()
 let transform = NSAffineTransform()
 transform.translateX(by: rect.minX, yBy: rect.minY)
 transform.concat()
 let scale = NSAffineTransform()
 scale.scaleX(by: rect.width/512, yBy: rect.height/512)
 scale.concat()
 rounded(NSRect(x: 116, y: 112, width: 280, height: 276), 38, .white)
 rounded(NSRect(x: 116, y: 306, width: 280, height: 8), 0, green)
 rounded(NSRect(x: 176, y: 360, width: 20, height: 60), 10, .white)
 rounded(NSRect(x: 316, y: 360, width: 20, height: 60), 10, .white)
 let m = NSBezierPath()
 m.move(to: NSPoint(x: 172, y: 174)); m.line(to: NSPoint(x: 172, y: 252))
 m.curve(to: NSPoint(x: 254, y: 234), controlPoint1: NSPoint(x: 172, y: 290), controlPoint2: NSPoint(x: 254, y: 290))
 m.line(to: NSPoint(x: 254, y: 174)); m.move(to: NSPoint(x: 254, y: 234))
 m.curve(to: NSPoint(x: 336, y: 234), controlPoint1: NSPoint(x: 254, y: 290), controlPoint2: NSPoint(x: 336, y: 290))
 m.line(to: NSPoint(x: 336, y: 174)); m.lineWidth = 22; m.lineCapStyle = .round; green.setStroke(); m.stroke()
 NSGraphicsContext.restoreGraphicsState()
}
func png(_ name: String, width: Int, height: Int, draw: () -> Void) {
 let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
 NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
 draw(); NSGraphicsContext.restoreGraphicsState()
 try! bitmap.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent(name))
}
for size in [32, 48, 180, 192, 512] {
 let name = size == 180 ? "icons/apple-touch-icon.png" : size < 100 ? "icons/favicon-\(size).png" : "icons/icon-\(size).png"
 png(name, width: size, height: size) {
  let s = CGFloat(size); rounded(NSRect(x: 0, y: 0, width: s, height: s), s * 0.20, green)
  mark(NSRect(x: 0, y: 0, width: s, height: s))
 }
}
// ICO directory containing PNG images for browser fallback.
func littleEndian(_ value: UInt32, bytes: Int) -> Data {
 Data((0..<bytes).map { UInt8((value >> ($0 * 8)) & 255) })
}
let faviconSizes = [32, 48]
let faviconImages = faviconSizes.map { try! Data(contentsOf: output.appendingPathComponent("icons/favicon-\($0).png")) }
var ico = Data([0, 0, 1, 0, 2, 0])
var offset = 6 + faviconImages.count * 16
for (size, data) in zip(faviconSizes, faviconImages) {
 ico.append(contentsOf: [UInt8(size), UInt8(size), 0, 0, 1, 0, 32, 0])
 ico.append(littleEndian(UInt32(data.count), bytes: 4))
 ico.append(littleEndian(UInt32(offset), bytes: 4))
 offset += data.count
}
faviconImages.forEach { ico.append($0) }
try! ico.write(to: output.appendingPathComponent("favicon.ico"))
png("icons/icon-maskable-512.png", width: 512, height: 512) {
 green.setFill(); NSRect(x: 0, y: 0, width: 512, height: 512).fill()
 mark(NSRect(x: 36, y: 36, width: 440, height: 440))
}
png("og-image.png", width: 1200, height: 630) {
 NSColor(calibratedRed: 245/255, green: 247/255, blue: 241/255, alpha: 1).setFill()
 NSRect(x: 0, y: 0, width: 1200, height: 630).fill()
 rounded(NSRect(x: 88, y: 211, width: 208, height: 208), 44, green)
 mark(NSRect(x: 88, y: 211, width: 208, height: 208))
 func text(_ text: String, x: CGFloat, y: CGFloat, size: CGFloat, weight: NSFont.Weight, color: NSColor) {
  (text as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color])
 }
 text("모아 캘린더", x: 356, y: 345, size: 64, weight: .bold, color: green)
 text("각자의 하루를, 우리의 시간으로.", x: 360, y: 275, size: 32, weight: .medium, color: green)
 text("링크 하나로 초대하고, 실시간으로 일정을 공유하세요.", x: 360, y: 225, size: 22, weight: .regular, color: .darkGray)
 text("dwm.brightnetworks.kr", x: 90, y: 66, size: 20, weight: .medium, color: green)
}
