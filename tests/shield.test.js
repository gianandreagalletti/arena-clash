import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput } from './helpers.js';
import { applyDamage } from '../src/sim/systems/damage.js';
import { ACTIONS } from '../src/sim/config/balance.js';

const neutral = makeInput();
const shieldInput = makeInput({ shield: true });
const HIT = 10;
const SHIELDED_HIT = HIT * (1 - ACTIONS.shield.damageReduction); // 70% reduction

function raiseShield(state) {
  return step(state, [shieldInput, neutral, neutral]);
}

function advance(state, ticks) {
  let s = state;
  for (let i = 0; i < ticks; i++) s = step(s, [neutral, neutral, neutral]);
  return s;
}

test('shield: damage taken during the 2s window is reduced by exactly 70%', () => {
  let state = newPlayingGame(1, ['berserker', 'sniper', 'summoner']);
  clearInvuln(state);

  state = raiseShield(state);
  assert.strictEqual(state.players[0].shieldActiveUntilTick, state.tick + ACTIONS.shield.durationTicks);

  applyDamage(state, state.players[0], HIT, state.players[1]);

  assert.strictEqual(state.players[0].damageTaken, SHIELDED_HIT);
  assert.ok(Math.abs(SHIELDED_HIT - 3) < 1e-9, '10 damage through a 70% shield is 3');
  assert.strictEqual(state.players[0].hp, state.players[0].maxHp - SHIELDED_HIT);
});

test('shield: damage taken right after the window ends is full', () => {
  let state = newPlayingGame(2, ['berserker', 'sniper', 'summoner']);
  clearInvuln(state);

  state = raiseShield(state);
  state = advance(state, ACTIONS.shield.durationTicks); // shield expires exactly now

  assert.ok(state.tick >= state.players[0].shieldActiveUntilTick);
  applyDamage(state, state.players[0], HIT, state.players[1]);

  assert.strictEqual(state.players[0].damageTaken, HIT);
});

test('shield: pressing Shield again during its 6s cooldown does nothing', () => {
  let state = newPlayingGame(3, ['berserker', 'sniper', 'summoner']);
  clearInvuln(state);

  state = raiseShield(state);
  const firstActiveUntil = state.players[0].shieldActiveUntilTick;
  const readyAt = state.players[0].shieldReadyAtTick;
  assert.strictEqual(readyAt, firstActiveUntil + ACTIONS.shield.cooldownTicks);

  // Mid-shield re-press: no refresh.
  state = raiseShield(state);
  assert.strictEqual(state.players[0].shieldActiveUntilTick, firstActiveUntil);

  // Just after it ends, still on cooldown: no re-raise, damage stays full.
  state = advance(state, ACTIONS.shield.durationTicks);
  state = raiseShield(state);
  assert.strictEqual(state.players[0].shieldActiveUntilTick, firstActiveUntil);
  applyDamage(state, state.players[0], HIT, state.players[1]);
  assert.strictEqual(state.players[0].damageTaken, HIT);

  // Once the cooldown has fully elapsed, Shield works again.
  state = advance(state, readyAt - state.tick);
  state = raiseShield(state);
  assert.strictEqual(state.players[0].shieldActiveUntilTick, state.tick + ACTIONS.shield.durationTicks);
});

test('shield: a shielded player cannot Shoot or Slash, but can still move', () => {
  let state = newPlayingGame(4, ['berserker', 'sniper', 'summoner']);
  clearInvuln(state);
  state.players[0].x = 5;
  state.players[0].y = 5;
  state.players[1].x = 6; // within Slash reach (1.5 tiles) and directly in front
  state.players[1].y = 5;

  const startX = state.players[0].x;
  const busy = makeInput({ shield: true, fire: true, slash: true, moveX: 1, aimX: 1, aimY: 0 });
  for (let i = 0; i < 30; i++) state = step(state, [busy, neutral, neutral]);

  assert.strictEqual(state.nextProjectileId - 1, 0, 'no projectiles spawned while shielded');
  assert.strictEqual(state.players[1].damageTaken, 0, 'no slash damage dealt while shielded');
  assert.ok(state.players[0].x > startX, 'movement still allowed while shielded');
});
