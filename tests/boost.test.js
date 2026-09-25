import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/sim/state.js';
import { step, neutralInputs, makeInput, clearInvuln } from './helpers.js';
import { beginRound } from '../src/sim/systems/round.js';
import {
  ACTIONS,
  CHARACTERS,
  BOOST_BONUS_PER_POINT,
  BOOST_POINTS_PER_PLAYER,
  shootConfigFor,
} from '../src/sim/config/balance.js';
import {
  createAllocation,
  addPoint,
  removePoint,
  pointsRemaining,
  moveCursor,
} from '../src/input/boostAllocation.js';

const CHARS = ['sniper', 'berserker', 'summoner'];

test('boost: points apply the documented multiplier to each stat', () => {
  const allocations = [
    { hp: 10, speed: 0, shootDmg: 0, slashDmg: 0 },
    { hp: 0, speed: 4, shootDmg: 3, slashDmg: 3 },
    { hp: 0, speed: 0, shootDmg: 0, slashDmg: 10 },
  ];
  const state = createInitialState(1, CHARS, allocations);

  const [p0, p1, p2] = state.players;

  assert.strictEqual(p0.maxHp, CHARACTERS.sniper.hp * (1 + BOOST_BONUS_PER_POINT.hp * 10));
  assert.strictEqual(p0.hp, p0.maxHp);

  assert.strictEqual(
    p1.speedTilesPerSec,
    CHARACTERS.berserker.speedTilesPerSec * (1 + BOOST_BONUS_PER_POINT.speed * 4)
  );
  assert.strictEqual(
    p1.shootDamage,
    shootConfigFor(p1.characterId).damage * (1 + BOOST_BONUS_PER_POINT.shootDmg * 3)
  );
  assert.strictEqual(p1.slashDamage, ACTIONS.slash.damage * (1 + BOOST_BONUS_PER_POINT.slashDmg * 3));

  assert.strictEqual(p2.slashDamage, ACTIONS.slash.damage * (1 + BOOST_BONUS_PER_POINT.slashDmg * 10));
  // Untouched categories stay at base.
  assert.strictEqual(p2.maxHp, CHARACTERS.summoner.hp);
  assert.strictEqual(p2.shootDamage, shootConfigFor(p2.characterId).damage);
});

test('boost: zero/omitted allocation leaves every stat at base', () => {
  const state = createInitialState(2, CHARS);
  state.players.forEach((p) => {
    const def = CHARACTERS[p.characterId];
    assert.strictEqual(p.maxHp, def.hp);
    assert.strictEqual(p.speedTilesPerSec, def.speedTilesPerSec);
    assert.strictEqual(p.shootDamage, shootConfigFor(p.characterId).damage);
    assert.strictEqual(p.slashDamage, ACTIONS.slash.damage);
    assert.deepStrictEqual(p.boosts, { hp: 0, speed: 0, shootDmg: 0, slashDmg: 0 });
  });
});

test('boost: allocation is read once and stays fixed mid-round and across rounds', () => {
  const allocations = [{ hp: 5, speed: 5, shootDmg: 0, slashDmg: 0 }, undefined, undefined];
  let state = createInitialState(3, CHARS, allocations);

  const expectedMaxHp = CHARACTERS.sniper.hp * (1 + BOOST_BONUS_PER_POINT.hp * 5);
  const expectedSpeed = CHARACTERS.sniper.speedTilesPerSec * (1 + BOOST_BONUS_PER_POINT.speed * 5);

  for (let i = 0; i < 400; i++) state = step(state, neutralInputs());
  assert.strictEqual(state.players[0].maxHp, expectedMaxHp);
  assert.strictEqual(state.players[0].speedTilesPerSec, expectedSpeed);

  // Next round: stats survive the reset, HP refills to the boosted maximum.
  state.players[0].hp = 1;
  beginRound(state, { carryUlt: true });
  assert.strictEqual(state.players[0].maxHp, expectedMaxHp);
  assert.strictEqual(state.players[0].speedTilesPerSec, expectedSpeed);
  assert.strictEqual(state.players[0].hp, expectedMaxHp);
  assert.deepStrictEqual(state.players[0].boosts, { hp: 5, speed: 5, shootDmg: 0, slashDmg: 0 });
});

test('boost: speed points actually make the player move further', () => {
  const boosted = createInitialState(4, CHARS, [
    { hp: 0, speed: 10, shootDmg: 0, slashDmg: 0 },
    undefined,
    undefined,
  ]);
  const plain = createInitialState(4, CHARS);

  const run = (start) => {
    let state = start;
    while (state.roundState === 'countdown') state = step(state, neutralInputs());
    state.players[0].x = 2;
    state.players[0].y = 2;
    const right = makeInput({ moveX: 1 });
    for (let i = 0; i < 60; i++) state = step(state, [right, makeInput(), makeInput()]);
    return state.players[0].x - 2;
  };

  const boostedDistance = run(boosted);
  const plainDistance = run(plain);
  const expectedRatio = 1 + BOOST_BONUS_PER_POINT.speed * 10;
  assert.ok(Math.abs(boostedDistance / plainDistance - expectedRatio) < 1e-9);
});

test('boost: shoot damage points reach actual projectile damage', () => {
  const points = 10;
  let state = createInitialState(5, CHARS, [
    { hp: 0, speed: 0, shootDmg: points, slashDmg: 0 },
    undefined,
    undefined,
  ]);
  while (state.roundState === 'countdown') state = step(state, neutralInputs());
  clearInvuln(state);
  state.players[0].x = 5;
  state.players[0].y = 5;
  state.players[1].x = 7;
  state.players[1].y = 5;

  const shoot = makeInput({ fire: true, aimX: 1, aimY: 0 });
  const neutral = makeInput();
  state = step(state, [shoot, neutral, neutral]);
  for (let i = 0; i < 29; i++) state = step(state, [neutral, neutral, neutral]);

  const expected = shootConfigFor(CHARS[0]).damage * (1 + BOOST_BONUS_PER_POINT.shootDmg * points);
  assert.strictEqual(state.players[1].damageTaken, expected);
});

test('boost: spending more than the budget is rejected', () => {
  assert.throws(
    () => createInitialState(6, CHARS, [{ hp: 6, speed: 5, shootDmg: 0, slashDmg: 0 }, undefined, undefined]),
    /boost points/
  );
});

test('boost allocation UI logic: add/remove respect the budget and floor', () => {
  let allocation = createAllocation();
  assert.strictEqual(pointsRemaining(allocation), BOOST_POINTS_PER_PLAYER);

  for (let i = 0; i < BOOST_POINTS_PER_PLAYER; i++) allocation = addPoint(allocation, 'hp');
  assert.strictEqual(allocation.hp, BOOST_POINTS_PER_PLAYER);
  assert.strictEqual(pointsRemaining(allocation), 0);

  // Budget exhausted: further adds are no-ops, in any category.
  allocation = addPoint(allocation, 'hp');
  allocation = addPoint(allocation, 'speed');
  assert.strictEqual(allocation.hp, BOOST_POINTS_PER_PLAYER);
  assert.strictEqual(allocation.speed, 0);

  // Freeing a point lets another category take it.
  allocation = removePoint(allocation, 'hp');
  allocation = addPoint(allocation, 'slashDmg');
  assert.strictEqual(allocation.hp, BOOST_POINTS_PER_PLAYER - 1);
  assert.strictEqual(allocation.slashDmg, 1);
  assert.strictEqual(pointsRemaining(allocation), 0);

  // Removing at zero is a no-op.
  assert.strictEqual(removePoint(allocation, 'speed').speed, 0);
});

test('boost allocation UI logic: category cursor wraps in both directions', () => {
  assert.strictEqual(moveCursor(0, -1), 3);
  assert.strictEqual(moveCursor(3, 1), 0);
  assert.strictEqual(moveCursor(1, 1), 2);
});
