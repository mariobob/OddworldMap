# CLAUDE.md

Guidance for AI agents working in this repo. User-facing docs (controls, rebuild instructions, format overview) live in [README.md](README.md) — read that first; this file covers what is not obvious from the code and the traps that cost hours to find.

## Source vs generated

- Source: the viewer — `index.html`, `css/main.css` and the ES modules under `js/` (dependency-free vanilla JS, no build step; `js/main.js` is the boot entry, `js/state.js` holds shared state + world→draw transforms, and selection announces itself via a `selection-changed` window event so modules stay one-directional) — plus `tools/build_map.py`, `tools/cam2rgba.cpp` and the vendored `PSXMDECDecoder.*` / `Types.hpp`.
- Generated **and committed** (they are the site's data): `map_data_ao.json`, `map_data_ae.json`, `cams/ao/**`, `cams/ae/**`. Regenerate with the builder from disc images; never hand-edit.
- `tools/data/pathdata_ao.json` / `pathdata_ae.json`: cached level/path tables and TLV type enums parsed from the alive_reversing decompilation. Used as-is by builds; only re-parsed when the cache file is deleted, which requires an `alive_reversing` checkout as a sibling directory of this repo (AO tables come from commit `c1ba4c6c8`, AE tables from the current sources).

## Build & verify

- `npm run lint` — ESLint over the viewer modules; CI runs it on every push. There is no JS build step: the modules are served as-is, so lint is the only pre-runtime error check.
- `npm test` — `node --test` unit tests under `tests/unit/` for the DOM-free modules (`config`, `state`, `util`, `model`, `settings`): geometry transforms, TLV destinations, entry paths, permalink format, settings sanitizing, plus schema checks over the shipped data files. Those modules must stay importable in bare Node — no `window`/`document` at module top level (imports.test.js enforces this; `settings` additionally keeps its localStorage access inside guarded calls).
- `python3 tools/build_map.py --game AO|AE --disc <image.bin ...>` — AE takes both discs; env fallbacks are `$ODDWORLD_DISC_AO` / `$ODDWORLD_DISC_AE` (2352-byte-sector raw images). `cam2rgba` is compiled automatically on first run; `oxipng` must be installed (every emitted PNG is losslessly recompressed with `-o 2 --strip safe`, so byte-determinism of images also depends on the oxipng version — committed images were made with oxipng 10.x).
- The pipeline is byte-deterministic. To verify builder changes, build into a scratch dir with `--out` and `cmp` the data file (and spot-check PNGs) against the committed outputs.
- `--levels X,Y` subset builds merge into the existing data file — they do not clobber other levels.
- Existing cam PNGs are skipped for speed, so a level whose decode previously half-completed keeps stale outputs; delete `cams/<game>/<LEVEL>/` for a clean rebuild of that level.
- Alignment anchors for eyeballing viewer geometry changes: AO R2 P1 C03 — the LCDStatusBoard box sits on the LED digit panel of the Employees sign; AE MI P1 C24 — the HandStone box sits on the QuikSave stone. If object markers drift toward screen centers, a world-to-art transform regressed.

## Format gotchas (hard-won)

- AO camera cells are 1024×480 world units but the visible screen is a 368×240 window at +256/+120 inside the cell (1:1 unit:pixel; camera centers at `cell*1024+440`, `cell*480+240`). AE cells are 375×260, fully visible, scaled into 368×240 art. The viewer gets all of this from the `geometry` object in each data file — never hardcode per-game numbers in drawing code.
- PS1 cam images are 12 MDEC strips: `u16` length prefix + BS v3 frames in AO, `u32` prefix + BS v2 in AE; `cam2rgba` auto-detects the framing. Decoded strips assemble to 384×240 but only 368 columns are real (macroblock padding, cropped at build time).
- FG1 foreground blocks: AO partial chunks carry their own RGB555 pixels and whole sub-streams can be LZ-compressed; AE partial chunks are per-row `u32` bitmasks selecting camera-bitmap pixels and are never compressed.
- TLV records: 0x18-byte header with payload at +0x18 in AO; 0x10-byte header with payload at +0x10 in AE. Door numbers are only unique **per camera** — a target door must be resolved inside the destination camera or same-screen door pairs cross-wire.
- TLV type ids are per-game (Door is 6 in AO, 5 in AE; numbers overlap with unrelated types). Match objects by `name` in shared code, never by numeric id.
- Exoddus disc 1 ships `TL.LVL` as a 68-byte boot-config stub, not a LVL archive; the builder skips it. Archive reads are guarded (EOF raises, directories must fit their file) because a garbage header otherwise spins disc reads forever at end of image.
- Both Exoddus discs list every level, but each disc carries full content only for its half — the other half are stubs with path data and no cam files. Always pick the largest copy of a level across discs (the builder does).
- AE ender level ids reuse their base level's archive; the table parser deduplicates so each LVL file appears once in the level list, but TLV destinations still name the ender ids — the builder's id→short map must cover every id, not just the kept ones.

- Static site files that are not the viewer or its data: `favicon.svg` (source of truth for the icon; `favicon-96.png` and `apple-touch-icon.png` are rasterized from it), `og-image.png` (1200×630 social card, rendered by `tools/ogcard.swift` — edit the script and rerun it, don't touch the PNG directly), `site.webmanifest`, `robots.txt`, `sitemap.xml`, `CNAME` (oddworldmap.com). Regenerate the icon PNGs from the SVG if the icon changes (a CoreGraphics Swift script was used; any SVG rasterizer works).

## Conventions

- One concern per commit; split bundled diffs before committing.
- Prose files (README, docs, this file) are never manually line-wrapped — let lines run long.
- A user-facing change ships its docs in the same commit — update the relevant README.md / CLAUDE.md, and add its `changelog.json` entry (draft with `tools/changelog.py`, then curate into a player-facing headline + detail). Documenting the change is part of the same concern, not a follow-up commit.
- No game owns unsuffixed defaults: everything game-specific carries `ao`/`ae` in its name (files, JS globals, env vars, URL hashes). Do not reintroduce unsuffixed names for AO just because it came first.
- Generated JSON is pretty-printed (`indent=1`) so history stays diffable; keep the format stable.
- Prettier owns js/css/html formatting (`.prettierrc`: printWidth 100, defaults otherwise; exemptions in `.prettierignore` — `js/config.js` keeps its hand-aligned tables, JSON and Markdown keep their own formats). The version is pinned exactly in devDependencies because output is version-dependent (like oxipng for the PNGs); bump it deliberately: upgrade, reformat the tree in a dedicated commit, and add that commit to `.git-blame-ignore-revs`. New clones opt blame in once with `git config blame.ignoreRevsFile .git-blame-ignore-revs` (GitHub reads the file automatically).
- Format only the staged files before each commit, so the commit doesn't drag in formatter drift from unrelated files:
  ```
  git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(js|css|html)$' | xargs -r npx prettier --write
  ```
  then re-stage what Prettier changed. Never run whole-tree `npm run format` as part of a normal commit — whole-tree formatting belongs in its own dedicated commit (CI runs `format:check`, so drift can't accumulate).
