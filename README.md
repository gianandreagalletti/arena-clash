# Arena Clash — Week 1: Core Sim + Basic Combat

A top-down, 3-player free-for-all arena shooter (Soul Knight-style). This is the
Week 1 MVP: core deterministic simulation, a shared Shoot/Slash/Shield baseline
with one distinct identity per character, pre-match boost allocation,
round/match flow, and 3-gamepad / gamepad+keyboard local play. The shrinking
zone, pickups and menus are out of scope this week.

## Combat model

The shared baseline every character starts from — the numbers live in `ACTIONS`
in `src/sim/config/balance.js`:

| Action | Numbers |
|---|---|
| **Shoot** | 18 damage, 2 shots/s, projectile 14 tiles/s, unlimited range — flies straight until it hits a player, cover or an arena edge |
| **Slash** | 14 damage, 2.5 hits/s, 1.5 tile reach, 90° frontal arc, one hit per target per swing |
| **Shield** | 2.0s active, incoming damage −70%, 6.0s cooldown starting when the shield ends; blocks Shoot/Slash while up, movement still allowed |

Shoot/Slash/Shield above are the **baseline**. Each character starts from it and
then diverges — see "Character identity" below.

| Stat | Sniper | Berserker | Summoner |
|---|---|---|---|
| HP | 80 | 140 | 100 |
| Speed (tiles/s) | 4.5 | 5.0 | 4.2 |

## Character identity

Every number here is a **first-pass guess, not final balance**. They all live as
named values under `CHARACTERS[id]` in `balance.js` — nothing is hardcoded in sim
logic — specifically so they can be tuned without touching code.

**Sniper — high damage, low fire rate.** Overrides the shared Shoot baseline:
36 damage (2×) every 1.0s (½ rate), projectile 22 tiles/s. Nominal DPS therefore
lands on the same 36/s as everyone else, but delivered in fewer, heavier hits, so
missing hurts. Keeps the lowest HP (80). No ability — its identity is statistical.
A test pins sustained DPS to within ±20% of the baseline character, so retuning
either number tells you immediately how far the character drifted.

**Berserker — telegraphed AoE nova** (`ult` button). 45 damage to everything
within 3 tiles, after a 0.5s windup during which the Berserker is slowed to 50%.
Damage lands **once**, at the end of the windup, on whoever is inside the radius
*at that moment* — so walking out genuinely saves you. Costs 50 ult charge, using
the meter that was already being tracked rather than a second resource system.
The windup is a real sim state (`player.charging === 'nova'`), so a renderer can
draw a telegraph and a future interrupt mechanic has something to cancel.

**Summoner — killable dog** (`ult` button). 40 HP, bites for 8 in a 0.9-tile
reach every 0.8s, moves at 5.5 tiles/s. One alive at a time; pressing summon
again while it lives does nothing. It takes damage from projectiles and slashes
through the exact same `applyDamage` path a player does, and when it dies the
Summoner waits 5s before re-summoning. Movement is a random walk biased toward
the nearest enemy (`trackingBias`, 0 = pure random, 1 = direct chase; currently
0.5), driven by the seeded RNG in state, so a given seed always replays the same
path. Damage it deals is credited to the Summoner's ledger; damage dealt *to* it
grants no ult charge, so a respawning dog can't be farmed as a charge battery.

### Pre-match boost allocation

Between the join screen and the Round 1 countdown, every player spends **10
points** across 4 categories on one shared screen (all three allocations visible
to everyone). Allocation is fixed for the whole match — no re-spec between rounds.

| Category | Bonus per point | Max (10 points) |
|---|---|---|
| HP | +4% | +40% |
| Speed | +3% | +30% |
| Shoot damage | +3% | +30% |
| Slash damage | +5% | +50% |

Bonuses are multipliers on the base stats, resolved **once** in
`createInitialState` and carried unchanged through every round. The sim only
ever receives the final `{ hp, speed, shootDmg, slashDmg }` point counts; the
spending UI itself lives in `src/input/boostAllocation.js` + `src/render/scenes/BoostScene.js`.

## Running it

```bash
npm install
npm run dev
```

Opens the join screen at `http://localhost:5173`. Build for itch.io later with `npm run build` (output in `dist/`).

### Playing

- Join screen: each device claims a slot. **Gamepad:** press **A** to join, **B** to leave. **Keyboard/Mouse:** press **Enter** or **left-click** to join, **Esc** to leave.
- Once all 3 slots (P1–P3) are filled, any joined player presses **Start** (gamepad) or **Space** to begin.
- Boost screen: **Gamepad** d-pad/left stick to pick a category, **A** add a point, **B** remove, **Start** to ready up (press again to un-ready). **Keyboard:** Up/Down to pick, Right to add, Left to remove, **Enter** to ready. The match starts when all three are ready.
- **F1** toggles debug solo mode at any time: the keyboard controls one player directly, bypassing the join screen (handy for solo testing without 3 controllers). Slots with no device auto-ready at zero boost points.
- **F2** (join screen) toggles the gamepad debug overlay: live pads Phaser sees, plus each slot's stored pad index and whether it still resolves.
- **F3** (in-match) toggles a hitbox + aim overlay: the sim's actual collision geometry (player radius, cover rects, arena bounds, projectile radius, active slash reach/arc, dog hitbox, nova radius — always, not just while charging) as 1px lines over the art, plus the dog's current target and the mouse-aim chain — green cross = the mouse player's sim position, cyan cross = the world aim point the sim received, white square = the raw pointer pixel. Cyan and white sitting on top of each other means screen → world is correct.
- **Gamepad:** left stick move, right stick aim (holds last direction when idle), **RT** Shoot, **RB** Slash, **LB** Shield, **Y** character ability.
- **Keyboard/Mouse:** WASD move, mouse aim (toward cursor), left-click Shoot, **E** Slash, **Q** Shield, **R** character ability.
- **Character ability (Y / R):** Berserker casts the nova (costs ult charge), Summoner summons its dog. Sniper has none. Watch the HUD: the charge bar blinks orange on "NOVA READY", and the Summoner panel shows its dog's HP or a respawn countdown.
- A round ends when one player is left standing; first to 3 round wins takes the match. At the match-over screen, press **A** (gamepad) or **Space** to rematch (same boost allocation).

### Character selection (hardcoded this week)

Pass character ids via URL query params, e.g.:

```
http://localhost:5173/?p1=sniper&p2=berserker&p3=summoner
```

Valid ids: `sniper`, `berserker`, `summoner`. Missing/invalid params fall back to that default order.

## Testing

```bash
npm test
```

Runs the offline sim test suite (Node's built-in `node:test`, no browser, no extra
test-runner dependency) against `tests/*.test.js`. Covers determinism, Shoot
damage (boosted and unboosted), fire rate, Slash arc (for every character),
Shield (70% reduction, expiry, cooldown lockout, action lockout), boost
multipliers, character identity (Sniper DPS band, nova radius/windup/cost,
dog HP, cap, respawn cooldown and deterministic path), projectile flight
(unlimited range, constant velocity into cover,
no aim assist on either input device, point-blank wall), mouse aim (screen →
world round-trip across window sizes, aspect ratios, letterboxing and camera
zoom; clicking a target's drawn pixel hits it), collision, spawn
invulnerability, round/match flow (including the double-knockout void case),
ult charge, and a static check that `src/sim/` never imports Phaser/DOM/`window`
or calls `Math.random`.

## Changing balance values

Every gameplay number lives in **`src/sim/config/balance.js`** — `ACTIONS`
(the shared baseline), `CHARACTERS` (HP, speed and each character's own
overrides/abilities), boost points and per-point
bonuses, aim assist, invuln duration, round/match timers, ult charge formula.
Nothing else in `src/sim/` hardcodes a number. `src/sim/characters/*.js` are thin
re-exports of `balance.js`'s `CHARACTERS` entries (kept as separate files
per-character for organization; the numbers themselves live in one place).

## Architecture

```
src/
  sim/                  # pure gameplay logic — zero Phaser/DOM/window, no Math.random
    config/balance.js   # single source of truth for every gameplay number
    state.js            # createInitialState(seed, characterIds, boostAllocations)
    step.js             # step(state, inputs) -> newState (fixed 60 ticks/s)
    systems/            # movement, projectiles, melee, damage, round
    characters/         # sniper.js, berserker.js, summoner.js (thin balance.js wrappers)
    arena.js             # Courtyard layout + collision geometry helpers
    log.js               # end-of-round log builder + console printer
  input/                # device -> InputFrame mapping, device manager,
                        #   boostAllocation.js (pure point spending), menuInput.js
  render/               # Phaser scenes (Boot -> Join -> Boost -> Game); reads state, never mutates it
    art/                # palette.js, sprites.js, textures.js, font.js, hash.js — see "Art" below
    arenaRenderer.js    # floor/wall/cover/platform/torches
    players/            # per-player sprite, animation, shield, ghost
    fx/                 # pooled projectiles, slash smears, elimination poof
    ui/                 # shared panel + pixel-text-style helpers
    debug/              # F3 hitbox overlay
    coords.js           # world tile <-> screen px (adds the 1-tile wall margin);
                        #   screenToWorld() is the ONE mouse -> world conversion
    hud.js
tests/                  # offline node:test sim tests (no browser)
```

`step(state, inputs)` never mutates `state` (it `structuredClone`s internally),
so the same seed + same input sequence always replays identically — verified by
the determinism test. Ticks are integers; all `*Sec` config values are converted
to `*Ticks` once, at module load, via `secToTicks()`.

### Mouse aim: one conversion, in one place

`input/` knows nothing about pixels, canvas size or the camera. `GameScene`
converts the pointer to a **world point in tiles** with
`render/coords.js screenToWorld()` — the exact inverse of the `worldToScreen*`
the renderer draws with — and hands that to `deviceManager.buildFrames()`. The
aim vector is then just `normalize(aimWorld − simPlayerPosition)`.

The on-screen crosshair is drawn by converting that *same* world point back to
screen, never from raw pointer pixels, so the crosshair and the shot cannot
drift apart. `screenToWorld` reads `pointer.worldX/worldY`, which Phaser has
already corrected for canvas offset, FIT letterboxing, devicePixelRatio and the
camera transform — so there are no hand-written offsets anywhere, and window
size/zoom cannot reintroduce the aim-offset bug.

## Art

A placeholder-quality pixel-art pass, generated in code (no downloaded assets),
built to be swapped for real Aseprite spritesheets later without touching game
code — see `src/render/art/`.

- **`palette.js`** — the single color table. Every generated sprite pulls from
  it; nothing else in `render/` should hardcode a hex color. Player colors are
  **palette swaps** (red/blue/green/ghost — four full copies of the same pixel
  grids with different accent/body/shade/skin colors), not `setTint()`, so the
  outline and skin never get muddied.
- **`sprites.js`** — the 12 hand-authored player frames (`{idle|walk}-{down|up|side}-{0|1}`),
  16×16 character grids (one char = one pixel, `.` = transparent), plus the
  `LEGEND` mapping each character to a palette *role* (not a literal color).
  The base "down/idle-0" frame came from the change request's appendix; the
  other 11 were derived from it (bob, leg-swap, face-hidden, side-profile) with
  a small throwaway script, then frozen here as plain data. To add a real
  spritesheet later: replace the grids (or point `textures.js` at loaded image
  frames) — nothing outside `art/` needs to change, since everything else only
  ever references texture keys/frame names, never raw pixel data.
- **`textures.js`** — turns `palette.js` + `sprites.js` into real Phaser
  textures once, at boot (`BootScene`), under the stable key contract below.
  Scaling: rather than authoring 16px-native canvases and applying a separate
  `setScale(2)` everywhere a sim position is drawn, every generator here paints
  each authored "pixel" as a 2×2 block directly onto a canvas already sized in
  final screen pixels — visually identical to "16px art, drawn at exactly 2×,"
  but needs no second scale factor threaded through the renderers (the change
  request's own "whichever touches less existing code" escape hatch).
  `pixelArt: true` in `main.js` keeps every 2×2 block crisp.
- **`hash.js`** — a deterministic (non-`Math.random`) hash used to pick which
  ~1-in-10 floor tiles get a crack decal, so the arena looks identical on
  every launch.
- **`font.js`** — "Press Start 2P" (OFL, via Google Fonts in `index.html`),
  loaded and awaited in `BootScene` before any other scene is created, so no
  scene ever draws with a blurry fallback font on its first frame.

### Texture key contract

```
player-{red|blue|green|ghost}          frames: {idle|walk}-{down|up|side}-{0|1}
dog-{red|blue|green}                   same frame names, colored by its owner
bite                                   white chomp burst when a dog bites
tile-floorA / tile-floorB / tile-crack
wall
cover
platform
torch-0 / torch-1 / torch-2
proj-{red|blue|green}
slash-{red|blue|green}-{dir}-{0|1|2}   dir: one of the 8 compass points (E,SE,S,SW,W,NW,N,NE)
shield-{red|blue|green}-{0|1}
particle-{red|blue|green}
```

Everything outside `render/art/` only ever addresses textures by these keys —
swap the generators for `scene.load.spritesheet`/`scene.load.image` calls under
the same keys and no other file needs to change.

**Deviation from the brief's literal key contract:** slash and shield textures
are keyed `slash-{color}-{dir}-{frame}` / `shield-{color}-{frame}` (baked
per-owner-color), not the color-less `slash-{dir}-{frame}` the brief lists.
Baking the owner-color edge directly into the texture (24 slash variants × 3
colors = 72 textures, generated once at boot, negligible cost) avoids tinting
the whole sprite with `setTint()` — which would have also tinted the white
smear fill the brief explicitly wants to stay white.

### Other choices worth flagging

- **8-direction slash "pre-drawn frames," not rotation.** The 8 slash textures
  per color/frame are baked once at boot with exact vector arc math (Canvas
  2D `arc()`, snapped to 8 compass directions via `snapToCompassDirection()`)
  rather than hand-drawn diagonal pixel art. No sprite is ever rotated at
  render time — `snapToCompassDirection` just picks which of the 8 pre-baked
  textures to display, matching the brief's intent (no rotation smear) without
  the fragility of hand-authoring true 45°-rotated pixel art (a square pixel
  grid only losslessly rotates/reflects in 90° steps, not 45°).
- **Player sprite anchor.** The brief says "the sprite's body center sits on
  the sim position." A literal geometric-center anchor on a chibi sprite (huge
  head, tiny legs/feet) would visually float the body above its own hitbox
  circle. `playerRenderer.js` anchors near the torso/feet instead (`origin.y
  = 0.82`) so the character stays visually grounded on the sim position and
  the drop shadow sits exactly at the sprite's bottom edge.
- **World margin for the wall ring.** The wall ring is drawn *outside* the
  24×16 playable area, so the Phaser canvas is 1 tile larger on every side
  than the sim's arena bounds (`render/coords.js`). Collision/arena bounds in
  `sim/` are completely unchanged — this only affects where things land on
  screen. HUD elements are unaffected (they're already screen-space, not
  world-space).
- **No external tileset.** The brief's "optional, your call" 0x72 DungeonTileset
  II was not used — floor/walls/cover/torches are all generated the same way
  as the characters, so the whole art pass has zero downloaded assets and zero
  licensing surface to track. `CREDITS.md` is therefore empty/not needed.
- **Not manually browser-tested.** No headless-browser tool was available in
  this environment (Playwright's browser download was also blocked — no
  network egress to its CDN), so this pass is verified by `npm run build`
  (transforms all 40+ modules cleanly), `npm test` (32/32, unaffected — this
  PR touches no file under `sim/`/`tests/`/`input/`), and a line-by-line check
  of every new Phaser API call against `node_modules/phaser/types/phaser.d.ts`.
  The actual look of the arena, animations and FX timing have **not** been
  visually confirmed — please screenshot/playtest before merging, per the
  acceptance criteria's screenshot requirement.

## Deviations from the brief (flagged, not silently fixed)

- **`state.novaBlasts` entries carry no id.** The render pass was asked to dedupe
  blast FX "by id", but the sim pushes `{playerId, x, y, radiusTiles, tick}`. The
  renderer dedupes on `playerId:tick` instead, which is unique because a player
  can only blast once on a given tick. An explicit id would be tidier, but adding
  one means touching `sim/`, which that CR forbade.
- **A dog bite is inferred, not signalled.** There is no bite event in state, so
  the renderer detects one from `dog.attackCooldownTicks` jumping upward — it
  only ever does that on the tick a bite actually lands — and draws the chomp on
  the nearest enemy, recomputing the same "nearest targetable enemy" rule the sim
  uses. If two players were exactly equidistant the FX could pick the other one;
  harmless for a 3-tick flash, but an explicit event would be exact.
- **The ability trigger needed an input change.** The brief asked for two new
  abilities but also froze `input/`. The `ult` field had been deliberately
  removed from the InputFrame in an earlier CR, so there was no way to fire
  either ability. Resolved (with the user) by wiring the two buttons that were
  already read and already documented as "reserved (future ultimate)": gamepad
  **Y** and keyboard **R**.

- **Cover block shape/placement.** The brief asks for 6 cover blocks with
  "120° rotational symmetry." True continuous rotation of an axis-aligned 2×1
  rectangle only exists at 90°/180° multiples, so `arena.js` places all 6 blocks
  (each a literal 2×1 axis-aligned rect) around a ring every 60° — which trivially
  satisfies 120° symmetry (and then some) but isn't a "true" rotated hexagon of
  blocks. Flagging in case the intended look was closer to a pinwheel with blocks
  actually rotated to face the center.
- **Aim assist is off** (`AIM_ASSIST_ENABLED = false`). It was removed because it
  rotated a shot up to 10° toward any opponent inside a 20° cone with no
  line-of-sight test, so aiming at a wall with someone roughly behind it sent the
  bullet somewhere else. Cone/bend values are kept untouched and the bending
  function is still there behind a single guard in `spawnProjectile`, so it can be
  switched back on with one flag. `AIM_ASSIST_ENABLED_BY_DEVICE` remains a
  documented, unused knob: a real per-device toggle would need the input layer to
  pass a per-player "assist enabled" flag through the InputFrame, since `sim/`
  deliberately can't know which device a player uses.
- **Void-round ult charge.** The brief specifies 50% ult carry-over between rounds,
  but doesn't say what happens to ult charge on a voided (double-knockout) round
  replay. Implemented as: void rounds do **not** apply the 50%-carry reduction
  (charge is left exactly as it was, since nothing was "won" or "lost") — only a
  real round win triggers the halving. Worth confirming this matches intent.
- **Projectile-cover collision is sub-stepped (4 substeps/tick), not fully swept.**
  At Shoot's projectile speed (14 tiles/s ≈ 0.23 tiles/tick) against the thinnest
  cover (1 tile), tunneling risk is very low but not mathematically zero at extreme
  angles. Good enough for the MVP; a true swept-circle-vs-AABB check would close
  the gap if it ever shows up in playtesting.
- **Player-vs-player collision is not implemented.** The brief doesn't mention it,
  so players currently pass through each other freely (only cover blocks and arena
  edges block movement). Flagging since some arena shooters block on players too.
- **Spawn invulnerability makes a player fully untargetable**, not just
  damage-immune: projectiles pass through them and melee can't select them at all
  (rather than "hits register but deal 0"). Simpler to reason about and test;
  flagging in case the intended feel was "you can still be shoved/interrupted,
  just not hurt."

### Open questions from the shared-actions / boost change

- **Shoot and Slash use independent cooldowns.** The change request gives them
  separate rates (2/s and 2.5/s) but doesn't say whether firing one should gate
  the other. Implemented as two independent timers, so a player can interleave
  Shoot and Slash at their full individual rates. If they're meant to share one
  "attack" cooldown, that's a one-line change in `step.js`.
- **Shield reduction is applied before all bookkeeping.** Damage dealt/taken stats
  and ult charge all use the *post*-reduction number (the damage that actually
  landed), since the ult formula is defined per HP of damage. So shielding an
  opponent's shot also denies them ult charge. Flagging because the alternative
  (charge on pre-mitigation damage) is a defensible design too.
- **Rematch reuses the same boost allocation** instead of returning to the boost
  screen. "Fixed for the whole match" could argue for a fresh allocation on a new
  match, but returning there would change the existing rematch flow, which the
  change request listed as untouchable. One line in `GameScene._rematch()` if you
  want the other behaviour.
- **Boost screen ready is a toggle**, so a player can un-ready and keep editing
  until everyone is ready. Not specified either way.
- **Slots with no device auto-ready at zero points**, which is what makes F1 debug
  solo mode still reach the arena. Only reachable in debug mode during normal play.
- **The area-damage code is retained but dead.** `explode()` in
  `systems/projectiles.js` and the `projectile_aoe` branches are still wired, but
  no Week 1 action spawns that projectile kind, per the request to keep it for
  Week 2/3 rather than delete it. `state.explosions` therefore always stays empty.

## Numbers that felt off during implementation

- **Time-to-kill got long.** At 18 damage / 2 shots per second, killing an
  unboosted Berserker takes **8 Shoot hits ≈ 3.5s of uninterrupted fire** (11 hits
  ≈ 5s if they took +40% HP). Slash is the faster kill at 14 × 2.5/s = 35 DPS vs
  Shoot's 36 DPS nominal — but Slash needs to stay inside 1.5 tiles. Combined with
  a 2s / 70% Shield on a 6s cooldown, rounds may run long relative to the 3–5
  minute match target. Worth watching in the first playtest before tuning.
- **Shield uptime is 2s per 8s cycle (25%) at a flat 70% reduction**, which is a
  big effective-HP swing (roughly +21% EHP over the cycle if used perfectly). Since
  it also fully blocks your own Shoot/Slash, it should self-balance, but it's the
  number most likely to need a pass after playtesting.
- **Slash damage boost (+5%/point) is the strongest per-point category** and Slash
  is also the higher-skill option; stacking 10 points there gives 21 damage/hit
  (52.5 DPS in range). Flagging that HP (+4%/pt) and Slash dmg (+5%/pt) may not be
  equally attractive picks.
