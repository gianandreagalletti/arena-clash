import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/sim/state.js';
import { step, neutralInputs } from './helpers.js';
import { applyDamage } from '../src/sim/systems/damage.js';
import { checkRoundEnd, tickRecap } from '../src/sim/systems/round.js';

test('round/match: last player alive wins the round, and 3 round wins end the match', () => {
  let state = createInitialState(9, ['sniper', 'berserker', 'summoner']);
  // Skip the initial countdown so invuln is already resolved for direct applyDamage calls.
  while (state.roundState === 'countdown') state = step(state, neutralInputs());

  for (let round = 1; round <= 3; round++) {
    for (const p of state.players) p.invulnUntilTick = state.tick; // clear spawn invuln for this scripted hit
    // Player 0 lands the killing blow on players 1 and 2.
    applyDamage(state, state.players[1], 9999, state.players[0]);
    applyDamage(state, state.players[2], 9999, state.players[0]);

    checkRoundEnd(state);

    assert.strictEqual(state.roundState, 'recap');
    assert.strictEqual(state.players[0].roundsWon, round);
    assert.strictEqual(state.logs.length, round);
    assert.strictEqual(state.logs[round - 1].winnerId, 0);

    // Drain the recap timer by exactly its starting value: tickRecap transitions
    // out of 'recap' on the call where the timer reaches 0, so capture the bound
    // up front rather than re-reading the live (decrementing) property.
    const recapTicks = state.roundStateTimerTicks;
    for (let i = 0; i < recapTicks; i++) tickRecap(state);

    if (round < 3) {
      assert.strictEqual(state.pendingMatchOver, false);
      assert.strictEqual(state.roundState, 'countdown');
      assert.strictEqual(state.roundNumber, round + 1);
      for (const p of state.players) assert.strictEqual(p.alive, true);
    } else {
      assert.strictEqual(state.pendingMatchOver, true);
      assert.strictEqual(state.roundState, 'matchOver');
      assert.strictEqual(state.matchWinner, 0);
    }
  }
});

test('round/match: a triple (all-dead) knockout voids the round and replays it without a win', () => {
  let state = createInitialState(10, ['sniper', 'berserker', 'summoner']);
  while (state.roundState === 'countdown') state = step(state, neutralInputs());

  const roundNumberBefore = state.roundNumber;
  for (const p of state.players) p.invulnUntilTick = state.tick; // clear spawn invuln for this scripted hit

  // All three die simultaneously (e.g. to a hazard, credited to no one).
  applyDamage(state, state.players[0], 9999, null);
  applyDamage(state, state.players[1], 9999, null);
  applyDamage(state, state.players[2], 9999, null);

  checkRoundEnd(state);

  assert.strictEqual(state.voidRoundThisTick, true);
  assert.strictEqual(state.logs.length, 0); // no round log for a voided round
  for (const p of state.players) assert.strictEqual(p.roundsWon, 0);
  assert.strictEqual(state.roundNumber, roundNumberBefore); // replayed, not advanced
  assert.strictEqual(state.roundState, 'countdown');
  for (const p of state.players) {
    assert.strictEqual(p.alive, true);
    assert.strictEqual(p.hp, p.maxHp);
  }
});
