import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/sim/state.js';
import { step, neutralInputs } from './helpers.js';
import { applyDamage } from '../src/sim/systems/damage.js';
import { beginRound } from '../src/sim/systems/round.js';

test('ult charge: matches the formula after a scripted fight, and 50% carries to the next round', () => {
  let state = createInitialState(11, ['sniper', 'berserker', 'summoner']);
  while (state.roundState === 'countdown') state = step(state, neutralInputs());
  for (const p of state.players) p.invulnUntilTick = state.tick;

  const [p0, p1] = state.players;

  // Non-lethal hit: +1/HP dealt to attacker, +0.5/HP taken to victim.
  applyDamage(state, p1, 10, p0);
  assert.strictEqual(p0.ultCharge, 10);
  assert.strictEqual(p1.ultCharge, 5);

  // Bring the victim to low HP directly (test setup, not a damage event) so the
  // finishing blow can be small — keeping totals well under the 100 charge cap
  // lets this test check the raw per-HP formula instead of clamped output.
  p1.hp = 5;
  const killAmount = 5;
  applyDamage(state, p1, killAmount, p0);
  assert.strictEqual(p1.alive, false);
  assert.strictEqual(p0.ultCharge, 10 + killAmount * 1 + 20);
  assert.strictEqual(p1.ultCharge, 5 + killAmount * 0.5);

  // Carry-over: 50% of current charge, floored, survives into the next round.
  const expectedP0Carry = Math.floor(p0.ultCharge * 0.5);
  const expectedP1Carry = Math.floor(p1.ultCharge * 0.5);
  beginRound(state, { carryUlt: true });

  assert.strictEqual(p0.ultCharge, expectedP0Carry);
  assert.strictEqual(p1.ultCharge, expectedP1Carry);
  // beginRound also resets round state fully.
  assert.strictEqual(p1.alive, true);
  assert.strictEqual(p1.hp, p1.maxHp);
});
