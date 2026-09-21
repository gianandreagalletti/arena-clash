import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput } from './helpers.js';
import { CHARACTERS } from '../src/sim/config/balance.js';

test('area damage: one Arcane Bolt explosion damages two enemies standing 0.5 tiles from impact', () => {
  let state = newPlayingGame(4, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);

  // Summoner (index 2) at (5,6) fires +x. Sniper (index 0) sits directly on the
  // aim line at (8,6) — a guaranteed direct hit with zero aim-assist bend.
  // Berserker (index 1) stands 0.5 tiles from the sniper's position, well
  // within the 0.75-tile explosion radius of the resulting impact point.
  // y=6 keeps all three clear of the cover ring (nearest block spans y 7.5-8.5).
  state.players[2].x = 5;
  state.players[2].y = 6;
  state.players[0].x = 8;
  state.players[0].y = 6;
  state.players[1].x = 8;
  state.players[1].y = 6.5;

  const fire = makeInput({ fire: true, aimX: 1, aimY: 0 });
  const neutral = makeInput();

  // Single fire frame (avoid a second shot landing within the 0.5s cooldown window).
  state = step(state, [neutral, neutral, fire]);
  for (let i = 0; i < 40; i++) {
    state = step(state, [neutral, neutral, neutral]);
  }

  const explodeDamage = CHARACTERS.summoner.attack.damage;
  assert.strictEqual(state.players[0].damageTaken, explodeDamage);
  assert.strictEqual(state.players[1].damageTaken, explodeDamage);
  assert.strictEqual(state.players[2].damageTaken, 0); // no self-damage
});
