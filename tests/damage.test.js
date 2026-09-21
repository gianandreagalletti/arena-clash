import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput } from './helpers.js';
import { createInitialState } from '../src/sim/state.js';
import { ACTIONS, BOOST_BONUS_PER_POINT, CHARACTERS } from '../src/sim/config/balance.js';

const neutral = makeInput();
const shootInput = makeInput({ fire: true, aimX: 1, aimY: 0 });

/** Puts the shooter at (5,5) and the target 2 tiles to its right, clear of cover. */
function faceOff(state) {
  clearInvuln(state);
  state.players[0].x = 5;
  state.players[0].y = 5;
  state.players[1].x = 7;
  state.players[1].y = 5;
  return state;
}

test('shoot: a single hit deals exactly the configured Shoot damage (18)', () => {
  let state = faceOff(newPlayingGame(1, ['sniper', 'berserker', 'summoner']));

  state = step(state, [shootInput, neutral, neutral]);
  for (let i = 0; i < 29; i++) state = step(state, [neutral, neutral, neutral]);

  assert.strictEqual(ACTIONS.shoot.damage, 18);
  assert.strictEqual(state.players[1].damageTaken, 18);
  assert.strictEqual(state.players[1].hp, state.players[1].maxHp - 18);
});

test('shoot: every character shoots for the same damage', () => {
  for (const characterId of Object.keys(CHARACTERS)) {
    let state = faceOff(newPlayingGame(2, [characterId, 'berserker', 'summoner']));

    state = step(state, [shootInput, neutral, neutral]);
    for (let i = 0; i < 29; i++) state = step(state, [neutral, neutral, neutral]);

    assert.strictEqual(state.players[1].damageTaken, ACTIONS.shoot.damage, `attacker ${characterId}`);
  }
});

test('shoot: 8 hits kill an unboosted 140 HP target, but not one with +40% HP', () => {
  // 8 shots at 18 dmg = 144 > 140 (unboosted Berserker) but < 196 (+40% HP).
  const SHOTS = 8;
  const TICKS = 1 + (SHOTS - 1) * ACTIONS.shoot.cooldownTicks + 30; // last shot + travel

  const runFight = (boostAllocations) => {
    let state = createInitialState(3, ['sniper', 'berserker', 'summoner'], boostAllocations);
    while (state.roundState === 'countdown') state = step(state, [neutral, neutral, neutral]);
    faceOff(state);
    for (let i = 0; i < TICKS; i++) state = step(state, [shootInput, neutral, neutral]);
    return state.players[1];
  };

  const unboosted = runFight(undefined);
  assert.strictEqual(unboosted.alive, false);
  assert.strictEqual(unboosted.hp, 0);

  const tanky = runFight([undefined, { hp: 10, speed: 0, shootDmg: 0, slashDmg: 0 }, undefined]);
  const expectedMaxHp = CHARACTERS.berserker.hp * (1 + BOOST_BONUS_PER_POINT.hp * 10);
  assert.strictEqual(tanky.alive, true);
  assert.strictEqual(tanky.maxHp, expectedMaxHp);
  assert.strictEqual(tanky.hp, expectedMaxHp - SHOTS * ACTIONS.shoot.damage);
});
