import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput } from './helpers.js';
import { ACTIONS, CHARACTERS } from '../src/sim/config/balance.js';

const CHARACTER_IDS = Object.keys(CHARACTERS);

/**
 * Attacker (player 1) at (10,8) aiming +x, target (player 0) at `targetX`.
 * Both positions are clear of cover blocks, so the movement pass leaves them put.
 * Every player uses `characterId` — Slash is shared, so it must behave identically.
 */
function swingAt(characterId, targetX) {
  let state = newPlayingGame(3, [characterId, characterId, characterId]);
  clearInvuln(state);
  state.players[1].x = 10;
  state.players[1].y = 8;
  state.players[0].x = targetX;
  state.players[0].y = 8;

  const slash = makeInput({ slash: true, aimX: 1, aimY: 0 });
  const neutral = makeInput();
  state = step(state, [neutral, slash, neutral]);
  return state.players[0];
}

test('slash arc: hits a target 1.4 tiles directly in front, for every character', () => {
  for (const characterId of CHARACTER_IDS) {
    const target = swingAt(characterId, 11.4);
    assert.strictEqual(target.hp, target.maxHp - ACTIONS.slash.damage, `attacker ${characterId}`);
  }
});

test('slash arc: misses a target 1.6 tiles directly in front (out of reach), for every character', () => {
  for (const characterId of CHARACTER_IDS) {
    const target = swingAt(characterId, 11.6);
    assert.strictEqual(target.hp, target.maxHp, `attacker ${characterId}`);
  }
});

test('slash arc: misses a target directly behind (outside the 90-degree arc), for every character', () => {
  for (const characterId of CHARACTER_IDS) {
    const target = swingAt(characterId, 8.6); // 1.4 tiles behind an attacker aiming +x
    assert.strictEqual(target.hp, target.maxHp, `attacker ${characterId}`);
  }
});
