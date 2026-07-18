// Renders the social banners with CoreGraphics/CoreText (macOS), in the same
// visual language as og-image.png (tools/ogcard.swift).
//
//   swift tools/banner.swift youtube  banner-youtube.png   # 2048x1152
//   swift tools/banner.swift x        banner-x.png         # 1500x500
//   swift tools/banner.swift github   banner-github.png    # 1280x640
//   swift tools/banner.swift 1600x900 banner-custom.png    # any size
//   then: oxipng -o 2 --strip safe <out.png>
//
// Every layout is driven by one rule: the text block is scaled to fit a
// "content box", and decoration is scattered only outside it. Each platform
// crops differently, so the content box is where that platform promises
// nothing will be cut:
//   youtube — only the centre 1235x338 survives on phones (TVs see it all)
//   x       — the profile avatar is punched into the bottom-left corner
//   github  — 40pt (80px here) border recommended on all sides
// Output is deterministic: the decoration uses a fixed PRNG seed, so rerunning
// reproduces the same bytes.
import Foundation
import CoreGraphics
import ImageIO
import CoreText
import UniformTypeIdentifiers

// ---------------------------------------------------------------- presets

struct Preset {
    let size: CGSize
    /// where text may be drawn; everything outside is croppable decoration
    let content: CGRect
    let gridCell: CGFloat

    static func named(_ name: String) -> Preset? {
        switch name {
        case "youtube":  // centre safe box: 1235x338 of 2048x1152
            return Preset(size: CGSize(width: 2048, height: 1152),
                          content: CGRect(x: 406, y: 407, width: 1235, height: 338),
                          gridCell: 128)
        case "x":  // dodge the avatar in the bottom-left (~270x170)
            return Preset(size: CGSize(width: 1500, height: 500),
                          content: CGRect(x: 300, y: 40, width: 1140, height: 380),
                          gridCell: 100)
        case "github":  // GitHub asks for a 40pt border, 80px at 2x
            return Preset(size: CGSize(width: 1280, height: 640),
                          content: CGRect(x: 80, y: 80, width: 1120, height: 480),
                          gridCell: 100)
        default:
            return parseSize(name).map(custom)
        }
    }

    /// "1600x900" -> 1600x900; nil when the argument isn't a size
    private static func parseSize(_ s: String) -> CGSize? {
        let parts = s.lowercased().split(separator: "x")
        guard parts.count == 2, let w = Int(parts[0]), let h = Int(parts[1]),
              w > 0, h > 0 else { return nil }
        return CGSize(width: w, height: h)
    }

    /// unknown platform: inset a tenth on each side and hope for the best
    private static func custom(_ size: CGSize) -> Preset {
        let inset = CGSize(width: size.width * 0.1, height: size.height * 0.1)
        return Preset(size: size,
                      content: CGRect(x: inset.width, y: inset.height,
                                      width: size.width - inset.width * 2,
                                      height: size.height - inset.height * 2),
                      gridCell: max(60, size.width / 16))
    }
}

// ---------------------------------------------------------------- arguments

let usage = "usage: swift tools/banner.swift <youtube|x|github|WIDTHxHEIGHT> <out.png>\n"
guard CommandLine.arguments.count > 2, let preset = Preset.named(CommandLine.arguments[1]) else {
    FileHandle.standardError.write(Data(usage.utf8))
    exit(1)
}
let outPath = CommandLine.arguments[2]
let W = Int(preset.size.width), H = Int(preset.size.height)

// ---------------------------------------------------------------- canvas

let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!

func colour(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
}

/// CoreGraphics puts the origin bottom-left; the layout above reads top-down
func flip(_ r: CGRect) -> CGRect {
    CGRect(x: r.minX, y: preset.size.height - r.maxY, width: r.width, height: r.height)
}

let ink = (title: UInt32(0xe8a33d), body: UInt32(0xd8dbe2), dim: UInt32(0x8a8f9c))
ctx.setFillColor(colour(0x14161a))
ctx.fill(CGRect(origin: .zero, size: preset.size))

// ---------------------------------------------------------------- decoration

// faint camera grid — the map's own backdrop
ctx.setStrokeColor(colour(0xffffff, 0.05))
ctx.setLineWidth(2)
for x in stride(from: 0, through: preset.size.width, by: preset.gridCell) {
    ctx.move(to: CGPoint(x: x, y: 0)); ctx.addLine(to: CGPoint(x: x, y: preset.size.height))
}
for y in stride(from: 0, through: preset.size.height, by: preset.gridCell) {
    ctx.move(to: CGPoint(x: 0, y: y)); ctx.addLine(to: CGPoint(x: preset.size.width, y: y))
}
ctx.strokePath()

/// fixed-seed generator keeps reruns byte-identical
struct Rng {
    private var state: UInt64 = 0xABE0DD
    mutating func next(_ limit: CGFloat) -> CGFloat {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return CGFloat(Double(state >> 33) / Double(UInt64(1) << 31)) * limit
    }
}

// object markers in the viewer's category colours, scattered in the margins
let markerColours: [UInt32] = [0xff3860, 0x3ec6ff, 0xffd23e, 0x5dde75, 0xff8b3d, 0xc85dff]
let keepClear = preset.content.insetBy(dx: -preset.size.width * 0.02,
                                       dy: -preset.size.height * 0.04)
let markerScale = min(preset.size.width, preset.size.height) / 12
var rng = Rng()
var placed: [CGRect] = []
ctx.setLineWidth(max(3, markerScale / 18))
for attempt in 0..<400 where placed.count < 12 {
    let w = markerScale * (0.5 + rng.next(0.6))
    let h = w * (rng.next(1) < 0.25 ? 0.55 : 1)  // the odd wide box, like a DeathDrop
    // stay off the canvas edge, so a marker never reads as accidentally clipped
    let margin = markerScale * 0.3
    let box = CGRect(x: margin + rng.next(preset.size.width - w - margin * 2),
                     y: margin + rng.next(preset.size.height - h - margin * 2),
                     width: w, height: h)
    let crowded = placed.contains { $0.insetBy(dx: -markerScale * 0.4, dy: -markerScale * 0.4).intersects(box) }
    guard !box.intersects(keepClear), !crowded else { continue }
    placed.append(box)
    let c = markerColours[attempt % markerColours.count]
    ctx.setStrokeColor(colour(c)); ctx.setFillColor(colour(c, 0.14))
    ctx.fill(flip(box)); ctx.stroke(flip(box))
}

// ---------------------------------------------------------------- text block

struct Line {
    let text: String
    let size: CGFloat  // at scale 1; the block is scaled to fit the content box
    let colour: UInt32
    let bold: Bool
    let gapAfter: CGFloat
}

let lines = [
    Line(text: "ODDWORLD MAP", size: 104, colour: ink.title, bold: true, gapAfter: 26),
    Line(text: "Interactive map — Abe's Oddysee & Exoddus", size: 42, colour: ink.body, bold: false, gapAfter: 18),
    Line(text: "Every camera, object and collision line, extracted straight from the game discs.",
         size: 30, colour: ink.dim, bold: false, gapAfter: 36),
    Line(text: "oddworldmap.com", size: 40, colour: ink.title, bold: true, gapAfter: 0),
]

func typeset(_ line: Line, scale: CGFloat) -> CTLine {
    let name = (line.bold ? "HelveticaNeue-Bold" : "HelveticaNeue") as CFString
    let font = CTFontCreateWithName(name, line.size * scale, nil)
    let attributes = [kCTFontAttributeName: font,
                      kCTForegroundColorAttributeName: colour(line.colour)] as CFDictionary
    return CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, line.text as CFString, attributes)!)
}
func width(_ l: CTLine) -> CGFloat { CGFloat(CTLineGetTypographicBounds(l, nil, nil, nil)) }

// scale the whole block so it fits the content box in both axes
let naturalWidth = lines.map { width(typeset($0, scale: 1)) }.max() ?? 1
let naturalHeight = lines.reduce(0) { $0 + $1.size + $1.gapAfter }
let scale = min(preset.content.width / naturalWidth, preset.content.height / naturalHeight)

var baseline = preset.content.midY - (naturalHeight * scale) / 2
for line in lines {
    baseline += line.size * scale
    let typeset = typeset(line, scale: scale)
    ctx.textPosition = CGPoint(x: preset.content.midX - width(typeset) / 2,
                               y: preset.size.height - baseline)
    CTLineDraw(typeset, ctx)
    baseline += line.gapAfter * scale
}

// ---------------------------------------------------------------- output

let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL,
                                                  UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, ctx.makeImage()!, nil)
CGImageDestinationFinalize(destination)
print("wrote \(outPath) (\(W)x\(H))")
