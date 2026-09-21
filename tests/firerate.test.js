import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput } from './helpers.js';

test('fire rate: holding Shoot for 6s fires exactly 12 shots (2/s)', () => {
  let state = newPlayingGame(2, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);

  // Fire down an empty lane (far from the other spawns) so a stray hit can't
  // end the round early and stop the shot count mid-test.
  state.players[0].x = 2;
  state.players[0].y = 2;

  const fireInput = makeInput({ fire: true, aimX: 1, aimY: 0 });
  const neutral = makeInput();

  const TICKS_IN_6S = 6 * 60;
  for (let i = 0; i < TICKS_IN_6S; i++) {
    state = step(state, [fireInput, neutral, neutral]);
  }

  assert.strictEqual(state.nextProjectileId - 1, 12);
});
