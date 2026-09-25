import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput } from './helpers.js';
import { createInitialState } from '../src/sim/state.js';
import { ACTIONS, BOOST_BONUS_PER_POINT, CHARACTERS, shootConfigFor } from '../src/sim/config/balance.js';

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

test('shoot: one hit deals exactly that character\'s configured Shoot damage', () => {
  for (const characterId of Object.keys(CHARACTERS)) {
    let state = faceOff(newPlayingGame(1, [characterId, 'berserker', 'summoner']));

    state = step(state, [shootInput, neutral, neutral]);
    for (let i = 0; i < 29; i++) state = step(state, [neutral, neutral, neutral]);

    const expected = shootConfigFor(characterId).damage;
    assert.strictEqual(state.players[1].damageTaken, expected, `attacker ${characterId}`);
    assert.strictEqual(state.players[1].hp, state.players[1].maxHp - expected, `attacker ${characterId}`);
  }
});

test('shoot: Sniper hits far harder per shot than the shared baseline', () => {
  // The identity, asserted as a relationship rather than a literal, so tuning
  // the exact numbers doesn't silently erase the character's whole point.
  const sniper = shootConfigFor('sniper');
  const baseline = ACTIONS.shoot;

  assert.ok(
    sniper.damage >= baseline.damage * 1.5,
    `Sniper should hit much harder than baseline, got ${sniper.damage} vs ${baseline.damage}`
  );
  assert.ok(
    sniper.cooldownTicks > baseline.cooldownTicks,
    `...and pay for it in rate of fire, got ${sniper.cooldownTicks} vs ${baseline.cooldownTicks} ticks`
  );
  assert.ok(
    sniper.projectileSpeedTilesPerSec > baseline.projectileSpeedTilesPerSec,
    'Sniper rounds should fly faster than baseline'
  );
  // Berserker and Summoner stay on the shared baseline.
  assert.strictEqual(shootConfigFor('berserker').damage, baseline.damage);
  assert.strictEqual(shootConfigFor('summoner').damage, baseline.damage);
});

test('shoot: 8 baseline hits kill an unboosted 140 HP target, but not one with +40% HP', () => {
  // 8 shots at 18 dmg = 144 > 140 (unboosted Berserker) but < 196 (+40% HP).
  // Uses a baseline shooter on purpose — Sniper's numbers are tested above.
  const SHOTS = 8;
  const TICKS = 1 + (SHOTS - 1) * ACTIONS.shoot.cooldownTicks + 30; // last shot + travel

  const runFight = (boostAllocations) => {
    let state = createInitialState(3, ['berserker', 'berserker', 'summoner'], boostAllocations);
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
