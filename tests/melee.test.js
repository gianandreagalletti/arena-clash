import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput } from './helpers.js';

function setup() {
  const state = newPlayingGame(3, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);
  state.players[1].x = 10;
  state.players[1].y = 8;
  return state;
}

test('melee arc: Berserker slash hits a target 1.4 tiles directly in front', () => {
  let state = setup();
  state.players[0].x = 11.4; // sniper = target
  state.players[0].y = 8;

  const swing = makeInput({ fire: true, aimX: 1, aimY: 0 });
  const neutral = makeInput();
  state = step(state, [neutral, swing, neutral]);

  assert.strictEqual(state.players[0].hp, state.players[0].maxHp - 12);
});

test('melee arc: Berserker slash misses a target 1.6 tiles directly in front (out of reach)', () => {
  let state = setup();
  state.players[0].x = 11.6;
  state.players[0].y = 8;

  const swing = makeInput({ fire: true, aimX: 1, aimY: 0 });
  const neutral = makeInput();
  state = step(state, [neutral, swing, neutral]);

  assert.strictEqual(state.players[0].hp, state.players[0].maxHp);
});

test('melee arc: Berserker slash misses a target directly behind (outside the 90-degree arc)', () => {
  let state = setup();
  state.players[0].x = 8.6; // 1.4 tiles behind the attacker, who is aiming +x
  state.players[0].y = 8;

  const swing = makeInput({ fire: true, aimX: 1, aimY: 0 });
  const neutral = makeInput();
  state = step(state, [neutral, swing, neutral]);

  assert.strictEqual(state.players[0].hp, state.players[0].maxHp);
});
