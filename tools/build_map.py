#!/usr/bin/env python3
"""
Oddworld interactive map builder (PS1 NTSC-U).

Reads game disc images directly, extracts every level's path data
(camera grid, TLV objects, collision lines) and camera backgrounds
(MDEC-compressed, decoded via the bundled cam2rgba tool built from
alive_reversing's PSXMDECDecoder), and emits the data files for the viewer.

Supports both games:
  python3 build_map.py --game AO --disc "Oddworld - Abe's Oddysee.bin"
  python3 build_map.py --game AE --disc "Exoddus (Disc 1).bin" "Exoddus (Disc 2).bin"

--disc defaults to $ODDWORLD_DISC_AO (AO) / $ODDWORLD_DISC_AE (AE, os.pathsep-separated).
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
REPO = ROOT.parent / "alive_reversing"          # alive_reversing checkout (only needed to regenerate tools/data caches)
AO_COMMIT = "c1ba4c6c812ac65992d876d68c9e2e3e85636d6f"
CAM2RGBA = HERE / "cam2rgba"

SECTOR_RAW = 2352
USER_OFF = 24

# (LevelId, short, display), listed in game progression order
# (id is the game's LevelIds enum value; the list order drives the viewer UI)
AO_LEVELS = [
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

AO_TLV_NAMES = {
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

AE_LEVEL_DISPLAY = {
    0: "Menu", 1: "Necrum Mines", 2: "Necrum", 3: "Mudomo Vault", 4: "Mudanchee Vault",
    5: "FeeCo Depot", 6: "Slig Barracks", 7: "Mudanchee Vault Ender", 8: "Bonewerkz",
    9: "SoulStorm Brewery", 10: "Brewery Ender", 11: "Mudomo Vault Ender",
    12: "FeeCo Depot Ender", 13: "Barracks Ender", 14: "Bonewerkz Ender",
    15: "Test Level", 16: "Credits",
}
# base levels followed by their enders, mirroring the playthrough
AE_LEVEL_ORDER = [1, 2, 3, 11, 4, 7, 5, 12, 6, 13, 8, 14, 9, 10, 16, 0, 15]

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
            sec = self.sector(lba)
            if not sec:
                raise EOFError(f"read past end of image at LBA {lba}")
            out += sec
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
        if 32 + num_files * 24 > self.size:
            raise ValueError(f"{name}: directory does not fit the file, not a LVL archive")
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

def int_rows(body):
    rows = []
    for m in re.finditer(r"\{([^{}]*)\}", body):
        toks = [t.strip() for t in m.group(1).split(",")]
        nums = [int(t) for t in toks if re.fullmatch(r"-?\d+", t)]
        rows.append(nums)
    return rows

def parse_pathdata_cpp_ao():
    src = subprocess.run(["git", "-C", str(REPO), "show", f"{AO_COMMIT}:Source/AliveLibAO/PathData.cpp"],
                         capture_output=True, text=True, check=True).stdout

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

def parse_pathdata_cpp_ae():
    """AE tables live in the alive_reversing working tree (the decomp's primary target)"""
    src = (REPO / "Source/AliveLibAE/PathData.cpp").read_text()
    hpp = (REPO / "Source/AliveLibAE/Path.hpp").read_text()

    def positional_rows(body):
        """entries are either a null-identifier or a braced row; index = path id"""
        rows = []
        for m in re.finditer(r"kNull\w+|\{[^{}]*\}", body):
            tok = m.group(0)
            rows.append(None if tok.startswith("kNull") else
                        [int(t) for t in (x.strip() for x in tok[1:-1].split(",")) if re.fullmatch(r"-?\d+", t)])
        return rows

    path_arrays = {}
    for m in re.finditer(r"static PathData (\w+)_PathData\[\w*\] = \{(.*?\})\s*,?\s*\};", src, re.S):
        path_arrays[m.group(1)] = positional_rows(m.group(2))
    coll_arrays = {}
    for m in re.finditer(r"static CollisionInfo (\w+)_CollisionInfo\[\w*\] = \{(.*?\})\s*,?\s*\};", src, re.S):
        coll_arrays[m.group(1)] = positional_rows(m.group(2))
    bly_arrays = {}
    for m in re.finditer(r"static PathBlyRec (\w+)_PathBlyRecInfo\[\w*\] = \{(.*?\})\s*,?\s*\};", src, re.S):
        entries = []
        for em in re.finditer(r"kNullPathBlyRec|\{[^{}]*\}", m.group(2)):
            tok = em.group(0)
            bm = re.search(r'"([^"]+)"\s*,\s*&(\w+)_PathData\[(\d+)\]\s*,\s*&(\w+)_CollisionInfo\[(\d+)\]', tok)
            entries.append((bm.group(1), bm.group(2), int(bm.group(3)), bm.group(4), int(bm.group(5))) if bm else None)
        bly_arrays[m.group(1)] = entries

    # root container: level id order -> (bly prefix == level short, num paths)
    gm = re.search(r"PathRootContainer\s+\w+\s*=\s*\{(.*?)\};", src, re.S)
    roots = []
    for rm in re.finditer(r"\{\s*(\w+_PathBlyRecInfo|nullptr)[^{}]*\}", gm.group(1)):
        row = rm.group(0)
        prefix = rm.group(1).replace("_PathBlyRecInfo", "") if rm.group(1) != "nullptr" else None
        sm = re.search(r'"([A-Z0-9]{2})"\s*,\s*(\d+)\s*,', row)
        roots.append((prefix, sm.group(1) if sm else None, int(sm.group(2)) if sm else 0))

    tables = {}
    levels = []
    for level_id, (bly_prefix, short, num_paths) in enumerate(roots):
        if not bly_prefix or not short:
            continue
        paths = {}
        for path_id, e in enumerate(bly_arrays.get(bly_prefix, [])):
            if not e:
                continue
            bly, parr, pidx, carr, cidx = e
            pd = path_arrays[parr][pidx]
            cd = coll_arrays[carr][cidx]
            # PathData nums: [bLeft,bRight,bTop,bBottom,375,260,375,260,obj_off,idx_off,abe_x,abe_y]
            paths[path_id] = {
                "bly": bly,
                "w_units": pd[2], "h_units": pd[3],
                "obj_off": pd[8], "idx_off": pd[9],
                "coll_off": cd[4], "coll_count": cd[5],
            }
        if paths:
            tables[short] = paths
            levels.append([level_id, short, AE_LEVEL_DISPLAY.get(level_id, short)])

    # TLV type names from the enum (identifiers end in _<id>)
    tlv_names = {}
    em = re.search(r"enum class TlvTypes : s16\s*\{(.*?)\n\};", hpp, re.S)
    for nm in re.finditer(r"(\w+?)_(\d+)\s*=\s*(\d+)", em.group(1)):
        tlv_names[int(nm.group(3))] = nm.group(1)

    order = {lid: i for i, lid in enumerate(AE_LEVEL_ORDER)}
    levels.sort(key=lambda l: order.get(l[0], 99))
    # ender level ids reuse their base level's archive; keep one entry per archive
    seen, unique = set(), []
    for lid, short, display in levels:
        if short not in seen:
            seen.add(short)
            unique.append([lid, short, display])
    return {"levels": unique, "tlv_names": tlv_names, "tables": tables}

def load_cache(game):
    cache = HERE / "data" / game["cache"]
    if cache.exists():
        return json.loads(cache.read_text())
    out = game["parse_tables"]()
    cache.parent.mkdir(exist_ok=True)
    cache.write_text(json.dumps(out, indent=1))
    return out

# ------------------------------------------------------------- TLV extraction

def tlv_extra_ao(t, blob, pos, length, level_short):
    """decode useful payload fields per type (payload starts at +0x18)"""
    def s16s(n, off=0x18):
        cnt = min(n, (length - off) // 2)
        return struct.unpack_from(f"<{cnt}h", blob, pos + off) if cnt > 0 else ()
    e = {}
    if t == 6:
        v = s16s(8)
        if len(v) >= 7:
            e = {"to_level": level_short.get(v[0], v[0]), "to_path": v[1], "to_cam": v[2],
                 "door#": v[4] & 0xFFFF, "target_door#": v[6]}
    elif t == 1:
        v = s16s(3)
        if len(v) >= 2:
            e = {"to_level": level_short.get(v[0], v[0]), "to_path": v[1]}
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
                return {"to_level": level_short.get(lv, lv), "to_path": pa, "to_cam": ca} \
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
                e.update({"to_level": level_short.get(v[1], v[1]), "to_path": v[2], "to_cam": v[3]})
    if not e:
        v = s16s(6)
        e = {"raw": " ".join(str(x) for x in v)} if v else {}
    return e

def tlv_extra_ae(t, blob, pos, length, level_short):
    """decode useful payload fields per type (payload starts at +0x10)"""
    def s16s(n, off=0x10):
        cnt = min(n, (length - off) // 2)
        return struct.unpack_from(f"<{cnt}h", blob, pos + off) if cnt > 0 else ()
    def dest(lv, pa, ca):
        return {"to_level": level_short.get(lv, lv), "to_path": pa, "to_cam": ca} \
            if 1 <= lv <= 16 else {}
    e = {}
    if t == 5:  # Door: level, path, camera, scale, door#, switch id, target door
        v = s16s(7)
        if len(v) >= 7:
            e = {"to_level": level_short.get(v[0], v[0]), "to_path": v[1], "to_cam": v[2],
                 "door#": v[4] & 0xFFFF, "target_door#": v[6]}
            if v[5]:
                e["switch_id"] = v[5]
    elif t == 1:  # PathTransition
        v = s16s(3)
        if len(v) >= 2:
            e = {"to_level": level_short.get(v[0], v[0]), "to_path": v[1]}
    elif t == 17:  # Lever: action, scale, sounds..., switch id
        v = s16s(6)
        if len(v) >= 6:
            e = {"switch_id": v[5], "action": v[0]}
    elif t == 23:  # WellExpress: WellBase then exit x/y, disabled dest, enabled dest
        v = s16s(14)
        if len(v) >= 14:
            e = dest(v[6], v[7], v[8])
            on = dest(v[10], v[11], v[12])
            if on and on != e:
                e.update({"alt_level": on["to_level"], "alt_path": on["to_path"], "alt_cam": on["to_cam"]})
            e["switch_id"] = v[1]
    elif t == 88:  # Teleporter: own id, other id, camera, path, level, switch id
        v = s16s(6)
        if len(v) >= 6:
            e = {"tp#": v[0], "target_tp#": v[1]}
            e.update(dest(v[4], v[3], v[2]))
            if v[5]:
                e["switch_id"] = v[5]
    elif t == 28:  # BirdPortal: side, dest level/path/camera, scale, movie, type
        v = s16s(7)
        if len(v) >= 7:
            e = {"portal": {0: "travel", 1: "rescue", 2: "shrykull"}.get(v[6], v[6])}
            e.update(dest(v[1], v[2], v[3]))
    if not e:
        v = s16s(6)
        e = {"raw": " ".join(str(x) for x in v)} if v else {}
    return e

def walk_obj_region(blob, obj_off, region_end, game, level_short):
    """linear walk of the packed TLV region with resync on garbage"""
    fmt = game["tlv"]
    rect_off, payload = fmt["rect_off"], fmt["extra_fn"]
    min_len, max_len, max_type = fmt["min_len"], fmt["max_len"], fmt["max_type"]
    names = game["tlv_names"]
    tlvs = []
    pos = obj_off
    end = min(region_end, len(blob))
    while pos + fmt["header_len"] <= end:
        flags, unk, length, typ32 = struct.unpack_from("<BBhI", blob, pos)
        t = typ32 & 0xFFFF
        flags_ok = not (flags & ~7) if fmt["check_flags"] else True
        if min_len <= length <= max_len and t <= max_type and flags_ok:
            x1, y1, x2, y2 = struct.unpack_from("<hhhh", blob, pos + rect_off)
            tlvs.append({"t": t, "name": names.get(t, f"type{t}"),
                         "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                         "extra": payload(t, blob, pos, length, level_short)})
            pos += length
        else:
            pos += 2  # resync
    return tlvs

# --------------------------------------------------------------- PNG encoding

def write_png(path, w, h, rgba, keep_alpha=False):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    rgba = bytearray(rgba)
    if not keep_alpha:
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

def decompress_4or5(data):
    """alive LZ variant: 0xxxxxxx = literals run, 1xxxxxyy yyyyyyyy = back-copy"""
    dst_len = struct.unpack_from("<I", data, 0)[0]
    out = bytearray()
    pos = 4
    while len(out) < dst_len and pos < len(data):
        c = data[pos]; pos += 1
        if c & 0x80:
            n = ((c & 0x7C) >> 2) + 3
            back = ((c & 0x03) << 8) + data[pos] + 1; pos += 1
            start = len(out) - back
            for i in range(n):
                out.append(out[start + i])
        else:
            n = c + 1
            out += data[pos:pos + n]
            pos += n
    return bytes(out)

def rgb555(px):
    r = (px & 0x1F) << 3; g = ((px >> 5) & 0x1F) << 3; b = ((px >> 10) & 0x1F) << 3
    return bytes((r | r >> 5, g | g >> 5, b | b >> 5, 255))

def decode_fg1(fg1, cam_rgba, w, h, bitmask_format):
    """walk an FG1 chunk stream, return overlay RGBA (or None if empty).

    Partial blocks carry RGB555 pixels in AO and per-row u32 bitmasks (over the
    camera bitmap) in AE; compressed sub-streams only exist in AO."""
    overlay = bytearray(w * h * 4)
    any_px = False
    stack = []          # saved (buffer, pos) while inside compressed sub-streams
    buf, pos = fg1, 4   # skip u32 count
    while True:
        if pos + 12 > len(buf):
            if stack: buf, pos = stack.pop(); continue
            break
        typ, layer, x, y, cw, ch = struct.unpack_from("<HHhhHH", buf, pos)
        if typ == 0xFFFF:            # end
            if stack: buf, pos = stack.pop(); continue
            break
        if typ == 0xFFFC:            # end of compressed sub-stream
            buf, pos = stack.pop(); continue
        if typ == 0xFFFD:            # compressed sub-stream (layer=decomp size, x=comp size)
            sub = decompress_4or5(buf[pos + 12:pos + 12 + (x & 0xFFFF)])
            stack.append((buf, pos + 12 + (x & 0xFFFF)))
            buf, pos = sub, 0
            continue
        if typ == 0xFFFE:            # full block: copy cam pixels
            for j in range(ch):
                yy = y + j
                if not (0 <= yy < h): continue
                x0 = max(0, x); x1 = min(w, x + cw)
                if x1 > x0:
                    o = (yy * w + x0) * 4
                    overlay[o:o + (x1 - x0) * 4] = cam_rgba[o:o + (x1 - x0) * 4]
                    any_px = True
            pos += 12
            continue
        if typ == 0:                 # partial block
            if bitmask_format:       # AE: one u32 bitmask per row selecting cam pixels
                if pos + 12 + ch * 4 > len(buf):
                    break            # truncated chunk
                for j in range(ch):
                    yy = y + j
                    if not (0 <= yy < h): continue
                    bits = struct.unpack_from("<I", buf, pos + 12 + j * 4)[0]
                    for i in range(min(cw, 32)):
                        if bits >> i & 1:
                            xx = x + i
                            if 0 <= xx < w:
                                o = (yy * w + xx) * 4
                                overlay[o:o + 4] = cam_rgba[o:o + 4]
                                any_px = True
                pos += 12 + ch * 4
            else:                    # AO: own RGB555 pixels follow
                px_off = pos + 12
                if px_off + cw * ch * 2 > len(buf):
                    break            # truncated chunk
                for j in range(ch):
                    yy = y + j
                    for i in range(cw):
                        px = struct.unpack_from("<H", buf, px_off + (j * cw + i) * 2)[0]
                        if px == 0: continue
                        xx = x + i
                        if 0 <= xx < w and 0 <= yy < h:
                            overlay[(yy * w + xx) * 4:(yy * w + xx) * 4 + 4] = rgb555(px)
                            any_px = True
                pos = px_off + cw * ch * 2
            continue
        # unknown chunk type: bail out of this stream
        if stack: buf, pos = stack.pop(); continue
        break
    return bytes(overlay) if any_px else None

def decode_cam(lvl, cam_name, out_png, tmpdir, bitmask_fg1):
    try:
        cam = lvl.read(cam_name + ".CAM")
    except KeyError:
        print(f"    ! cam file missing: {cam_name}.CAM")
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

    # foreground occlusion overlay from the FG1 chunk(s)
    fg_png = out_png.with_name(out_png.stem + "_fg.png")
    fg_parts = [v for (tag, _), v in chunks.items() if tag == "FG1 "]
    overlay = None
    for part in fg_parts:
        got = decode_fg1(part, rgba, w, h, bitmask_fg1)
        if got is None:
            continue
        if overlay is None:
            overlay = bytearray(got)
        else:
            for px in range(0, len(got), 4):
                if got[px + 3]:
                    overlay[px:px + 4] = got[px:px + 4]
    if overlay:
        write_png(fg_png, w, h, bytes(overlay), keep_alpha=True)
    return True

# ------------------------------------------------------------- game profiles

GAMES = {
    "AO": {
        "title": "Oddworld: Abe's Oddysee (PS1 NTSC-U)",
        "data_file": "map_data_ao.js",
        "js_var": "MAP_DATA_AO",
        "cams_dir": "cams/ao",
        "cache": "pathdata_ao.json",
        "env": "ODDWORLD_DISC_AO",
        "geometry": {"cellW": 368, "cellH": 240, "worldW": 1024, "worldH": 480,
                     "winX": 256, "winY": 120, "visW": 368, "visH": 240},
        "tlv": {"header_len": 0x18, "rect_off": 0x10, "min_len": 24, "max_len": 480,
                "max_type": 115, "check_flags": True, "extra_fn": tlv_extra_ao},
        "fg1_bitmask": False,
        "parse_tables": parse_pathdata_cpp_ao,
    },
    "AE": {
        "title": "Oddworld: Abe's Exoddus (PS1 NTSC-U)",
        "data_file": "map_data_ae.js",
        "js_var": "MAP_DATA_AE",
        "cams_dir": "cams/ae",
        "cache": "pathdata_ae.json",
        "env": "ODDWORLD_DISC_AE",
        "geometry": {"cellW": 368, "cellH": 240, "worldW": 375, "worldH": 260,
                     "winX": 0, "winY": 0, "visW": 375, "visH": 260},
        "tlv": {"header_len": 0x10, "rect_off": 0x08, "min_len": 16, "max_len": 512,
                "max_type": 150, "check_flags": False, "extra_fn": tlv_extra_ae},
        "fg1_bitmask": True,
        "parse_tables": parse_pathdata_cpp_ae,
    },
}

def game_setup(game_key):
    """resolve per-game level list, tlv names and tables (loading the cache)"""
    game = dict(GAMES[game_key])
    cache = load_cache(game)
    if game_key == "AO":
        game["levels"] = AO_LEVELS
        game["tlv_names"] = AO_TLV_NAMES
        game["tables"] = {short: {int(k): v for k, v in paths.items()} for short, paths in cache.items()}
    else:
        game["levels"] = [tuple(l) for l in cache["levels"]]
        game["tlv_names"] = {int(k): v for k, v in cache["tlv_names"].items()}
        game["tables"] = {short: {int(k): v for k, v in paths.items()} for short, paths in cache["tables"].items()}
        game["tlv"] = dict(game["tlv"])
        game["tlv"]["max_type"] = max(game["tlv_names"])
    game["level_short"] = {lid: s for lid, s, _ in game["levels"]}
    return game

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
    ap.add_argument("--game", default="AO", choices=sorted(GAMES),
                    help="which game to build (default AO)")
    ap.add_argument("--disc", nargs="+",
                    help="raw PS1 disc image(s) (.bin, 2352-byte sectors); AE takes both discs. "
                         "Defaults to $ODDWORLD_DISC_AO / $ODDWORLD_DISC_AE")
    ap.add_argument("--out", default=str(ROOT))
    ap.add_argument("--levels", default="", help="comma list of level shorts to limit (e.g. R2,R6)")
    args = ap.parse_args()

    game = game_setup(args.game)
    discs_arg = args.disc or [p for p in os.environ.get(game["env"], "").split(os.pathsep) if p]
    if not discs_arg:
        ap.error(f"no disc image: pass --disc or set ${game['env']}")

    ensure_tools()
    out = Path(args.out)
    (out / game["cams_dir"]).mkdir(parents=True, exist_ok=True)
    tmpdir = HERE / ".tmp"
    tmpdir.mkdir(exist_ok=True)

    only = set(s.strip().upper() for s in args.levels.split(",") if s.strip())
    discs = [Disc(p) for p in discs_arg]
    tables = game["tables"]
    level_short = game["level_short"]

    data = {"id": args.game, "game": game["title"], "geometry": game["geometry"], "levels": []}
    for lid, short, display in game["levels"]:
        if only and short not in only:
            continue
        if short not in tables:
            continue
        lvl_file = f"{short}.LVL"
        # multi-disc games carry stub copies of the other disc's levels
        # (paths present, cam files absent), so pick the largest instance
        having = [d for d in discs if lvl_file.upper() in d.files]
        if not having:
            print(f"{short}: no {lvl_file} on disc, skipping")
            continue
        disc = max(having, key=lambda d: d.files[lvl_file.upper()][1])
        print(f"=== {short} ({display}) ===")
        try:
            lvl = Lvl(disc, lvl_file)
        except (ValueError, EOFError) as ex:
            print(f"  skipping: {ex}")
            continue
        bnd_name = f"{short}PATH.BND"
        if bnd_name not in lvl.files:
            print(f"  no {bnd_name}, skipping")
            continue
        chunks = parse_chunks(lvl.read(bnd_name))
        (out / game["cams_dir"] / short).mkdir(parents=True, exist_ok=True)

        cell_w, cell_h = game["geometry"]["worldW"], game["geometry"]["worldH"]
        level_entry = {"id": lid, "short": short, "name": display, "paths": []}
        for path_id, meta in sorted(tables[short].items()):
            key = ("Path", path_id)
            if key not in chunks:
                continue
            blob = chunks[key]
            W = max(1, meta["w_units"] // cell_w)
            H = max(1, meta["h_units"] // cell_h)
            n = W * H

            # camera name table
            cells = []
            for i in range(n):
                nm = blob[i*8:(i+1)*8].decode("latin1").strip("\0 ")
                nm = nm if re.fullmatch(r"[A-Z0-9]{4,8}", nm or "") else None
                cells.append(nm)

            # collision lines (20 bytes each; coords + type share the layout in both games)
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
            tlvs = walk_obj_region(blob, meta["obj_off"], region_end, game, level_short)

            # cameras
            cams = []
            for i, nm in enumerate(cells):
                if not nm:
                    continue
                png_rel = f"{game['cams_dir']}/{short}/{nm}.png"
                png_path = out / png_rel
                ok = png_path.exists() or decode_cam(lvl, nm, png_path, tmpdir, game["fg1_bitmask"])
                entry = {"cell": i, "name": nm, "png": png_rel if ok else None}
                if (out / f"{game['cams_dir']}/{short}/{nm}_fg.png").exists():
                    entry["fg"] = f"{game['cams_dir']}/{short}/{nm}_fg.png"
                cams.append(entry)

            print(f"  path {path_id}: {W}x{H} cams={sum(1 for c in cells if c)} tlvs={len(tlvs)} lines={len(lines)}")
            level_entry["paths"].append({
                "id": path_id, "w": W, "h": H,
                "cams": cams, "tlvs": tlvs, "lines": lines,
            })
        if level_entry["paths"]:
            data["levels"].append(level_entry)

    # subset builds merge into existing data instead of clobbering other levels
    prefix = f"window.{game['js_var']} = "
    data_file = out / game["data_file"]
    if only and data_file.exists():
        old = json.loads(data_file.read_text()[len(prefix):-1])
        built = {L["short"]: L for L in data["levels"]}
        merged = [built.get(L["short"], L) for L in old["levels"]]
        have = {L["short"] for L in merged}
        merged += [L for L in data["levels"] if L["short"] not in have]
        data["levels"] = merged
    data_file.write_text(prefix + json.dumps(data, indent=1) + ";")
    print(f"\ndone -> {out}/index.html")

if __name__ == "__main__":
    main()
