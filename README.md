# Arena Clash — Week 1: Core Sim + Basic Combat

A top-down, 3-player free-for-all arena shooter (Soul Knight-style). This is the
Week 1 MVP: core deterministic simulation, the three shared actions (Shoot /
Slash / Shield), pre-match boost allocation, round/match flow, and 3-gamepad /
gamepad+keyboard local play. Abilities, ultimates, the shrinking zone, pickups
and menus are out of scope this week.

## Combat model

All three characters share the same three actions — the numbers live in
`ACTIONS` in `src/sim/config/balance.js`:

| Action | Numbers |
|---|---|
| **Shoot** | 18 damage, 2 shots/s, projectile 14 tiles/s, 10 tile range |
| **Slash** | 14 damage, 2.5 hits/s, 1.5 tile reach, 90° frontal arc, one hit per target per swing |
| **Shield** | 2.0s active, incoming damage −70%, 6.0s cooldown starting when the shield ends; blocks Shoot/Slash while up, movement still allowed |

Characters differ **only** by HP and Speed:

| Stat | Sniper | Berserker | Summoner |
|---|---|---|---|
| HP | 80 | 140 | 100 |
| Speed (tiles/s) | 4.5 | 5.0 | 4.2 |

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
- **Gamepad:** left stick move, right stick aim (holds last direction when idle), **RT** Shoot, **RB** Slash, **LB** Shield, Y reserved (future ultimate).
- **Keyboard/Mouse:** WASD move, mouse aim (toward cursor), left-click Shoot, **E** Slash, **Q** Shield, R reserved (future ultimate).
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
multipliers, collision, spawn invulnerability, round/match
flow (including the double-knockout void case), ult charge, and a static check
that `src/sim/` never imports Phaser/DOM/`window` or calls `Math.random`.

## Changing balance values

Every gameplay number lives in **`src/sim/config/balance.js`** — `ACTIONS`
(Shoot/Slash/Shield), `CHARACTERS` (HP + speed only), boost points and per-point
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
  render/               # Phaser scenes (Join -> Boost -> Game); reads state, never mutates it
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
