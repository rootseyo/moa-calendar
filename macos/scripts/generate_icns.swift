import AppKit
import Foundation

@main
struct IconGenerator {
    static func main() {
        let fileManager = FileManager.default
        let outputDir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "macos/Resources")
        let iconsetDir = outputDir.appendingPathComponent("AppIcon.iconset")

        try? fileManager.removeItem(at: iconsetDir)
        do {
            try fileManager.createDirectory(at: iconsetDir, withIntermediateDirectories: true)
        } catch {
            fatalError("Could not create directory: \(error)")
        }

        let targetDate = Date()
        let specs: [(name: String, pixelSize: CGFloat, logicalSize: CGFloat)] = [
            ("icon_16x16.png", 16, 16),
            ("icon_16x16@2x.png", 32, 16),
            ("icon_32x32.png", 32, 32),
            ("icon_32x32@2x.png", 64, 32),
            ("icon_128x128.png", 128, 128),
            ("icon_128x128@2x.png", 256, 128),
            ("icon_256x256.png", 256, 256),
            ("icon_256x256@2x.png", 512, 256),
            ("icon_512x512.png", 512, 512),
            ("icon_512x512@2x.png", 1024, 512)
        ]

        for spec in specs {
            let img = CalendarIconRenderer.renderIcon(date: targetDate, size: spec.pixelSize, forDock: false)
            guard let tiff = img.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else {
                fatalError("Failed to render PNG for \(spec.name)")
            }
            let fileUrl = iconsetDir.appendingPathComponent(spec.name)
            do {
                try png.write(to: fileUrl)
            } catch {
                fatalError("Failed to write \(spec.name): \(error)")
            }
        }

        // Run iconutil to create .icns
        let icnsUrl = outputDir.appendingPathComponent("AppIcon.icns")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
        process.arguments = ["-c", "icns", iconsetDir.path, "-o", icnsUrl.path]
        do {
            try process.run()
            process.waitUntilExit()
            if process.terminationStatus == 0 {
                print("✅ AppIcon.icns generated successfully at: \(icnsUrl.path)")
                try? fileManager.removeItem(at: iconsetDir)
            } else {
                fatalError("iconutil failed with code \(process.terminationStatus)")
            }
        } catch {
            fatalError("Failed to execute iconutil: \(error)")
        }
    }
}
