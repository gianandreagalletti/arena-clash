import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, makeInput } from './helpers.js';

test('spawn invulnerability: damage in the first 1.5s (90 ticks) is ignored', () => {
  // Do NOT clear invuln here — the whole point is that it's still active.
  let state = newPlayingGame(8, ['sniper', 'berserker', 'summoner']);

  state.players[0].x = 5;
  state.players[0].y = 5;
  state.players[1].x = 7; // 2 tiles away, well within a couple ticks of round start
  state.players[1].y = 5;

  const fire = makeInput({ fire: true, aimX: 1, aimY: 0 });
  const neutral = makeInput();

  // Fire once, right at round start (tick 1 of 'playing'), then let the shot travel.
  state = step(state, [fire, neutral, neutral]);
  for (let i = 0; i < 20; i++) {
    state = step(state, [neutral, neutral, neutral]);
  }

  assert.strictEqual(state.players[1].hp, state.players[1].maxHp);
  assert.strictEqual(state.players[1].damageTaken, 0);
  assert.ok(state.tick - state.roundStartTick < 90); // still inside the invuln window
});
