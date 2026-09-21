# Arena Clash — Week 1: Core Sim + Basic Combat

A top-down, 3-player free-for-all arena shooter (Soul Knight-style). This is the
Week 1 MVP: core deterministic simulation, basic attacks for all 3 characters,
round/match flow, and 3-gamepad / gamepad+keyboard local play. Abilities,
ultimates, the shrinking zone, pickups and menus are out of scope this week.

## Running it

```bash
npm install
npm run dev
```

Opens the join screen at `http://localhost:5173`. Build for itch.io later with `npm run build` (output in `dist/`).

### Playing

- Join screen: each device claims a slot. **Gamepad:** press **A** to join, **B** to leave. **Keyboard/Mouse:** press **Enter** or **left-click** to join, **Esc** to leave.
- Once all 3 slots (P1–P3) are filled, any joined player presses **Start** (gamepad) or **Space** to begin.
- **F1** toggles debug solo mode at any time: the keyboard controls player index 0 directly, bypassing the join screen (handy for solo testing without 3 controllers).
- **Gamepad:** left stick move, right stick aim (holds last direction when idle), **RT** fire, LB/RB/Y reserved for ability1/ability2/ultimate (unused this week).
- **Keyboard/Mouse:** WASD move, mouse aim (toward cursor), left-click fire, Q/E/R reserved for ability1/ability2/ultimate.
- A round ends when one player is left standing; first to 3 round wins takes the match. At the match-over screen, press **A** (gamepad) or **Space** to rematch.

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
test-runner dependency) against `tests/*.test.js`. Covers determinism, damage,
fire rate, melee arc, area damage, collision, spawn invulnerability, round/match
flow (including the double-knockout void case), ult charge, and a static check
that `src/sim/` never imports Phaser/DOM/`window` or calls `Math.random`.

## Changing balance values

Every gameplay number lives in **`src/sim/config/balance.js`** — HP, speed,
damage, cooldowns, ranges, aim assist, invuln duration, round/match timers, ult
charge formula. Nothing else in `src/sim/` hardcodes a number. `src/sim/characters/*.js`
are thin re-exports of `balance.js`'s `CHARACTERS` entries (kept as separate files
per-character for organization; the numbers themselves live in one place).

## Architecture

```
src/
  sim/                  # pure gameplay logic — zero Phaser/DOM/window, no Math.random
    config/balance.js   # single source of truth for every gameplay number
    state.js            # createInitialState(seed, characterIds)
    step.js             # step(state, inputs) -> newState (fixed 60 ticks/s)
    systems/            # movement, projectiles, melee, damage, round
    characters/         # sniper.js, berserker.js, summoner.js (thin balance.js wrappers)
    arena.js             # Courtyard layout + collision geometry helpers
    log.js               # end-of-round log builder + console printer
  input/                # device -> InputFrame mapping, join-screen device manager
  render/               # Phaser scenes; reads state, draws, never mutates it
tests/                  # offline node:test sim tests (no browser)
```

`step(state, inputs)` never mutates `state` (it `structuredClone`s internally),
so the same seed + same input sequence always replays identically — verified by
the determinism test. Ticks are integers; all `*Sec` config values are converted
to `*Ticks` once, at module load, via `secToTicks()`.

## Deviations from the brief (flagged, not silently fixed)

- **Cover block shape/placement.** The brief asks for 6 cover blocks with
  "120° rotational symmetry." True continuous rotation of an axis-aligned 2×1
  rectangle only exists at 90°/180° multiples, so `arena.js` places all 6 blocks
  (each a literal 2×1 axis-aligned rect) around a ring every 60° — which trivially
  satisfies 120° symmetry (and then some) but isn't a "true" rotated hexagon of
  blocks. Flagging in case the intended look was closer to a pinwheel with blocks
  actually rotated to face the center.
- **Per-device aim-assist override (`AIM_ASSIST_ENABLED_BY_DEVICE` in balance.js)
  is unused.** The brief says "make it overridable per device type," but also says
  "the sim never knows which device a player uses." Those two rules conflict:
  aim-assist bending needs enemy positions (sim state), which only `sim/` can see
  cheaply, but `sim/` can't know device identity. The config knob is kept, documented,
  and wired to nothing — a real per-device toggle would need the input layer to
  pass a per-player "assist enabled" flag through the InputFrame (or a side channel),
  which isn't in the brief's fixed InputFrame shape. Left for a conscious decision
  rather than silently picking one interpretation.
- **Void-round ult charge.** The brief specifies 50% ult carry-over between rounds,
  but doesn't say what happens to ult charge on a voided (double-knockout) round
  replay. Implemented as: void rounds do **not** apply the 50%-carry reduction
  (charge is left exactly as it was, since nothing was "won" or "lost") — only a
  real round win triggers the halving. Worth confirming this matches intent.
- **Projectile-cover collision is sub-stepped (4 substeps/tick), not fully swept.**
  At max projectile speed (18 tiles/s ≈ 0.3 tiles/tick) against the thinnest cover
  (1 tile), tunneling risk is low but not mathematically zero at extreme angles.
  Good enough for the MVP; a true swept-circle-vs-AABB check would close the gap
  if it ever shows up in playtesting.
- **Player-vs-player collision is not implemented.** The brief doesn't mention it,
  so players currently pass through each other freely (only cover blocks and arena
  edges block movement). Flagging since some arena shooters block on players too.
- **Spawn invulnerability makes a player fully untargetable**, not just
  damage-immune: projectiles pass through them and melee can't select them at all
  (rather than "hits register but deal 0"). Simpler to reason about and test;
  flagging in case the intended feel was "you can still be shoved/interrupted,
  just not hurt."

## Numbers that felt off during implementation

- **Sniper 1-shot potential vs. low-HP kits:** 35 damage / 1.2s cooldown means a
  Sniper needs exactly 4 hits on Berserker (140 HP) but only 3 on Summoner (100 HP,
  rounds up from 2.86) and lands a Sniper-vs-Sniper (80 HP) kill in 3 hits too.
  Not obviously wrong, just worth a playtest gut-check since Sniper's DPS (29.2/s)
  is meaningfully higher than Berserker's sustained melee DPS (36/s only while in
  range and unblocked) once you factor in the 14-tile range advantage.
- **Berserker's 90°/1.5-tile slash vs. a 5.0 tiles/s move speed** means kiting a
  Berserker at max range is easy for Sniper/Summoner; didn't change anything, but
  Week 2 abilities will need to give Berserker *some* gap-closer or this matchup
  may feel one-sided in playtests.
