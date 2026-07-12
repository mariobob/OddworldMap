#!/usr/bin/env python3
"""
Oddworld: Abe's Oddysee (PS1 NTSC-U) interactive map builder.

Reads the game disc image directly, extracts every level's path data
(camera grid, TLV objects, collision lines) and camera backgrounds
(MDEC-compressed, decoded via the bundled cam2rgba tool built from
alive_reversing's PSXMDECDecoder), and emits a self-contained HTML viewer.

Usage:  python3 build_map.py [--disc <path.bin>] [--out <dir>] [--levels R2,R6]
"""
import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent          # tools/
ROOT = HERE.parent                              # repo root (the static site)
REPO = ROOT.parent / "alive_reversing"          # alive_reversing checkout (only needed to regenerate tools/data/pathdata_ao.json)
COMMIT = "c1ba4c6c812ac65992d876d68c9e2e3e85636d6f"
PATHDATA_CACHE = HERE / "data" / "pathdata_ao.json"
CAM2RGBA = HERE / "cam2rgba"

SECTOR_RAW = 2352
USER_OFF = 24

# (LevelId, short, display), listed in game progression order
# (id is the game's LevelIds enum value; the list order drives the viewer UI)
LEVELS = [
    (1, "R1", "Rupture Farms"),
    (5, "E1", "Stock Yards"),
    (2, "L1", "Monsaic Lines"),
    (3, "F1", "Paramonia"),
    (4, "F2", "Paramonian Temple"),
    (14, "F4", "Paramonia Escape"),
    (8, "D1", "Scrabania"),
    (9, "D2", "Scrabanian Temple"),
    (15, "D7", "Scrabania Escape"),
    (6, "E2", "Stock Yards Return"),
    (13, "R2", "Rupture Farms Return"),
    (12, "R6", "Board Room"),
    (10, "C1", "Credits"),
    (0, "S1", "Menu"),
]

TLV_NAMES = {
    0:"ContinuePoint",1:"PathTransition",2:"ContinueZone",3:"Hoist",4:"Edge",5:"DeathDrop",6:"Door",
    7:"ShadowZone",8:"LiftPoint",11:"WellLocal",12:"Dove",13:"RockSack",14:"ZBall",15:"FallingItem",
    18:"PullRingRope",19:"BackgroundAnimation",20:"Honey",22:"TimedMine",24:"Slig",25:"Slog",
    26:"Switch",27:"BellHammer",28:"StartController",29:"SecurityOrb",32:"LiftMudokon",
    34:"BeeSwarmHole",35:"Pulley",36:"HoneySack",37:"AbeStart",38:"ElumStart",40:"ElumWall",
    41:"SlingMudokon",42:"HoneyDripTarget",43:"Bees",45:"WellExpress",46:"Mine",47:"UXB",
    48:"Paramite",49:"Bat",50:"RingMudokon",51:"MovieStone",52:"BirdPortal",53:"BirdPortalExit",
    54:"BellSongStone",55:"TrapDoor",56:"RollingBall",57:"SligBoundLeft",58:"InvisibleZone",
    59:"RollingBallStopper",60:"FootSwitch",61:"SecurityClaw",62:"MotionDetector",66:"SligSpawner",
    67:"ElectricWall",68:"LiftMover",69:"ChimeLock",71:"MeatSack",72:"Scrab",73:"FlintLockFire",
    74:"ScrabLeftBound",75:"ScrabRightBound",76:"SligBoundRight",77:"SligPersist",79:"EnemyStopper",
    81:"InvisibleSwitch",82:"Mudokon",83:"ZSligCover",84:"DoorFlame",86:"MovingBomb",
    87:"MovingBombStopper",88:"MeatSaw",89:"MudokonPathTrans",90:"MenuController",92:"HintFly",
    93:"ScrabNoFall",94:"IdSplitter",95:"SecurityDoor",96:"DemoPlaybackStone",97:"BoomMachine",
    98:"LCDScreen",99:"ElumPathTrans",100:"HandStone",101:"CreditsController",102:"Preloader",
    103:"LCDStatusBoard",105:"MusicTrigger",106:"LightEffect",107:"SlogSpawner",108:"DeathClock",
    109:"RingCancel",110:"GasEmitter",111:"SlogHut",112:"Glukkon",113:"KillUnsavedMuds",
    114:"SoftLanding",115:"ResetPath",
}

LEVEL_SHORT = {i: s for i, s, _ in LEVELS}

# ---------------------------------------------------------------- disc access

class Disc:
    def __init__(self, path):
        self.f = open(path, "rb")
        pvd = self.sector(16)
        assert pvd[1:6] == b"CD001", "not an ISO9660 raw image"
        root = pvd[156:156+34]
        lba = struct.unpack_from("<I", root, 2)[0]
        size = struct.unpack_from("<I", root, 10)[0]
        self.files = {}
        self._read_dir(lba, size, "")

    def sector(self, lba):
        self.f.seek(lba * SECTOR_RAW)
        return self.f.read(SECTOR_RAW)[USER_OFF:USER_OFF + 2048]

    def read(self, lba, size):
        out = bytearray()
        while len(out) < size:
            out += self.sector(lba)
            lba += 1
        return bytes(out[:size])

    def _read_dir(self, lba, size, prefix):
        data = self.read(lba, size)
        pos = 0
        while pos < len(data):
            ln = data[pos]
            if ln == 0:
                pos = (pos // 2048 + 1) * 2048
                if pos >= len(data):
                    break
                continue
            e_lba = struct.unpack_from("<I", data, pos + 2)[0]
            e_size = struct.unpack_from("<I", data, pos + 10)[0]
            flags = data[pos + 25]
            name_len = data[pos + 32]
            name = data[pos + 33:pos + 33 + name_len].decode("ascii", "replace")
            if name not in ("\x00", "\x01"):
                if flags & 2:
                    self._read_dir(e_lba, e_size, prefix + name + "/")
                else:
                    self.files[name.split(";")[0].upper()] = (e_lba, e_size)
            pos += ln

class Lvl:
    def __init__(self, disc, name):
        self.disc = disc
        self.lba, self.size = disc.files[name.upper()]
        hdr = disc.sector(self.lba)
        num_files = struct.unpack_from("<I", hdr, 16)[0]
        dir_bytes = disc.read(self.lba, 32 + num_files * 24)
        self.files = {}
        for i in range(num_files):
            off = 32 + i * 24
            nm = dir_bytes[off:off+12].split(b"\0")[0].decode("ascii", "replace")
            start_sec, num_sec, fsize = struct.unpack_from("<iii", dir_bytes, off + 12)
            self.files[nm] = (start_sec, fsize)

    def read(self, name):
        start_sec, fsize = self.files[name]
        return self.disc.read(self.lba + start_sec, fsize)

def parse_chunks(data):
    chunks = {}
    pos = 0
    while pos + 16 <= len(data):
        size, ref, flags, typ, rid = struct.unpack_from("<IHHII", data, pos)
        tag = struct.pack("<I", typ).decode("latin1")
        if tag == "End!" or size < 16 or pos + size > len(data):
            break
        chunks.setdefault((tag, rid), data[pos+16:pos+size])
        pos += size
    return chunks

# ------------------------------------------------- PathData.cpp table parsing

def load_pathdata():
    """per-level path tables; cached as JSON so builds don't need an alive_reversing checkout"""
    if PATHDATA_CACHE.exists():
        raw = json.loads(PATHDATA_CACHE.read_text())
        return {short: {int(k): v for k, v in paths.items()} for short, paths in raw.items()}
    out = parse_pathdata_cpp()
    PATHDATA_CACHE.parent.mkdir(exist_ok=True)
    PATHDATA_CACHE.write_text(json.dumps(out, indent=1))
    return out

def parse_pathdata_cpp():
    src = subprocess.run(["git", "-C", str(REPO), "show", f"{COMMIT}:Source/AliveLibAO/PathData.cpp"],
                         capture_output=True, text=True, check=True).stdout

    def int_rows(body):
        rows = []
        for m in re.finditer(r"\{([^{}]*)\}", body):
            toks = [t.strip() for t in m.group(1).split(",")]
            nums = [int(t) for t in toks if re.fullmatch(r"-?\d+", t)]
            rows.append(nums)
        return rows

    path_arrays = {}
    for m in re.finditer(r"PathData\s+(\w+)\[\]\s*=\s*\{(.*?)\n\};", src, re.S):
        path_arrays[m.group(1)] = int_rows(m.group(2))
    coll_arrays = {}
    for m in re.finditer(r"CollisionInfo\s+(\w+)\[\d*\]\s*=\s*\{(.*?)\n\};", src, re.S):
        coll_arrays[m.group(1)] = int_rows(m.group(2))

    bly_arrays = {}
    for m in re.finditer(r"PathBlyRec\s+(\w+)\[\d*\]\s*=\s*\{(.*?)\n\};", src, re.S):
        entries = []
        for rm in re.finditer(r"\{([^{}]*)\}", m.group(2)):
            row = rm.group(1)
            bm = re.search(r'"([^"]+)"\s*,\s*&(\w+)\[(\d+)\]\s*,\s*&(\w+)\[(\d+)\]', row)
            if bm:
                entries.append((bm.group(1), bm.group(2), int(bm.group(3)), bm.group(4), int(bm.group(5))))
            else:
                entries.append(None)
        bly_arrays[m.group(1)] = entries

    # gMapData rows -> map short level name to bly array
    level_bly = {}
    gm = re.search(r"PathRootContainer gMapData_4CAB58\s*=\s*\{(.*?)\n\};", src, re.S)
    for rm in re.finditer(r"\{\s*(\w+)\s*,[^{}]*?\"(\w+)\",\s*(\d+),", gm.group(1)):
        level_bly[rm.group(2)] = (rm.group(1), int(rm.group(3)))

    out = {}
    for short, (bly_name, num_paths) in level_bly.items():
        paths = {}
        arr = bly_arrays.get(bly_name, [])
        for path_id, e in enumerate(arr):
            if not e:
                continue
            bly, parr, pidx, carr, cidx = e
            pd = path_arrays[parr][pidx]
            cd = coll_arrays[carr][cidx]
            # PathData nums: [bLeft,bRight,bTop,bBottom,gw,gh,1024,480,obj_off,idx_off]
            # CollisionInfo nums: [left,right,top,bottom,coll_off,coll_count,gw,gh]
            paths[path_id] = {
                "bly": bly,
                "w_units": pd[2], "h_units": pd[3],
                "obj_off": pd[8], "idx_off": pd[9],
                "coll_off": cd[4], "coll_count": cd[5],
            }
        out[short] = paths
    return out

# ------------------------------------------------------------- TLV extraction

def tlv_extra(t, blob, pos, length):
    """decode useful payload fields per type"""
    def s16s(n, off=0x18):
        cnt = min(n, (length - off) // 2)
        return struct.unpack_from(f"<{cnt}h", blob, pos + off) if cnt > 0 else ()
    e = {}
    if t == 6:
        v = s16s(8)
        if len(v) >= 7:
            e = {"to_level": LEVEL_SHORT.get(v[0], v[0]), "to_path": v[1], "to_cam": v[2],
                 "door#": v[4] & 0xFFFF, "target_door#": v[6]}
    elif t == 1:
        v = s16s(3)
        if len(v) >= 2:
            e = {"to_level": LEVEL_SHORT.get(v[0], v[0]), "to_path": v[1]}
    elif t in (26,):
        v = s16s(2)
        if v: e = {"switch_id": v[0], "action": v[1] if len(v) > 1 else None}
    elif t in (81, 60):
        v = s16s(2)
        if v: e = {"switch_id": v[0]}
    elif t == 0:
        v = s16s(3)
        if v: e = {"zone": v[0]}
    elif t == 51:
        v = s16s(1)
        if v: e = {"movie": v[0]}
    elif t == 45:  # WellExpress: off/on destinations (level/path/camera), switched by trigger id
        v = s16s(13)
        if len(v) >= 13:
            def dest(lv, pa, ca):
                # level 0 is the menu; wells never really go there (zeroed fields)
                return {"to_level": LEVEL_SHORT.get(lv, lv), "to_path": pa, "to_cam": ca} \
                    if 1 <= lv <= 15 else {}
            e = dest(v[6], v[7], v[8])
            on = dest(v[10], v[11], v[12])
            if on and on != e:
                e.update({"alt_level": on["to_level"], "alt_path": on["to_path"], "alt_cam": on["to_cam"]})
            e["trigger_id"] = v[1]
    elif t == 52:  # BirdPortal: side, dest level/path/camera, scale, movie, type
        v = s16s(7)
        if len(v) >= 7:
            kind = {0: "travel", 1: "rescue", 2: "shrykull"}.get(v[6], v[6])
            e = {"portal": kind}
            if v[6] == 0:  # only travel portals have a real destination
                e.update({"to_level": LEVEL_SHORT.get(v[1], v[1]), "to_path": v[2], "to_cam": v[3]})
    if not e:
        v = s16s(6)
        e = {"raw": " ".join(str(x) for x in v)} if v else {}
    return e

def walk_obj_region(blob, obj_off, region_end):
    """linear walk of the packed TLV region with resync on garbage"""
    tlvs = []
    pos = obj_off
    end = min(region_end, len(blob))
    while pos + 0x18 <= end:
        flags, unk, length, typ32 = struct.unpack_from("<BBhI", blob, pos)
        t = typ32 & 0xFFFF
        if 24 <= length <= 480 and t <= 115 and not (flags & ~7):
            x1, y1, x2, y2 = struct.unpack_from("<hhhh", blob, pos + 0x10)
            tlvs.append({"t": t, "name": TLV_NAMES.get(t, f"type{t}"),
                         "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                         "extra": tlv_extra(t, blob, pos, length)})
            pos += length
        else:
            pos += 2  # resync
    return tlvs

# --------------------------------------------------------------- PNG encoding

def write_png(path, w, h, rgba):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    rgba = bytearray(rgba)
    for i in range(3, len(rgba), 4):
        rgba[i] = 255
    scan = b"".join(b"\x00" + bytes(rgba[y*w*4:(y+1)*w*4]) for y in range(h))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(scan, 6))
           + chunk(b"IEND", b""))
    Path(path).write_bytes(png)
    # lossless recompression (~30% smaller); pixel data is unchanged by design
    subprocess.run([OXIPNG, "-o", "2", "--strip", "safe", "-q", str(path)], check=True)

def decode_cam(lvl, cam_name, out_png, tmpdir):
    try:
        cam = lvl.read(cam_name + ".CAM")
    except KeyError:
        return False
    chunks = parse_chunks(cam)
    bits = next((v for (tag, _), v in chunks.items() if tag == "Bits"), None)
    if not bits:
        return False
    bits_file = tmpdir / "cam.bits"
    rgba_file = tmpdir / "cam.rgba"
    bits_file.write_bytes(bits)
    r = subprocess.run([str(CAM2RGBA), str(bits_file), str(rgba_file)], capture_output=True)
    if r.returncode != 0:
        print(f"    ! cam decode failed: {cam_name}")
        return False
    raw = rgba_file.read_bytes()
    w, h = struct.unpack_from("<II", raw, 0)
    rgba = raw[8:]
    # the MDEC stream pads 368 visible columns up to 384 (24 macroblocks);
    # crop the junk columns off before writing
    VISIBLE_W = 368
    if w > VISIBLE_W:
        rgba = b"".join(rgba[y*w*4:(y*w + VISIBLE_W)*4] for y in range(h))
        w = VISIBLE_W
    write_png(out_png, w, h, rgba)
    return True

# ----------------------------------------------------------------------- main

OXIPNG = shutil.which("oxipng")

def ensure_tools():
    global OXIPNG
    OXIPNG = shutil.which("oxipng")
    if not OXIPNG:
        sys.exit("oxipng is required so rebuilds stay byte-identical to the committed images "
                 "(brew install oxipng / cargo install oxipng)")
    if CAM2RGBA.exists():
        return
    print("compiling cam2rgba...")
    subprocess.run(["c++", "-O2", "-std=c++17", f"-I{HERE}", "-include", "Types.hpp",
                    str(HERE / "cam2rgba.cpp"), str(HERE / "PSXMDECDecoder.cpp"),
                    "-o", str(CAM2RGBA)], check=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--disc", default=os.environ.get("ODDWORLD_DISC"),
                    help="path to a raw PS1 disc image (.bin, 2352-byte sectors); "
                         "defaults to $ODDWORLD_DISC")
    ap.add_argument("--out", default=str(ROOT))
    ap.add_argument("--levels", default="", help="comma list of level shorts to limit (e.g. R2,R6)")
    args = ap.parse_args()
    if not args.disc:
        ap.error("no disc image: pass --disc or set $ODDWORLD_DISC")

    ensure_tools()
    out = Path(args.out)
    (out / "cams/ao").mkdir(parents=True, exist_ok=True)
    tmpdir = HERE / ".tmp"
    tmpdir.mkdir(exist_ok=True)

    only = set(s.strip().upper() for s in args.levels.split(",") if s.strip())
    disc = Disc(args.disc)
    tables = load_pathdata()

    data = {"game": "Oddworld: Abe's Oddysee (PS1 NTSC-U)", "levels": []}
    for lid, short, display in LEVELS:
        if only and short not in only:
            continue
        if short not in tables:
            continue
        lvl_file = f"{short}.LVL"
        if lvl_file.upper() not in disc.files:
            print(f"{short}: no {lvl_file} on disc, skipping")
            continue
        print(f"=== {short} ({display}) ===")
        lvl = Lvl(disc, lvl_file)
        bnd_name = f"{short}PATH.BND"
        if bnd_name not in lvl.files:
            print(f"  no {bnd_name}, skipping")
            continue
        chunks = parse_chunks(lvl.read(bnd_name))
        (out / "cams/ao" / short).mkdir(exist_ok=True)

        level_entry = {"id": lid, "short": short, "name": display, "paths": []}
        for path_id, meta in sorted(tables[short].items()):
            key = ("Path", path_id)
            if key not in chunks:
                continue
            blob = chunks[key]
            W = max(1, meta["w_units"] // 1024)
            H = max(1, meta["h_units"] // 480)
            n = W * H

            # camera name table
            cells = []
            for i in range(n):
                nm = blob[i*8:(i+1)*8].decode("latin1").strip("\0 ")
                nm = nm if re.fullmatch(r"[A-Z0-9]{4,8}", nm or "") else None
                cells.append(nm)

            # collision lines (20 bytes each)
            lines = []
            co, cc = meta["coll_off"], meta["coll_count"]
            for i in range(cc):
                p = co + i * 20
                if p + 20 > len(blob):
                    break
                x1, y1, x2, y2 = struct.unpack_from("<hhhh", blob, p)
                ltype = blob[p + 8]
                lines.append([x1, y1, x2, y2, ltype])

            # TLVs: linear walk of object region
            region_end = meta["idx_off"] if meta["idx_off"] > meta["obj_off"] else len(blob)
            tlvs = walk_obj_region(blob, meta["obj_off"], region_end)

            # cameras
            cams = []
            for i, nm in enumerate(cells):
                if not nm:
                    continue
                png_rel = f"cams/ao/{short}/{nm}.png"
                png_path = out / png_rel
                ok = png_path.exists() or decode_cam(lvl, nm, png_path, tmpdir)
                cams.append({"cell": i, "name": nm, "png": png_rel if ok else None})

            print(f"  path {path_id}: {W}x{H} cams={sum(1 for c in cells if c)} tlvs={len(tlvs)} lines={len(lines)}")
            level_entry["paths"].append({
                "id": path_id, "w": W, "h": H,
                "cams": cams, "tlvs": tlvs, "lines": lines,
            })
        if level_entry["paths"]:
            data["levels"].append(level_entry)

    # subset builds merge into existing data instead of clobbering other levels
    data_file = out / "map_data_ao.js"
    if only and data_file.exists():
        old = json.loads(data_file.read_text()[len("window.MAP_DATA_AO = "):-1])
        built = {L["short"]: L for L in data["levels"]}
        merged = [built.get(L["short"], L) for L in old["levels"]]
        have = {L["short"] for L in merged}
        merged += [L for L in data["levels"] if L["short"] not in have]
        data["levels"] = merged
    data_file.write_text("window.MAP_DATA_AO = " + json.dumps(data, indent=1) + ";")
    print(f"\ndone -> {out}/index.html")

if __name__ == "__main__":
    main()
