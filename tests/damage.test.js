import test from 'node:test';
import assert from 'node:assert/strict';
import { step, NEUTRAL_INPUT, newPlayingGame, clearInvuln, makeInput } from './helpers.js';

test('damage: Sniper hits Berserker 4 times -> Berserker dies (140 HP / 35 dmg)', () => {
  let state = newPlayingGame(1, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);

  state.players[0].x = 5;
  state.players[0].y = 5;
  state.players[1].x = 7;
  state.players[1].y = 5;

  const fireInput = makeInput({ fire: true, aimX: 1, aimY: 0 });
  const neutral = makeInput();

  // 4 shots need 4 * 72 ticks of cooldown spacing + travel time; run generous margin.
  for (let i = 0; i < 340; i++) {
    state = step(state, [fireInput, neutral, neutral]);
  }

  assert.strictEqual(state.players[1].alive, false);
  assert.strictEqual(state.players[1].hp, 0);
  assert.strictEqual(state.players[1].deathTick !== null, true);
  assert.strictEqual(state.players[0].alive, true);
});
