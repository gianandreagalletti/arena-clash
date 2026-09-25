import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput } from './helpers.js';
import { TICK_RATE, CHARACTERS, shootConfigFor } from '../src/sim/config/balance.js';

/** Holds Shoot for `seconds` down an empty lane and returns how many shots were fired. */
function countShots(characterId, seconds) {
  let state = newPlayingGame(2, [characterId, 'berserker', 'summoner']);
  clearInvuln(state);

  // Fire down an empty lane (far from the other spawns) so a stray hit can't
  // end the round early and stop the shot count mid-test.
  state.players[0].x = 2;
  state.players[0].y = 2;

  const fireInput = makeInput({ fire: true, aimX: 1, aimY: 0 });
  const neutral = makeInput();

  for (let i = 0; i < seconds * TICK_RATE; i++) {
    state = step(state, [fireInput, neutral, neutral]);
  }
  return state.nextProjectileId - 1;
}

test('fire rate: every character fires at exactly its own configured rate', () => {
  const SECONDS = 6;
  for (const characterId of Object.keys(CHARACTERS)) {
    const cooldown = shootConfigFor(characterId).cooldownTicks;
    // First shot on tick 1, then one every `cooldown` ticks.
    const expected = Math.floor((SECONDS * TICK_RATE - 1) / cooldown) + 1;
    assert.strictEqual(countShots(characterId, SECONDS), expected, `character ${characterId}`);
  }
});

test('fire rate: the shared baseline is 12 shots in 6s, and Sniper fires far fewer', () => {
  const baselineShots = countShots('berserker', 6);
  const sniperShots = countShots('sniper', 6);

  assert.strictEqual(baselineShots, 12); // 2 shots/s
  assert.ok(sniperShots < baselineShots, `Sniper should fire less often, got ${sniperShots} vs ${baselineShots}`);
});
