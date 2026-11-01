# Perf budget

> **Record from 27 September 2026.** These tables are history. The waiting-room button was then called "Step inside"; it is now **Enter Teashop**. To measure again, run `npm run build`, then `node scripts/perf-audit.mjs` (see [Development notes](development.md#scripts)). The script now counts compressed wire bytes, so its numbers do not compare directly with the tables below.

Measured 2026-09-27T08:27:46.117Z against `http://127.0.0.1:3112` (production `next start`, headless Chromium, ANGLE Metal, unthrottled).

## Timing

| Milestone | Time |
| --- | ---: |
| Entrance visible | 5586 ms |
| Scene loader gone | 6504 ms |

## Transferred bytes (by type)

| Type | Bytes |
| --- | ---: |
| document | 10.7 KB |
| js | 1689.3 KB |
| css | 201.9 KB |
| image | 3142.9 KB |
| font | 122.6 KB |
| other | 0.0 KB |
| **total** | **5167.3 KB** |

## Notes

- Network throttling via Chrome DevTools Protocol was not recorded; CDP throttling is unreliable in this headless Metal setup.
- GPU flags: `--use-angle=metal --enable-gpu --ignore-gpu-blocklist --enable-webgl`.

## After polish pass (2026-09-27)

Measured against `http://127.0.0.1:3118` after merging lanes P/U/C/W/S (production `next start`, headless Chromium, ANGLE Metal, unthrottled). SceneLoader is not mounted; “loader gone” is immediate when no `.scene-loader` node exists. “Entrance visible” is `aria-busy` clearing (scene ready / Step inside enabled).

| Metric | Measured | Budget | Status |
| --- | ---: | ---: | --- |
| Entrance visible (ready) | 2363 ms | ≤ 5 s | pass |
| Scene loader gone | 2376 ms | ≤ 5 s | pass (no loader) |
| Initial transfer | 5947.9 KB (~5.8 MB) | ≤ 2.5 MB | miss |
| JS transfer | 1785.4 KB | ≤ 450 KB gzip | miss (raw transfer; not gzip) |
| Startup images | 3642.7 KB | ≤ 1.2 MB | miss |
| Fonts | 122.6 KB | ≤ 150 KB | pass |

| Type | Bytes |
| --- | ---: |
| document | 152.0 KB |
| js | 1785.4 KB |
| css | 245.3 KB |
| image | 3642.7 KB |
| font | 122.6 KB |
| other | 0.0 KB |
| **total** | **5947.9 KB** |

## Before page-speed PR (this host)

Measured 2026-09-27T12:30:02Z on production `next start` at `737a450`, headless Google Chrome, Linux (no Metal GPU). Byte totals are the sum of response `Content-Length` (uncompressed, and a repeat response is counted again). “Entrance visible” is `aria-busy` clearing. The desktop entrance time did not record on that run; the polish-pass figure above (2363 ms, Metal) is the earlier desktop ready time. Mobile used a 390×844 viewport at 2x, CDP Fast 4G (~1.6 Mbps, 150 ms RTT) and 4× CPU.

| Metric | Desktop | Mobile Fast 4G | Budget |
| --- | ---: | ---: | ---: |
| Entrance visible | — (see 2363 ms above) | 15044 ms | ≤ 5 s |
| Step inside enabled | yes | yes | |
| Transfer after settle | 5726.5 KB | 3659.0 KB | ≤ 2.5 MB |
| JS | 1723.6 KB | 1723.6 KB | ≤ 450 KB gzip |
| Images | 3658.7 KB | 1591.2 KB | ≤ 1.2 MB |
| CSS | 203.5 KB | 203.5 KB | |
| Fonts | 122.6 KB | 122.6 KB | ≤ 150 KB |

## After page-speed PR

Measured 2026-09-27T12:41:32Z the same way, after WebP waiting-room art, deferring AO / bloom / environment and shelf posters until after Step inside, and a lower mobile quality rung. Raw totals use the same Content-Length sum. Wire totals are Resource Timing `transferSize` (gzip and cache hits).

| Metric | Desktop | Mobile Fast 4G | Budget | Status |
| --- | ---: | ---: | ---: | --- |
| Entrance visible | 9453 ms | 10274 ms | ≤ 5 s | miss on this host |
| Step inside enabled | yes | yes | | |
| Raw transfer | 3500.7 KB | 2626.2 KB | ≤ 2.5 MB | desktop miss, mobile close |
| Wire transfer | 1791.2 KB | 1271.3 KB | ≤ 2.5 MB | pass |
| JS raw | 1636.7 KB | 1644.8 KB | ≤ 450 KB gzip | raw miss |
| JS gzip (largest chunks) | ~423 KB | ~423 KB | ≤ 450 KB gzip | pass for those chunks |
| Images raw | 1517.9 KB | 608.4 KB | ≤ 1.2 MB | desktop miss, mobile pass |
| CSS | 204.9 KB | 231.8 KB | | |
| Fonts | 122.6 KB | 122.6 KB | ≤ 150 KB | pass |

| Type | Desktop raw | Mobile raw |
| --- | ---: | ---: |
| document | 18.6 KB | 18.6 KB |
| js | 1636.7 KB | 1644.8 KB |
| css | 204.9 KB | 231.8 KB |
| image | 1517.9 KB | 608.4 KB |
| font | 122.6 KB | 122.6 KB |
| **total** | **3500.7 KB** | **2626.2 KB** |

### What still misses the budget

- three.js is still about 846 KB raw (~226 KB gzip) and loads before Step inside, because the room has to be ready. That is most of the JS.
- Desktop raw transfer stays over 2.5 MB. The wire number is under 2.5 MB.
- Desktop images stay over 1.2 MB: diorama, back wall, thesis covers on the counter, and the sketchbook riffle. Mobile images pass.
- Entrance time on this headless Linux host is about 9.5 s unthrottled and 10.3 s on Fast 4G (down from 15.0 s). The 2.4 s figure was a Metal GPU. Step inside still waits for the 3D room.
- AO, bloom, and the environment chunk stay off the entrance download. They load after Step inside. Shelf poster textures do too. (Superseded by the sketchbook-first load order below.)

## Sketchbook-first load order (2026-09-27)

Visitors read the sketchbook first, so the room may load slowly as long as the first spread shows and turns fast.

- The room chunk and its textures start only after the sketchbook bakes its first spread (`data-bake` ≥ 2), or after 12 s.
- Surface textures are painted in a Web Worker (`src/scene/surfaceTexels.worker.ts`), not on the main thread.
- Room reflections are a one-shot cube map in the lit shell, so they no longer recompile every program when they arrive. AO and bloom mount with the staged room detail, and Enter waits for that stage, so nothing pops in after the guest steps inside.
- Music is a 36 s seamless loop: Opus (about 86 KB) with an MP3 fallback (about 144 KB). Nothing downloads before a gesture, and the on/off choice persists.
- Shelf posters carry baked names and warm once the room is ready. The duplicate shelf mini-scroll is gone.
- Files with a content hash (`name.abc123.ext`) in `images`, `audio`, and `models` are cached as immutable; other images for a week.

## Low-end motion path

The waiting-room sketchbook and the Counter thesis deck share one motion budget per visit (`src/ui/motionBudget.ts`). `prefers-reduced-motion: reduce` is unchanged: the book stays open and a page turn settles on the next frame.

The light path is used when any of these is true:

- `navigator.hardwareConcurrency` is 1–4
- `navigator.deviceMemory` is present and at most 4 GB
- after an idle callback, a short `requestAnimationFrame` sample has a median frame slower than 22 ms (about 45 fps). A single long stall is ignored
- a page curl stays under about 30 fps (median of recent frames, ignoring a single long stall). The budget then stays light for the rest of the visit

On the light path the sketchbook still riffles and still turns by drag, keys, and the index:

- the curl uses 16 strips instead of 18. Each bending face is a snapshot of the real page that the browser itself draws (SVG `foreignObject`, with the page's CSS, fonts, and pictures inlined), not a title or cover placeholder and not 16 live DOM clones. Snapshots bake one page per idle slot after the book opens
- the riffle is shorter, and a drag or button turn uses a short wall-clock tween (about 220 ms) so a missed frame does not leave the spring running in slow motion
- the pages under the leaf are not blurred
- the cast shadow and the petals in front of the book drop their blur
- sakura counts fall to about a quarter (48 → 12 in the room, 9 → 3 in front of the book). Both canvases pause while a leaf is riffling and while the tab is hidden
- the sketchbook frame loop runs only while a page is turning or the cover tilt is settling, and it stops while the tab is hidden

On the light path the thesis deck still opens, switches, and closes:

- `document.startViewTransition` is skipped, so the books are not FLIP-captured with the WebGL room
- book shadows are not blurred, and the open scroll fades with opacity and transform only
- the 3D counter cards write their spring once when they are already at rest, instead of every frame

On both paths, the 3D room behind the deck is the main cost, not the deck itself:

- while the Counter deck is open, the room is drawn every other frame, and the quality ladder does not climb
- a thesis switch no longer re-renders the static room, so the `frames={1}` contact shadows do not redraw the whole scene on each click
- the tea-pot contact shadow redraws only while the pot pours, not every frame

A capable machine keeps the 18-strip curl, the riffle blur, the view transitions, and the full petal counts.

### Page turn at 4× CPU

Production `next start` on the isolated sketchbook, headless Chromium, `Emulation.setCPUThrottlingRate` 4, on battery power (the browser caps frames at 33.3 ms, even on a blank page). Two runs each.

| | PR #21 (canvas walker) | Browser-drawn snapshots |
| --- | --- | --- |
| Riffle p90 frame, full / light | 33–67 ms / 67–100 ms | 33.4 ms / 33.4 ms |
| Riffle long tasks, full / light | 2–3 (50–61 ms) / 3–5 (50–79 ms) | 0 / 0 |
| Drag long tasks | 0 | 0 |
| Bake tasks over 50 ms | not split out | 1 (78 ms, SVG layout of the text-heaviest page, in idle time) |
