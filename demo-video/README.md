# Setu — Launch Film (demo-video)

A 3:00 product-launch film for Setu, built with [HyperFrames](https://github.com/heygen-com/hyperframes):
real prototype footage (scripted Playwright captures) + motion-graphics scenes, composed in `index.html`
as one deterministic GSAP timeline.

## Output

- `renders/setu-launch-60fps.mp4` — final 1920×1080 @ 60fps, 3:00. Footage is a single fused master (assets/clips/acts-60.mp4) with one continuous camera.
- `renders/setu-launch-60fps-subs.mp4` — same film with burned captions.

## Captions

- `captions/setu-launch.ass` — styled source of truth (Calibri 1.2rem ≈ 19px @1080p, white on black strip @ 78% opacity, bottom-center, 6–8 words/cue). `captions/setu-launch.srt` is the plain twin for players/uploads.
- Cues are timed to the act boundaries + click cues; every quoted rule matches what the prototype actually shows on screen (KYC 730-day rule in ingestion/inspector, incident-reporting 6→2 hrs in the amendment act, QSB 90-day cyber-audit on the broker dashboard) — **not** the older examples in `deck/demo-video-script.md`.
- Strip opacity lives in the ASS `BackColour` alpha byte (`&H38` = 78% opaque; `&HC7` would be the literal 22%, unreadable over the white UI).
- Re-burn after editing captions (audio is stream-copied):
  ```powershell
  cd demo-video
  node_modules\ffmpeg-static\ffmpeg.exe -i renders/setu-launch-60fps.mp4 `
    -vf "ass=captions/setu-launch.ass:fontsdir=captions/fonts" `
    -c:v libx264 -crf 17 -preset slow -pix_fmt yuv420p -c:a copy -movflags +faststart `
    -y renders/setu-launch-60fps-subs.mp4
  ```
  (`captions/fonts/` holds a copy of Calibri so libass never falls back.)

## Film timeline (locked to the recorded VO segment lengths)

| Time | Scene | Source |
|---|---|---|
| 0:00–0:12 | Hook — one circular, twelve readings | graphics `#g1` |
| 0:12–0:20 | Twist — understood once, at the source → logo | graphics `#g2` |
| 0:20–0:28 | **Home screen (8s)** | `s1-login.mp4` |
| 0:28–0:56 | **Document ingestion (28s)** | `s2a/s2b/s2c` |
| 0:56–1:08 | **Rule graph + KYC node (12s)** | `s34-graph.mp4` |
| 1:08–1:18 | **Sub-node + inspector sidebar (10s)** | `s34-graph.mp4` (cont.) |
| 1:18–1:48 | **Amendment console (30s)** | `s5a/s5b/s5c/s5d` |
| 1:48–1:58 | **Onboarding form (10s)** | `s6a/s6b/s6c` |
| 1:58–2:13 | **Customer dashboard + drawer (15s)** | `s7-dashboard.mp4` |
| 2:13–2:33 | Four pillars | graphics `#g3` |
| 2:33–2:48 | Outcomes + Weeks→Minutes stat | graphics `#g4` |
| 2:48–3:00 | Close — One graph. Issued once. | graphics `#g5` |

## Dropping in the voice-over

The seven screen acts are cut to your recorded segment durations (8/28/12/10/30/10/15s),
so the VO should line up if the screen narration starts at **0:20**.

1. Put the recording at `assets/audio/vo.mp3`.
2. Add inside `#root` in `index.html` (next to `#bgm`) — set `data-start` so the
   *home-screen* line begins at 20s (e.g. if your file starts directly with that line,
   `data-start="20"`):
   ```html
   <audio id="vo" src="assets/audio/vo.mp3" data-start="20" data-duration="160" data-track-index="41" data-volume="1"></audio>
   ```
3. Duck the music under the voice — in the *music automation* block replace the 0.4 values with ~0.16.
4. If your hook/twist/pillars/close VO lengths differ from my graphics timings, shift the scene
   boundaries: every scene's times live in plain `data-start`/`data-duration` attributes and the
   absolute times in the `tl.fromTo(...)` calls right below (grouped per scene, commented).
5. Re-render (below).

## Re-rendering

Render through the patched local CLI copy (`tools/hfd/cli.js`), **not** `npx hyperframes render`:
stock hyperframes 0.7.33 fails on Windows without Developer Mode (EPERM symlinking extracted
frames — the patch passes `materializeSymlinks: true`), and its default 2GB extract cache silently
evicts frames mid-render at our clip sizes, producing blank footage. Hence the cache override:

```powershell
cd demo-video
$env:PATH = "$PWD\node_modules\ffmpeg-static;$PWD\node_modules\ffprobe-static\bin\win32\x64;$env:PATH"
$env:PRODUCER_RENDERS_DIR = "$PWD\renders"
$env:HYPERFRAMES_EXTRACT_CACHE_MAX_MB = "30000"
node tools/hfd/cli.js render --quality high --fps 60 --output renders/setu-launch-60fps.mp4
```

`npx hyperframes preview` opens Studio for interactive review/editing (preview is unaffected by
either bug).

## Re-capturing footage

- `node capture/capture.mjs` — drives the prototype (Vite on port 5199) through all five
  sessions at 3200×1800 with the injected cursor and a 2.4× time-dilation shim (app clock slowed, later sped back up → true 60fps animation frames); writes `capture/raw/*.webm` + marker JSONs.
- `node capture/fuse.mjs` — trims the 13 shots from the raws (marker-based windows), speeds them 2.4× to 60fps CFR, concats into `assets/clips/acts-60.mp4` (exactly 113.000s) and writes `capture/cues.json` (film-time click cues for the camera).

## Credits

- Music: “Voxel Revolution” — Kevin MacLeod (incompetech.com), CC-BY 4.0.
  **Credit required if published**: “Voxel Revolution by Kevin MacLeod, incompetech.com, CC BY 4.0.”
  (`assets/audio/alt-limit70.mp3` = “Limit 70”, same license, alternative bed.)
- Fonts: Clash Display & Switzer (Fontshare, free license), JetBrains Mono (OFL).
