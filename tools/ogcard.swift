// Renders og-image.png, the 1200×630 social card, with CoreGraphics/CoreText (macOS).
// Run: swift tools/ogcard.swift og-image.png && oxipng -o 2 --strip safe og-image.png
import Foundation
import CoreGraphics
import ImageIO
import CoreText
import UniformTypeIdentifiers

guard CommandLine.arguments.count > 1 else {
  FileHandle.standardError.write(Data("usage: swift tools/ogcard.swift <out.png>\n".utf8))
  exit(1)
}
let outPath = CommandLine.arguments[1]
let W = 1200, H = 630
let cs = CGColorSpaceCreateDeviceRGB()
let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                    space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
func col(_ hex: UInt32,_ a: CGFloat = 1) -> CGColor {
  CGColor(red: CGFloat((hex>>16)&255)/255, green: CGFloat((hex>>8)&255)/255, blue: CGFloat(hex&255)/255, alpha: a)
}
// background
ctx.setFillColor(col(0x14161a)); ctx.fill(CGRect(x:0,y:0,width:W,height:H))
// faint camera grid (evokes the map)
ctx.setStrokeColor(col(0xffffff, 0.05)); ctx.setLineWidth(2)
for gx in stride(from: 0, through: W, by: 120) { ctx.move(to: CGPoint(x:CGFloat(gx),y:0)); ctx.addLine(to: CGPoint(x:CGFloat(gx),y:CGFloat(H))) }
for gy in stride(from: 0, through: H, by: 120) { ctx.move(to: CGPoint(x:0,y:CGFloat(gy))); ctx.addLine(to: CGPoint(x:CGFloat(W),y:CGFloat(gy))) }
ctx.strokePath()
// object marker boxes scattered (the viewer's visual language)
let boxes: [(CGFloat,CGFloat,CGFloat,CGFloat,UInt32)] = [
  (90,120,70,70,0xff3860),(230,150,54,54,0x3ec6ff),(150,300,60,60,0xffd23e),
  (90,430,80,44,0xff8b3d),(250,400,50,50,0x5dde75),(300,250,46,46,0xc85dff),
]
ctx.setLineWidth(4)
for (x,y,w,h,c) in boxes {
  ctx.setStrokeColor(col(c)); ctx.setFillColor(col(c,0.14))
  let r = CGRect(x:x,y:CGFloat(H)-y-h,width:w,height:h)
  ctx.fill(r); ctx.stroke(r)
}

func text(_ str: String,_ x: CGFloat,_ y: CGFloat,_ sizePt: CGFloat,_ hex: UInt32, bold: Bool = false) {
  let font = CTFontCreateWithName((bold ? "HelveticaNeue-Bold" : "HelveticaNeue") as CFString, sizePt, nil)
  let attr = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: col(hex)] as CFDictionary
  let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, str as CFString, attr)!)
  ctx.textPosition = CGPoint(x:x, y:CGFloat(H)-y)
  CTLineDraw(line, ctx)
}
text("ODDWORLD MAP", 470, 250, 74, 0xe8a33d, bold: true)
text("Interactive map — Abe's Oddysee & Exoddus", 472, 322, 30, 0xd8dbe2)
text("Every camera, object and collision line,", 472, 372, 27, 0x8a8f9c)
text("extracted straight from the game discs.", 472, 408, 27, 0x8a8f9c)
text("oddworldmap.com", 472, 500, 30, 0x8cbb7f, bold: true)

let img = ctx.makeImage()!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, img, nil); CGImageDestinationFinalize(dest)
print("wrote \(outPath)")
