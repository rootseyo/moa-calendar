import AppKit
import Foundation

// Keep Android launcher artwork derived from the installed web app icon.
// Run from the repository root: swift scripts/generate-android-icons.swift
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let resources = root.appendingPathComponent("android/app/src/main/res")
let sourceURL = root.appendingPathComponent("public/icons/icon-512.png")
let source = NSBitmapImageRep(data: try Data(contentsOf: sourceURL))!
let image = NSImage(size: NSSize(width: 512, height: 512))
image.addRepresentation(source)
let background = source.colorAt(x: 256, y: 32)!.usingColorSpace(.deviceRGB)!
let greenFloor = min(background.redComponent, background.greenComponent, background.blueComponent)

func render(size: Int, draw: () -> Void) -> NSBitmapImageRep {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSGraphicsContext.current!.imageInterpolation = .high
    draw()
    NSGraphicsContext.restoreGraphicsState()
    return bitmap
}
func save(_ bitmap: NSBitmapImageRep, _ path: String) throws {
    try bitmap.representation(using: .png, properties: [:])!.write(to: resources.appendingPathComponent(path))
}
for (density, size) in [("mdpi",48),("hdpi",72),("xhdpi",96),("xxhdpi",144),("xxxhdpi",192)] {
    let bitmap = render(size: size) {
        image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
    }
    try save(bitmap, "mipmap-\(density)/ic_launcher.png")
    try save(bitmap, "mipmap-\(density)/ic_launcher_round.png")
}
// Separate the white calendar glyph from the green background, including the
// divider and m-shaped holes. The same alpha mask supports themed icons.
let glyph = render(size: 512) {}
for y in 0..<512 {
    for x in 0..<512 {
        let pixel = source.colorAt(x: x, y: y)!.usingColorSpace(.deviceRGB)!
        let floor = min(pixel.redComponent, pixel.greenComponent, pixel.blueComponent)
        let coverage = max(0, min(1, (floor - greenFloor) / (1 - greenFloor))) * pixel.alphaComponent
        glyph.setColor(NSColor(deviceRed: 1, green: 1, blue: 1, alpha: coverage), atX: x, y: y)
    }
}
let glyphImage = NSImage(size: NSSize(width: 512, height: 512))
glyphImage.addRepresentation(glyph)
// Adaptive layers are 108dp. The visible 72dp area retains the web proportions.
let adaptive = render(size: 432) {
    glyphImage.draw(in: NSRect(x: 72, y: 72, width: 288, height: 288))
}
try save(adaptive, "drawable-nodpi/moa_launcher_glyph.png")
let rgb = [background.redComponent, background.greenComponent, background.blueComponent].map { Int(($0 * 255).rounded()) }
let backgroundHex = String(format: "#%02X%02X%02X", rgb[0], rgb[1], rgb[2])
let backgroundXML = """
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="\(backgroundHex)" />
</shape>

"""
try backgroundXML.write(to: resources.appendingPathComponent("drawable/ic_launcher_background.xml"), atomically: true, encoding: .utf8)
print("Generated Android launcher icons from public/icons/icon-512.png (background \(backgroundHex)).")
