import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput } from './helpers.js';
import { COVER_BLOCKS, circleIntersectsRect } from '../src/sim/arena.js';
import { PLAYER_RADIUS_TILES } from '../src/sim/config/balance.js';

test('collision: a projectile stops on a cover block and never reaches a target behind it', () => {
  let state = newPlayingGame(5, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);

  const block = COVER_BLOCKS[0]; // x:16-18, y:7.5-8.5
  const blockCenterY = block.y + block.h / 2;

  state.players[0].x = block.x - 3; // shooter, 3 tiles left of the block
  state.players[0].y = blockCenterY;
  state.players[1].x = block.x + block.w + 3; // target, 3 tiles right of the block
  state.players[1].y = blockCenterY;

  const fire = makeInput({ fire: true, aimX: 1, aimY: 0 });
  const neutral = makeInput();

  state = step(state, [fire, neutral, neutral]);
  for (let i = 0; i < 60; i++) {
    state = step(state, [neutral, neutral, neutral]);
  }

  assert.strictEqual(state.projectiles.length, 0); // it terminated, not still flying
  assert.strictEqual(state.players[1].hp, state.players[1].maxHp); // never reached the target
});

test('collision: a player cannot pass through a cover block', () => {
  let state = newPlayingGame(6, ['sniper', 'berserker', 'summoner']);

  const block = COVER_BLOCKS[0];
  const blockCenterY = block.y + block.h / 2;
  state.players[0].x = block.x - 1;
  state.players[0].y = blockCenterY;

  const pushRight = makeInput({ moveX: 1, moveY: 0 });
  const neutral = makeInput();

  for (let i = 0; i < 120; i++) {
    state = step(state, [pushRight, neutral, neutral]);
  }

  assert.strictEqual(
    circleIntersectsRect(state.players[0].x, state.players[0].y, PLAYER_RADIUS_TILES, block),
    false
  );
  assert.ok(state.players[0].x <= block.x); // stopped at (or before) the block's left edge
});

test('collision: a player cannot pass through the arena edge', () => {
  let state = newPlayingGame(7, ['sniper', 'berserker', 'summoner']);

  state.players[0].x = 1;
  state.players[0].y = 8;

  const pushLeft = makeInput({ moveX: -1, moveY: 0 });
  const neutral = makeInput();

  for (let i = 0; i < 60; i++) {
    state = step(state, [pushLeft, neutral, neutral]);
  }

  assert.strictEqual(state.players[0].x, PLAYER_RADIUS_TILES);
});
