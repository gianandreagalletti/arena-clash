import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput } from './helpers.js';
import { COVER_BLOCKS, closestPointOnRect } from '../src/sim/arena.js';
import { ACTIONS, PLAYER_RADIUS_TILES } from '../src/sim/config/balance.js';
import { readGamepadFrame } from '../src/input/gamepad.js';
import { readKeyboardMouseFrame } from '../src/input/keyboardMouse.js';

const neutral = makeInput();
const SPEED = ACTIONS.shoot.projectileSpeedTilesPerSec;

/** Moves the two non-shooting players far out of the way so tests are about geometry only. */
function clearBystanders(state, ...positions) {
  state.players[1].x = positions[0].x;
  state.players[1].y = positions[0].y;
  state.players[2].x = positions[1].x;
  state.players[2].y = positions[1].y;
}

test('projectile range: a target 20 tiles away in a clear line still gets hit', () => {
  let state = newPlayingGame(11, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);

  // The y = 2 lane is clear of every cover block (their y bands are 3.17-4.17,
  // 7.5-8.5 and 11.83-12.83), so this is a straight 20-tile shot.
  state.players[0].x = 2;
  state.players[0].y = 2;
  state.players[1].x = 22; // 20 tiles away — beyond the old 10-tile range
  state.players[1].y = 2;
  state.players[2].x = 2;
  state.players[2].y = 14;

  const fire = makeInput({ fire: true, aimX: 1, aimY: 0 });
  state = step(state, [fire, neutral, neutral]);
  for (let i = 0; i < 120; i++) state = step(state, [neutral, neutral, neutral]);

  assert.strictEqual(state.players[1].damageTaken, ACTIONS.shoot.damage);
});

test('projectile range: rangeTiles is unlimited, with a lifetime cap as the only leak guard', () => {
  assert.strictEqual(ACTIONS.shoot.rangeTiles, null);
  // 3s at 14 tiles/s = 42 tiles, well past the arena diagonal (~28.8).
  const reachTiles = (ACTIONS.shoot.maxLifetimeTicks / 60) * SPEED;
  assert.ok(reachTiles > 40, `lifetime cap should never trigger in play, got ${reachTiles} tiles`);
});

test('projectile flight: fired at 45 degrees into cover, velocity never changes and it dies on the block', () => {
  let state = newPlayingGame(12, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);

  const block = COVER_BLOCKS[0]; // x:16-18, y:7.5-8.5
  state.players[0].x = 14;
  state.players[0].y = 5.5; // a 45-degree line from here meets the block's top-left corner
  clearBystanders(state, { x: 2, y: 14 }, { x: 4, y: 14 });

  const fire = makeInput({ fire: true, aimX: 1, aimY: 1 });
  state = step(state, [fire, neutral, neutral]);

  const expected = SPEED / Math.SQRT2;
  const spawned = state.projectiles[0];
  assert.ok(Math.abs(spawned.vx - expected) < 1e-12, 'vx must be the raw 45-degree aim');
  assert.ok(Math.abs(spawned.vy - expected) < 1e-12, 'vy must be the raw 45-degree aim');

  let last = { x: spawned.x, y: spawned.y };
  let ticks = 0;
  while (state.projectiles.length > 0 && ticks < 200) {
    const proj = state.projectiles[0];
    // The velocity vector is constant from spawn to removal — no sliding, no re-routing.
    assert.strictEqual(proj.vx, spawned.vx, `vx changed at tick ${ticks}`);
    assert.strictEqual(proj.vy, spawned.vy, `vy changed at tick ${ticks}`);
    last = { x: proj.x, y: proj.y };
    state = step(state, [neutral, neutral, neutral]);
    ticks += 1;
  }

  assert.strictEqual(state.projectiles.length, 0, 'projectile should have terminated on the block');

  // It died ON the block, not past it: the last observed position is within one
  // tick of travel (plus its radius) of the block's surface.
  const closest = closestPointOnRect(last.x, last.y, block);
  const gap = Math.hypot(last.x - closest.x, last.y - closest.y);
  const oneTick = SPEED / 60;
  assert.ok(gap <= oneTick + ACTIONS.shoot.projectileRadiusTiles + 1e-9, `died ${gap} tiles from the block`);
  assert.ok(last.x < block.x + block.w, 'never travelled through to the far side of the block');
});

test('no aim assist: an opponent 5 degrees off the line does not bend the shot (gamepad and keyboard)', () => {
  const OFFSET_DEG = 5;
  const DIST = 10;
  const rad = (OFFSET_DEG * Math.PI) / 180;

  // A crosshair 3 tiles to the right of the player, and a right stick pushed
  // fully right: both mean "aim exactly +x".
  const playerWorld = { x: 2, y: 2 };
  const keyboardFrame = readKeyboardMouseFrame(
    { w: false, a: false, s: false, d: false, q: false, e: false, r: false },
    { x: playerWorld.x + 3, y: playerWorld.y },
    playerWorld,
    true // left mouse held = Shoot
  );
  const gamepadFrame = readGamepadFrame({
    leftStick: { x: 0, y: 0 },
    rightStick: { x: 1, y: 0 },
    R2: 1, // RT = Shoot
    R1: false,
    L1: false,
  });

  for (const [label, frame] of [['keyboard', keyboardFrame], ['gamepad', gamepadFrame]]) {
    let state = newPlayingGame(13, ['sniper', 'berserker', 'summoner']);
    clearInvuln(state);

    state.players[0].x = playerWorld.x;
    state.players[0].y = playerWorld.y;
    // Opponent sits 5 degrees off the aim line — squarely inside the (disabled)
    // 20-degree assist cone, so this is exactly the shot assist used to grab.
    state.players[1].x = playerWorld.x + Math.cos(rad) * DIST;
    state.players[1].y = playerWorld.y + Math.sin(rad) * DIST;
    state.players[2].x = 2;
    state.players[2].y = 14;

    assert.ok(frame.fire, `${label} frame should be firing`);
    state = step(state, [frame, neutral, neutral]);

    const proj = state.projectiles[0];
    assert.strictEqual(proj.vy, 0, `${label}: direction must equal the raw input aim exactly`);
    assert.ok(Math.abs(proj.vx - SPEED) < 1e-12, `${label}: full speed straight down the aim line`);

    for (let i = 0; i < 120; i++) state = step(state, [neutral, neutral, neutral]);
    assert.strictEqual(state.players[1].damageTaken, 0, `${label}: the shot should miss, not curve in`);
  }
});

test('point-blank wall: firing into a wall you are touching kills the shot at once, going nowhere else', () => {
  let state = newPlayingGame(14, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);

  state.players[0].x = PLAYER_RADIUS_TILES; // flush against the left wall
  state.players[0].y = 8;
  clearBystanders(state, { x: 10, y: 14 }, { x: 12, y: 14 });

  const fire = makeInput({ fire: true, aimX: -1, aimY: 0 });
  state = step(state, [fire, neutral, neutral]);

  const spawned = state.projectiles[0];
  assert.strictEqual(spawned.vx, -SPEED);
  assert.strictEqual(spawned.vy, 0);

  let ticks = 0;
  while (state.projectiles.length > 0 && ticks < 10) {
    const proj = state.projectiles[0];
    assert.strictEqual(proj.vx, -SPEED, 'never deflected');
    assert.strictEqual(proj.vy, 0, 'never picked up a sideways component');
    assert.ok(proj.x <= PLAYER_RADIUS_TILES, 'only ever moved toward the wall');
    state = step(state, [neutral, neutral, neutral]);
    ticks += 1;
  }

  assert.strictEqual(state.projectiles.length, 0);
  assert.ok(ticks <= 3, `should die on the wall almost immediately, took ${ticks} ticks`);
  assert.strictEqual(state.players[1].damageTaken, 0);
  assert.strictEqual(state.players[2].damageTaken, 0);
});
