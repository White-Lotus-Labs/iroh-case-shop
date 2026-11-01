# Visual rubric

This rubric scores the tea room from real screenshots. Score each part from 1 to 10. Judge it as a AAA environment-art portfolio review: a 10 would pass in a shipped console game; a 6 looks like a competent indie prototype.

Scores go in `docs/visual-scores.md`, one table per round.

## Shots

`scripts/visual-shots.mjs` captures fixed, repeatable shots. The dev-only hook `src/scene/DevShotCamera.tsx` reads `?shot=<name>`, locks the camera to a fixed pose, and disables camera travel and orbit. Station shots use the same pose as the product station, so they show what a user sees.

In this doc, "front room" means the 3D room around the counter. The app's **Waiting room** is the sketchbook screen, which these shots do not show. The code names the Observatorium station `TeaTable` and the Host station `AvatarSeat`.

| Shot              | Pose                      | Parts it shows                        |
| ----------------- | ------------------------- | ------------------------------------- |
| `room-wide`       | Doorway, wide lens        | Whole chamber, mood, atmosphere       |
| `entrance`        | Waiting room station pose | The room behind the sketchbook        |
| `counter`         | Counter station           | Front room, counter, walls            |
| `counter-shelves` | Close-up, 60° lens        | The shelves behind the counter        |
| `tea-table`       | Observatorium station     | The orrery in the middle, the veranda |
| `host-full`       | Host station              | Host in context                       |
| `host-face`       | Close-up, 30° lens        | Face, eyes, beard, hair               |
| `host-hands`      | Close-up, 42° lens        | Hands, robe, table edge               |
| `tea-set`         | Close-up, full motion     | Teapot, cups, tea, steam              |
| `brazier`         | Close-up, full motion     | The brazier and its glow              |
| `observatorium`   | Close-up of the orrery    | Brass, gears, how it sits in the room |
| `shelf`           | Shelf station             | Shelf, right wall                     |

All shots use reduced motion so that they repeat exactly, except `tea-set` and `brazier`. The app hides steam under reduced motion, so those two shots run with full motion.

### Run the shots

1. Start the dev server: `npm run dev -- --port 3106`.
2. Run `node scripts/visual-shots.mjs [outDir]`.
   - Default `outDir`: `../_scratch/shots/round-N`, next to the repo, where N is the next free number.
   - `--shots=host-face,host-hands` takes only some shots.
   - `--base=http://127.0.0.1:3106` sets the server. This is the default.
   - `--size=1600x900` sets the viewport. This is the default.
   - `--gpu=metal`, the default, uses the real GPU: ANGLE Metal on macOS, Chromium's default backend (D3D11 on Windows) elsewhere. `--gpu=swiftshader` uses SwiftShader, the software renderer.
   - `--headed` is a fallback only. It opens Chromium off-screen at `-32000,-32000` and never brings it to the front.
   - `--dpr=1` renders at 1x. The real-GPU run defaults to 2x, like a Retina laptop. The quality ladder in `ScenePolish` then sets the render ratio, never above 1.5x or the page's own: desktop starts at 1.5x, phones and save-data at 1x, and the frame rate moves it between the two.
   - `--motion=full` turns off reduced motion for all shots. `--ui` keeps the HTML panels visible.
   - `--query=irohPose=sip:2` adds a URL query, for example to hold one frame of Uncle's animation.
3. The script waits 1.4 s per shot, or 2.6 s for `tea-set` and `brazier`, then samples frames for 3 s. `--motion=full` does not change the wait. It writes one PNG per shot and `frames-<gpu>.json`. The JSON has the WebGL renderer string, the mean and p95 frame time and fps per shot, the mean fps across shots, and a list of page errors and HTTP responses of 400 or higher.

The frame sampler uses `requestAnimationFrame` in the page. The Metal run turns off vsync and the frame-rate limit, so fps shows headroom above the display refresh.

### GPU choice for scoring

Score from the real-GPU run (`--gpu=metal`, ANGLE Metal on Apple M5 Max). A real user's browser uses the GPU, not SwiftShader.

Launch mode (from round 3 on): every run is headless, so no window opens on the screen. The Metal run uses Chrome's new headless mode (Playwright channel `chromium`) with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`. The renderer string still reads `ANGLE Metal Renderer: Apple M5 Max`, and the `room-wide` shot matches the earlier headed reference. Rounds 0 to 3 used a headed window.

Headed fallback (`--headed`): use it only if headless GPU output is clearly wrong. The script then puts the window off-screen and unfocused (`--window-position=-32000,-32000 --window-size=1440,900`). It never calls `bringToFront` and closes the browser as soon as the shots are done. Every other browser launch for this project follows the same rule.

Round 0 check: the same `room-wide` shot at 1600×900, 1x, from headless SwiftShader and from headed Metal, has a mean absolute pixel difference of 0.14/255 (0.1% of pixels differ by more than 16). The unlit backdrops and the simple lighting render the same on both. SwiftShader runs at about 2 fps, so it cannot measure frame time. Recheck after post effects change; results are in `docs/visual-scores.md`.

Frame-time budget: the Metal run must stay at or above 50 fps. The M5 Max is much faster than a typical laptop GPU, so watch the trend between rounds, not only the gate.

## Scene parts

### Lighting and shadows

- 4: Flat ambient fill. Light has no source you can see. Objects float without contact shadows.
- 6: A clear key light and readable shadows. Some local light pools. Fill still looks uniform.
- 8: Warm key, cool or dim fill, and rim light shape the forms. Every light has a visible, believable source. Contact shadows ground every object. Falloff looks physical.
- 10: Light tells the story. Soft penumbras, bounce color, and highlight roll-off match a film still.

### Environment and atmosphere

- 4: Empty voids, a missing ceiling, sharp CG air with no depth.
- 6: The room is closed. Some depth cue, such as fog or value falloff with distance.
- 8: Subtle haze gives depth. Window light has a presence (shafts or glow). Background planes sit in the same air as the 3D objects.
- 10: The air feels thick and warm. Dust, haze, and light shafts respond to the light sources without looking like effects.

### Walls and architecture materials

- 4: Flat, untextured planes. Painted backdrops read as stickers.
- 6: Textured plaster and timber at a correct scale. Painted backdrops mostly blend in.
- 8: Plaster has mottling and relief. Timber has grain and edge wear. Joinery (posts, rails, wainscot) is believable. No large empty areas.
- 10: Every surface has a history. Material breakup at all scales, with no visible tiling or noise pattern.

### Floor and table materials

- 4: Uniform color, fake plank lines, plastic sheen or none.
- 6: Planks with some variation. The table reads as wood.
- 8: Planks vary in tone and grain. The finish shows soft reflections of the light sources. The table has a lacquer or oil finish with believable highlights. Tatami reads as woven rush with cloth borders.
- 10: Micro-scratches, wear paths, and reflections indistinguishable from a photo.

### Tea set and steam

- 4: Objects float. Steam is invisible or looks like sprites.
- 6: Grounded ceramics with readable glaze. Steam is visible.
- 8: Glaze shows environment reflections and a clear highlight. Tea liquid reads as amber tea. Steam rises in soft, varied wisps that catch the light.
- 10: A food-shot close-up. Glaze pooling, crackle, and steam that curls believably.

### The orrery

- 4: Reads as yellow plastic. Lost against the background.
- 6: Reads as metal. Parts are readable at the station view.
- 8: Brass shows warm reflections with roughness variation and dark polished contrast. It sits in its own pool of light and has a contact shadow. The silhouette reads from the wide view.
- 10: A museum-grade object. Patina, engraved detail, and specular glints hold up in close-up.

### Overall mood and color grade

- 4: Muddy, one-note color. No contrast shaping.
- 6: Warm and pleasant, but flat, like an untouched render.
- 8: A clear cinematic grade: controlled contrast, warm highlights, deep but not crushed shadows, subtle bloom on light sources, gentle vignette. Painted and 3D layers match.
- 10: Every frame could be a key-art still.

### Prop and architecture detail

Added in round 3. The reference bar is a scene where every object is sculpted in code with part-level detail, such as Meng To's ship scene.

- 4: Props are boxes, spheres, and cylinders. Painted backdrops carry most of the detail.
- 6: Main props have their real parts (legs, lids, handles, frames), but edges are hard and repeated parts look identical.
- 8: Every prop the camera sees has part-level detail: beams with joinery and bevels, lattice shoji, lanterns with ribs and tassels, a tea set with lids, handles, and glaze variation, and plants with branches and leaves. Painted backdrops stay only beyond windows.
- 10: Close-ups hold up everywhere. Wear, labels, knots, and small props make the room look lived in.

## Host parts (owned by the host lane)

The scene lane scores these rows as a baseline but does not edit the host. Use `host-face`, `host-hands`, and `host-full`.

### Face

- 4: A photo on a sphere. Ears and skull read as primitives.
- 6: A coherent head shape. Skin has tone variation. Light falls on it believably.
- 8: Sculpted planes (brow, cheekbones, nose). Skin shows subsurface warmth and specular breakup. It matches the lighting of the room.
- 10: A believable character close-up.

### Eyes

- 4: Flat, painted, dead.
- 6: Readable gaze. Some depth.
- 8: A wet highlight, lid shadow, and the eyes track the viewer or the tea.
- 10: The eyes carry emotion.

### Beard

- 4: A solid mass or a flat card.
- 6: Strand texture. It sits on the face.
- 8: Layered volume with soft edges and light transmission at the tips.
- 10: Groomed and physically plausible.

### Hair

- 4: A helmet or a band of solid shapes.
- 6: A hair mass that follows the skull.
- 8: Strand breakup, a believable topknot, and a clean hairline.
- 10: Groom-quality hair.

### Hands

- 4: Mittens or blobs. The color does not match the face.
- 6: Readable fingers. Skin matches the face.
- 8: Knuckles and a natural pose. The hands hold or rest on something with contact.
- 10: Expressive hands in a close-up.

### Robe

- 4: Flat color on primitives.
- 6: Fabric texture and readable layers.
- 8: Folds and drape follow the body. The weave catches light. Collar and sash read clearly.
- 10: Cloth-sim quality.

### Posture

- 4: Stiff and symmetric. Limbs float.
- 6: A seated pose that reads.
- 8: Weight on the cushion, relaxed shoulders, and a natural host gesture.
- 10: The pose tells you who he is.
