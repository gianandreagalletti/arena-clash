import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput, neutralInputs } from './helpers.js';
import { TICK_RATE, CHARACTERS, ACTIONS, shootConfigFor } from '../src/sim/config/balance.js';

const neutral = makeInput();
const NOVA = CHARACTERS.berserker.nova;
const DOG = CHARACTERS.summoner.dog;

// --- Sniper: high damage, low fire rate ---

/**
 * Fires uninterrupted at a dummy for `seconds` down the clear y = 2 lane and
 * returns damage per second actually delivered.
 */
function measureDps(characterId, seconds) {
  let state = newPlayingGame(31, [characterId, 'berserker', 'summoner']);
  clearInvuln(state);

  state.players[0].x = 2;
  state.players[0].y = 2;
  state.players[1].x = 8;
  state.players[1].y = 2;
  // A dummy that can absorb the whole burst, so the round never ends mid-measure.
  state.players[1].hp = 100000;
  state.players[1].maxHp = 100000;
  state.players[2].x = 2;
  state.players[2].y = 14;

  const fire = makeInput({ fire: true, aimX: 1, aimY: 0 });
  const ticks = seconds * TICK_RATE;
  for (let i = 0; i < ticks; i++) state = step(state, [fire, neutral, neutral]);
  // Let every shot fired inside the window land before measuring.
  for (let i = 0; i < 60; i++) state = step(state, [neutral, neutral, neutral]);

  return state.players[0].damageDealt / seconds;
}

test('sniper: sustained DPS stays inside a tolerance band of the baseline character', () => {
  // The identity is "same damage output, delivered in fewer, heavier hits".
  // This band is the regression guard: retune damage or cooldown freely, but
  // if the two stop cancelling out, this fails and tells you by how much.
  const TOLERANCE = 0.2; // +/-20%
  const SECONDS = 6;

  const baselineDps = measureDps('berserker', SECONDS);
  const sniperDps = measureDps('sniper', SECONDS);
  const ratio = sniperDps / baselineDps;

  assert.ok(baselineDps > 0, 'baseline should actually be dealing damage');
  assert.ok(
    Math.abs(ratio - 1) <= TOLERANCE,
    `Sniper DPS ${sniperDps.toFixed(1)} vs baseline ${baselineDps.toFixed(1)} (ratio ${ratio.toFixed(3)}) ` +
      `is outside the +/-${TOLERANCE * 100}% band — retune sniper.shoot in balance.js`
  );
});

test('sniper: fewer, heavier hits than the baseline over the same window', () => {
  let sniperShots = 0;
  let baselineShots = 0;

  for (const [characterId, counter] of [['sniper', 's'], ['berserker', 'b']]) {
    let state = newPlayingGame(32, [characterId, 'berserker', 'summoner']);
    clearInvuln(state);
    state.players[0].x = 2;
    state.players[0].y = 2;
    const fire = makeInput({ fire: true, aimX: 1, aimY: 0 });
    for (let i = 0; i < 6 * TICK_RATE; i++) state = step(state, [fire, neutral, neutral]);
    if (counter === 's') sniperShots = state.nextProjectileId - 1;
    else baselineShots = state.nextProjectileId - 1;
  }

  assert.ok(sniperShots < baselineShots, `${sniperShots} sniper shots should be fewer than ${baselineShots}`);
  assert.ok(shootConfigFor('sniper').damage > ACTIONS.shoot.damage, 'and each should hit harder');
});

// --- Berserker: telegraphed AoE nova ---

/** A playing state with a full-ult Berserker at (12, 8) and the other two parked. */
function novaSetup(seed = 41) {
  let state = newPlayingGame(seed, ['berserker', 'sniper', 'summoner']);
  clearInvuln(state);
  state.players[0].x = 12;
  state.players[0].y = 8;
  state.players[0].ultCharge = 100;
  state.players[1].x = 2;
  state.players[1].y = 14;
  state.players[2].x = 4;
  state.players[2].y = 14;
  return state;
}

const ultInput = makeInput({ ult: true });

test('nova: damages everything inside the radius, including exactly at the radius, and nothing beyond', () => {
  let state = novaSetup();
  const caster = state.players[0];

  // Well inside, exactly on the boundary, and just outside.
  state.players[1].x = caster.x + NOVA.radiusTiles - 1;
  state.players[1].y = caster.y;
  state.players[2].x = caster.x + NOVA.radiusTiles;
  state.players[2].y = caster.y;

  state = step(state, [ultInput, neutral, neutral]);
  assert.strictEqual(state.players[0].charging, 'nova', 'windup should be a real sim state');

  // Nothing lands during the windup.
  for (let i = 0; i < NOVA.windupTicks - 1; i++) state = step(state, neutralInputs());
  assert.strictEqual(state.players[1].damageTaken, 0, 'no damage before the windup ends');

  state = step(state, neutralInputs()); // release tick
  assert.strictEqual(state.players[0].charging, null);
  assert.strictEqual(state.players[1].damageTaken, NOVA.damage, 'inside the radius');
  assert.strictEqual(state.players[2].damageTaken, NOVA.damage, 'exactly at the radius is inclusive');

  // Now the same setup, but the victim stands just outside.
  let outside = novaSetup(42);
  outside.players[1].x = outside.players[0].x + NOVA.radiusTiles + 0.01;
  outside.players[1].y = outside.players[0].y;
  outside = step(outside, [ultInput, neutral, neutral]);
  for (let i = 0; i < NOVA.windupTicks; i++) outside = step(outside, neutralInputs());
  assert.strictEqual(outside.players[1].damageTaken, 0, 'just outside the radius takes nothing');
});

test('nova: walking out during the windup saves you', () => {
  let state = novaSetup(43);
  state.players[1].x = state.players[0].x + NOVA.radiusTiles - 0.5;
  state.players[1].y = state.players[0].y;

  state = step(state, [ultInput, neutral, neutral]);
  // The victim sprints away for the whole windup.
  const flee = makeInput({ moveX: 1 });
  for (let i = 0; i < NOVA.windupTicks; i++) state = step(state, [neutral, flee, neutral]);

  assert.ok(
    state.players[1].x - state.players[0].x > NOVA.radiusTiles,
    'the victim should have cleared the radius during the windup'
  );
  assert.strictEqual(state.players[1].damageTaken, 0);
});

test('nova: costs ult charge and cannot be re-triggered until the meter refills', () => {
  let state = novaSetup(44);
  state.players[1].x = state.players[0].x + 1;
  state.players[1].y = state.players[0].y;

  state = step(state, [ultInput, neutral, neutral]);
  assert.strictEqual(state.players[0].ultCharge, 100 - NOVA.ultCost, 'cost is paid up front');

  for (let i = 0; i < NOVA.windupTicks; i++) state = step(state, neutralInputs());
  const afterFirst = state.players[1].damageTaken;
  assert.strictEqual(afterFirst, NOVA.damage);

  // Drain the meter below the cost and try again: nothing should happen.
  state.players[0].ultCharge = NOVA.ultCost - 1;
  state = step(state, [ultInput, neutral, neutral]);
  assert.strictEqual(state.players[0].charging, null, 'not enough charge to start a second nova');
  for (let i = 0; i < NOVA.windupTicks + 2; i++) state = step(state, neutralInputs());
  assert.strictEqual(state.players[1].damageTaken, afterFirst, 'no second blast landed');

  // Refill and it works again.
  state.players[0].ultCharge = NOVA.ultCost;
  state = step(state, [ultInput, neutral, neutral]);
  assert.strictEqual(state.players[0].charging, 'nova');
});

test('nova: a dead caster never releases, even with the windup state still set', () => {
  // Belt-and-braces for the "dead players have no sim effect" guard: kill the
  // caster WITHOUT going through applyDamage, so `charging` is deliberately
  // left dangling, and check the release still never fires.
  let state = novaSetup(45);
  state.players[1].x = state.players[0].x + 1;
  state.players[1].y = state.players[0].y;

  state = step(state, [ultInput, neutral, neutral]);
  assert.strictEqual(state.players[0].charging, 'nova');

  state.players[0].hp = 0;
  state.players[0].alive = false;

  for (let i = 0; i < NOVA.windupTicks + 5; i++) state = step(state, neutralInputs());
  assert.strictEqual(state.players[1].damageTaken, 0, 'a dead caster releases nothing');
});

test('nova: dying to real damage mid-windup clears the charge state', () => {
  let state = novaSetup(46);
  state.players[1].x = state.players[0].x + 1;
  state.players[1].y = state.players[0].y;
  state.players[0].hp = 5;

  state = step(state, [ultInput, neutral, neutral]);
  assert.strictEqual(state.players[0].charging, 'nova');

  // Player 2 slashes the charging Berserker down.
  state.players[2].x = state.players[0].x + 1;
  state.players[2].y = state.players[0].y;
  const slash = makeInput({ slash: true, aimX: -1, aimY: 0 });
  state = step(state, [neutral, neutral, slash]);

  assert.strictEqual(state.players[0].alive, false);
  assert.strictEqual(state.players[0].charging, null, 'death must clear the windup');

  const before = state.players[1].damageTaken;
  for (let i = 0; i < NOVA.windupTicks + 5; i++) state = step(state, neutralInputs());
  assert.strictEqual(state.players[1].damageTaken, before, 'no posthumous blast');
});

// --- Summoner: killable, capped, biased dog ---

/** A playing state with the Summoner as player 0. */
function dogSetup(seed = 51) {
  let state = newPlayingGame(seed, ['summoner', 'berserker', 'sniper']);
  clearInvuln(state);
  state.players[0].x = 4;
  state.players[0].y = 2;
  state.players[1].x = 18;
  state.players[1].y = 2;
  state.players[2].x = 18;
  state.players[2].y = 14;
  return state;
}

test('dog: one summon spawns exactly one, and re-summoning while it lives does nothing', () => {
  let state = dogSetup();

  state = step(state, [ultInput, neutral, neutral]);
  assert.strictEqual(state.dogs.length, 1);

  for (let i = 0; i < 10; i++) state = step(state, [ultInput, neutral, neutral]);
  assert.strictEqual(state.dogs.length, 1, 'no stacking while one is alive');
});

test('dog: takes damage like any entity and dies once its HP is gone', () => {
  let state = dogSetup(52);
  state = step(state, [ultInput, neutral, neutral]);
  const dog = state.dogs[0];
  assert.strictEqual(dog.hp, DOG.hp);

  // Slash it down with an enemy standing on top of it.
  const slash = makeInput({ slash: true, aimX: 1, aimY: 0 });
  let guard = 0;
  while (state.dogs.length > 0 && guard < 600) {
    const live = state.dogs[0];
    state.players[1].x = live.x - 0.5;
    state.players[1].y = live.y;
    state.players[1].aimX = 1;
    state.players[1].aimY = 0;
    state = step(state, [neutral, slash, neutral]);
    guard += 1;
  }

  assert.strictEqual(state.dogs.length, 0, 'the dog should be killable');
  assert.ok(guard < 600, 'and should die in reasonable time');
});

test('dog: only re-summonable after the respawn cooldown has elapsed', () => {
  let state = dogSetup(53);
  state = step(state, [ultInput, neutral, neutral]);
  assert.strictEqual(state.dogs.length, 1);

  // Kill it outright.
  state.dogs[0].hp = 0;
  state.dogs[0].alive = false;
  state = step(state, neutralInputs());
  assert.strictEqual(state.dogs.length, 0);

  const readyAt = state.players[0].dogReadyAtTick;
  assert.ok(readyAt > state.tick, 'death should start a respawn cooldown');

  // Holding the button through the cooldown must not summon.
  while (state.tick < readyAt - 1) {
    state = step(state, [ultInput, neutral, neutral]);
    assert.strictEqual(state.dogs.length, 0, `summoned too early at tick ${state.tick}`);
  }

  state = step(state, [ultInput, neutral, neutral]);
  state = step(state, [ultInput, neutral, neutral]);
  assert.strictEqual(state.dogs.length, 1, 'summonable again once the cooldown expires');
});

test('dog: movement is deterministic for a given seed, and biased toward the enemy', () => {
  const runPath = (seed) => {
    let state = dogSetup(seed);
    state = step(state, [ultInput, neutral, neutral]);
    const path = [];
    for (let i = 0; i < 120; i++) {
      state = step(state, neutralInputs());
      if (state.dogs.length > 0) path.push({ x: state.dogs[0].x, y: state.dogs[0].y });
    }
    return path;
  };

  const first = runPath(61);
  const second = runPath(61);
  assert.deepStrictEqual(first, second, 'same seed must produce the same path');

  const other = runPath(62);
  assert.notDeepStrictEqual(first, other, 'a different seed should wander differently');

  // Biased, not pure random: over 2 seconds it should have closed distance on
  // the enemy parked 14 tiles to its right.
  let state = dogSetup(61);
  state = step(state, [ultInput, neutral, neutral]);
  const startDist = Math.hypot(state.players[1].x - state.dogs[0].x, state.players[1].y - state.dogs[0].y);
  for (let i = 0; i < 120; i++) state = step(state, neutralInputs());
  const endDist = Math.hypot(state.players[1].x - state.dogs[0].x, state.players[1].y - state.dogs[0].y);

  assert.ok(endDist < startDist, `dog should close in: ${startDist.toFixed(2)} -> ${endDist.toFixed(2)}`);
});

test('dog: bites enemy players but never its own Summoner', () => {
  let state = dogSetup(54);
  state = step(state, [ultInput, neutral, neutral]);

  // Park the owner right on top of its own dog for a while.
  for (let i = 0; i < 180; i++) {
    if (state.dogs.length > 0) {
      state.players[0].x = state.dogs[0].x;
      state.players[0].y = state.dogs[0].y;
    }
    state = step(state, neutralInputs());
  }
  assert.strictEqual(state.players[0].damageTaken, 0, 'a dog never bites its owner');
});

test('dog: its damage is credited to the Summoner', () => {
  let state = dogSetup(55);
  state = step(state, [ultInput, neutral, neutral]);

  // Glue an enemy to the dog so it gets bitten repeatedly.
  for (let i = 0; i < 180; i++) {
    if (state.dogs.length > 0) {
      state.players[1].x = state.dogs[0].x + 0.4;
      state.players[1].y = state.dogs[0].y;
    }
    state = step(state, neutralInputs());
  }

  assert.ok(state.players[1].damageTaken > 0, 'the dog should have landed bites');
  assert.strictEqual(
    state.players[0].damageDealt,
    state.players[1].damageTaken,
    "the dog's damage belongs on the Summoner's ledger"
  );
});

test('character configs stay independent: each identity lives under its own key', () => {
  assert.ok(CHARACTERS.sniper.shoot, 'sniper overrides Shoot');
  assert.ok(!CHARACTERS.sniper.nova && !CHARACTERS.sniper.dog);

  assert.ok(CHARACTERS.berserker.nova, 'berserker owns the nova');
  assert.ok(!CHARACTERS.berserker.shoot && !CHARACTERS.berserker.dog);

  assert.ok(CHARACTERS.summoner.dog, 'summoner owns the dog');
  assert.ok(!CHARACTERS.summoner.shoot && !CHARACTERS.summoner.nova);
});
