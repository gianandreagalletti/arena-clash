import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput, neutralInputs, createInitialState } from './helpers.js';
import { applyPickup } from '../src/sim/systems/pickups.js';
import { recomputeDerivedStats } from '../src/sim/state.js';
import { COVER_BLOCKS, circleIntersectsRect, SPAWN_CANDIDATE_TILES } from '../src/sim/arena.js';
import {
  PICKUPS,
  ACTIONS,
  CHARACTERS,
  TICK_RATE,
  ARENA_WIDTH_TILES,
  ARENA_HEIGHT_TILES,
  BOOST_BONUS_PER_POINT,
} from '../src/sim/config/balance.js';

const neutral = makeInput();
const TEMP = PICKUPS.temporary;
const PER = PICKUPS.amulets.perStack;

/** Drops an item on the map by hand, bypassing the spawner, for deterministic setups. */
function placePickup(state, type, family, x, y) {
  const pickup = { id: state.nextPickupId++, type, family, x, y, spawnTick: state.tick };
  state.pickups.push(pickup);
  state.roundPickupEvents.push({
    pickupId: pickup.id,
    type,
    family,
    spawnTick: state.tick,
    outcome: 'uncollected',
    collectedBy: null,
    collectedTick: null,
  });
  return pickup;
}

/** Parks the two non-subject players far away so they never interfere. */
function parkOthers(state) {
  state.players[1].x = 2;
  state.players[1].y = 14;
  state.players[2].x = 4;
  state.players[2].y = 14;
}

// --- Spawning ---

test('spawning: items only appear on valid tiles, and never exceed the per-family cap', () => {
  for (let seed = 1; seed <= 12; seed++) {
    let state = createInitialState(seed, ['sniper', 'berserker', 'summoner']);
    for (let i = 0; i < 2400; i++) {
      state = step(state, neutralInputs());
      if (state.roundState !== 'playing') continue;

      const temps = state.pickups.filter((p) => p.family === 'temporary');
      const amulets = state.pickups.filter((p) => p.family === 'amulet');
      assert.ok(temps.length <= TEMP.maxOnMap, `seed ${seed}: ${temps.length} temporary on map`);
      assert.ok(amulets.length <= PICKUPS.amulets.maxOnMap, `seed ${seed}: ${amulets.length} amulets on map`);

      const seenTiles = new Set();
      for (const pickup of state.pickups) {
        assert.ok(
          pickup.x > 0 && pickup.x < ARENA_WIDTH_TILES && pickup.y > 0 && pickup.y < ARENA_HEIGHT_TILES,
          `seed ${seed}: ${pickup.type} out of bounds at ${pickup.x},${pickup.y}`
        );
        for (const block of COVER_BLOCKS) {
          assert.ok(
            !circleIntersectsRect(pickup.x, pickup.y, PICKUPS.pickupRadius, block),
            `seed ${seed}: ${pickup.type} spawned inside cover`
          );
        }
        const key = `${pickup.x},${pickup.y}`;
        assert.ok(!seenTiles.has(key), `seed ${seed}: two items on the same tile`);
        seenTiles.add(key);
      }
    }
  }
});

test('spawning: a new item is never placed too close to a living player', () => {
  const minDistSq = PICKUPS.minDistFromPlayer * PICKUPS.minDistFromPlayer;

  for (let seed = 20; seed <= 28; seed++) {
    let state = createInitialState(seed, ['sniper', 'berserker', 'summoner']);
    let known = new Set();
    for (let i = 0; i < 2400; i++) {
      const before = state;
      state = step(state, neutralInputs());
      for (const pickup of state.pickups) {
        if (known.has(pickup.id)) continue;
        known.add(pickup.id);
        // Checked against the positions as they were when it spawned.
        for (const player of before.players) {
          if (!player.alive) continue;
          const dx = player.x - pickup.x;
          const dy = player.y - pickup.y;
          assert.ok(
            dx * dx + dy * dy >= minDistSq,
            `seed ${seed}: ${pickup.type} spawned ${Math.hypot(dx, dy).toFixed(2)} tiles from P${player.id + 1}`
          );
        }
      }
    }
  }
});

test('spawning: identical seed and inputs produce identical items at identical ticks', () => {
  const run = () => {
    let state = createInitialState(99, ['sniper', 'berserker', 'summoner']);
    const seen = [];
    for (let i = 0; i < 1800; i++) {
      state = step(state, neutralInputs());
      for (const event of state.roundPickupEvents) {
        if (!seen.some((s) => s.id === event.pickupId)) {
          const live = state.pickups.find((p) => p.id === event.pickupId);
          seen.push({ id: event.pickupId, type: event.type, tick: event.spawnTick, x: live?.x, y: live?.y });
        }
      }
    }
    return { seen, state };
  };

  const a = run();
  const b = run();
  assert.ok(a.seen.length > 0, 'the run should actually spawn something');
  assert.deepStrictEqual(a.seen, b.seen);
  assert.deepStrictEqual(a.state, b.state);
});

test('spawning: candidate tiles are all walkable', () => {
  assert.ok(SPAWN_CANDIDATE_TILES.length > 0);
  for (const tile of SPAWN_CANDIDATE_TILES) {
    for (const block of COVER_BLOCKS) {
      assert.ok(!circleIntersectsRect(tile.x, tile.y, PICKUPS.pickupRadius, block));
    }
  }
});

// --- Collection ---

test('collect: the closest player wins, and an exact tie goes to the lower index', () => {
  // Exact tie: P1 and P2 equidistant either side of the item, both inside the
  // 0.8-tile reach (player radius 0.4 + pickup radius 0.4).
  let tie = newPlayingGame(31, ['sniper', 'berserker', 'summoner']);
  clearInvuln(tie);
  tie.players[0].x = 9.5;
  tie.players[0].y = 2;
  tie.players[1].x = 10.5;
  tie.players[1].y = 2;
  tie.players[2].x = 4;
  tie.players[2].y = 14;
  placePickup(tie, 'medkit', 'temporary', 10, 2);
  tie.players[0].hp = 10;
  tie.players[1].hp = 10;

  tie = step(tie, neutralInputs());
  assert.strictEqual(tie.players[0].pickupsCollected.medkit, 1, 'lower index wins an exact tie');
  assert.strictEqual(tie.players[1].pickupsCollected.medkit, 0);

  // Closer player wins regardless of index.
  let closer = newPlayingGame(32, ['sniper', 'berserker', 'summoner']);
  clearInvuln(closer);
  closer.players[0].x = 9.4;
  closer.players[0].y = 2;
  closer.players[1].x = 10.1;
  closer.players[1].y = 2;
  closer.players[2].x = 4;
  closer.players[2].y = 14;
  placePickup(closer, 'medkit', 'temporary', 10, 2);

  closer = step(closer, neutralInputs());
  assert.strictEqual(closer.players[1].pickupsCollected.medkit, 1, 'the closer player wins');
  assert.strictEqual(closer.players[0].pickupsCollected.medkit, 0);
});

test('collect: ghosts cannot collect, spawn-invulnerable players can', () => {
  let state = newPlayingGame(33, ['sniper', 'berserker', 'summoner']);
  state.players[0].alive = false;
  state.players[0].x = 10;
  state.players[0].y = 2;
  parkOthers(state);
  placePickup(state, 'medkit', 'temporary', 10, 2);

  state = step(state, neutralInputs());
  assert.strictEqual(state.pickups.length, 1, 'a ghost standing on it collects nothing');

  // Still inside spawn invulnerability (newPlayingGame does not clear it).
  let invuln = newPlayingGame(34, ['sniper', 'berserker', 'summoner']);
  invuln.players[0].x = 10;
  invuln.players[0].y = 2;
  parkOthers(invuln);
  assert.ok(invuln.tick < invuln.players[0].invulnUntilTick, 'precondition: still invulnerable');
  placePickup(invuln, 'medkit', 'temporary', 10, 2);

  invuln = step(invuln, neutralInputs());
  assert.strictEqual(invuln.players[0].pickupsCollected.medkit, 1);
});

test('collect: a usable item stays on the map when the slot is already full', () => {
  let state = newPlayingGame(35, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);
  state.players[0].x = 10;
  state.players[0].y = 2;
  parkOthers(state);
  state.players[0].item = 'mine';
  placePickup(state, 'grenade', 'temporary', 10, 2);

  state = step(state, neutralInputs());
  assert.strictEqual(state.players[0].item, 'mine', 'the held item is not replaced');
  assert.strictEqual(state.pickups.length, 1, 'the grenade stays on the map');

  // An instant pickup is still collected with a full slot.
  placePickup(state, 'medkit', 'temporary', 10, 2);
  state.players[0].hp = 10;
  state = step(state, neutralInputs());
  assert.strictEqual(state.players[0].pickupsCollected.medkit, 1);
});

// --- Item slot / use ---

test('item: pressing Item is edge-triggered, does nothing when empty, and is blocked by Shield', () => {
  let state = newPlayingGame(36, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);
  parkOthers(state);

  // Empty slot: nothing happens.
  const useItem = makeInput({ item: true });
  state = step(state, [useItem, neutral, neutral]);
  assert.strictEqual(state.explosives.length, 0);

  // Held through several ticks = one use only.
  state.players[0].item = 'mine';
  state.players[0].itemHeldLastTick = false;
  for (let i = 0; i < 5; i++) state = step(state, [useItem, neutral, neutral]);
  assert.strictEqual(state.explosives.length, 1, 'holding the button places exactly one mine');
  assert.strictEqual(state.players[0].item, null);

  // Blocked while shielded.
  let shielded = newPlayingGame(37, ['sniper', 'berserker', 'summoner']);
  clearInvuln(shielded);
  parkOthers(shielded);
  shielded.players[0].item = 'mine';
  shielded = step(shielded, [makeInput({ shield: true }), neutral, neutral]);
  assert.ok(shielded.tick < shielded.players[0].shieldActiveUntilTick, 'precondition: shield is up');
  shielded = step(shielded, [useItem, neutral, neutral]);
  assert.strictEqual(shielded.explosives.length, 0, 'no item use while shielded');
  assert.strictEqual(shielded.players[0].item, 'mine', 'and the item is not consumed');
});

// --- Grenade ---

function throwGrenadeState(seed, setup) {
  let state = newPlayingGame(seed, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);
  parkOthers(state);
  setup(state);
  state.players[0].item = 'grenade';
  return step(state, [makeInput({ item: true, aimX: 1, aimY: 0 }), neutral, neutral]);
}

test('grenade: explodes exactly fuse ticks after the throw', () => {
  let state = throwGrenadeState(41, (s) => {
    s.players[0].x = 4;
    s.players[0].y = 2;
  });
  const thrownAt = state.tick;
  assert.strictEqual(state.explosives.length, 1);
  assert.strictEqual(state.explosives[0].explodeAtTick, thrownAt + TEMP.grenade.fuseTicks);

  let explodedAt = null;
  for (let i = 0; i < TEMP.grenade.fuseTicks + 10 && explodedAt === null; i++) {
    state = step(state, neutralInputs());
    if (state.explosions.length > 0) explodedAt = state.tick;
  }
  assert.strictEqual(explodedAt - thrownAt, TEMP.grenade.fuseTicks);
  assert.strictEqual(state.explosives.length, 0);
});

test('grenade: damages enemies in radius, never the thrower', () => {
  let state = throwGrenadeState(42, (s) => {
    s.players[0].x = 4;
    s.players[0].y = 2;
    s.players[1].x = 4 + TEMP.grenade.rangeTiles; // right where it lands
    s.players[1].y = 2;
  });
  for (let i = 0; i < TEMP.grenade.fuseTicks + 2; i++) state = step(state, neutralInputs());

  assert.strictEqual(state.players[1].damageTaken, TEMP.grenade.damage);
  assert.strictEqual(state.players[0].damageTaken, 0, 'the thrower is immune to their own grenade');
  assert.strictEqual(state.players[0].damageByExplosive.grenade, TEMP.grenade.damage, 'credited to the thrower');
});

test('grenade: Shield reduces it by 70% and spawn invulnerability ignores it entirely', () => {
  // Shielded victim.
  let shielded = newPlayingGame(43, ['sniper', 'berserker', 'summoner']);
  clearInvuln(shielded);
  parkOthers(shielded);
  shielded.players[0].x = 4;
  shielded.players[0].y = 2;
  shielded.players[1].x = 4 + TEMP.grenade.rangeTiles;
  shielded.players[1].y = 2;
  shielded.players[0].item = 'grenade';
  shielded = step(shielded, [makeInput({ item: true, aimX: 1, aimY: 0 }), makeInput({ shield: true }), neutral]);
  for (let i = 0; i < TEMP.grenade.fuseTicks + 2; i++) shielded = step(shielded, neutralInputs());

  const expected = TEMP.grenade.damage * (1 - ACTIONS.shield.damageReduction);
  assert.strictEqual(shielded.players[1].damageTaken, expected);

  // Invulnerable victim (spawn invuln NOT cleared for player 1).
  let invuln = newPlayingGame(44, ['sniper', 'berserker', 'summoner']);
  invuln.players[0].invulnUntilTick = invuln.tick; // thrower can act normally
  parkOthers(invuln);
  invuln.players[0].x = 4;
  invuln.players[0].y = 2;
  invuln.players[1].x = 4 + TEMP.grenade.rangeTiles;
  invuln.players[1].y = 2;
  invuln.players[0].item = 'grenade';
  invuln = step(invuln, [makeInput({ item: true, aimX: 1, aimY: 0 }), neutral, neutral]);
  for (let i = 0; i < TEMP.grenade.fuseTicks + 2; i++) {
    invuln.players[1].invulnUntilTick = invuln.tick + 100; // keep them invulnerable throughout
    invuln = step(invuln, neutralInputs());
  }
  assert.strictEqual(invuln.players[1].damageTaken, 0);
});

test('grenade: stops at cover instead of flying through it', () => {
  const block = COVER_BLOCKS[0]; // x:16-18, y:7.5-8.5
  let state = throwGrenadeState(45, (s) => {
    s.players[0].x = block.x - 2;
    s.players[0].y = block.y + block.h / 2;
  });

  const grenade = state.explosives[0];
  assert.ok(grenade.x < block.x, `landed at ${grenade.x}, should stop before the block at ${block.x}`);
  for (const b of COVER_BLOCKS) {
    assert.ok(!circleIntersectsRect(grenade.x, grenade.y, PICKUPS.pickupRadius, b), 'never rests inside cover');
  }
});

// --- Mine ---

test('mine: does not trigger before it arms, and never triggers for its owner', () => {
  let state = newPlayingGame(51, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);
  parkOthers(state);
  state.players[0].x = 10;
  state.players[0].y = 2;
  state.players[0].item = 'mine';
  state = step(state, [makeInput({ item: true }), neutral, neutral]);

  // Enemy stands on it immediately, before it arms.
  state.players[1].x = 10;
  state.players[1].y = 2;
  const armTick = state.explosives[0].armedAtTick;
  while (state.tick < armTick - 1) {
    state.players[1].x = 10;
    state.players[1].y = 2;
    state = step(state, neutralInputs());
    assert.strictEqual(state.explosions.length, 0, `triggered early at tick ${state.tick}`);
  }

  // The owner alone never sets it off.
  let ownerOnly = newPlayingGame(52, ['sniper', 'berserker', 'summoner']);
  clearInvuln(ownerOnly);
  parkOthers(ownerOnly);
  ownerOnly.players[0].x = 10;
  ownerOnly.players[0].y = 2;
  ownerOnly.players[0].item = 'mine';
  ownerOnly = step(ownerOnly, [makeInput({ item: true }), neutral, neutral]);
  for (let i = 0; i < TEMP.mine.armTicks + 60; i++) ownerOnly = step(ownerOnly, neutralInputs());
  assert.strictEqual(ownerOnly.explosives.length, 1, 'still armed and waiting');
  assert.strictEqual(ownerOnly.players[0].damageTaken, 0);
});

test('mine: an armed mine damages an enemy who walks in, credited to a dead owner', () => {
  let state = newPlayingGame(53, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);
  parkOthers(state);
  state.players[0].x = 10;
  state.players[0].y = 2;
  state.players[0].item = 'mine';
  state = step(state, [makeInput({ item: true }), neutral, neutral]);
  for (let i = 0; i < TEMP.mine.armTicks + 1; i++) state = step(state, neutralInputs());

  // Owner dies before the mine goes off.
  state.players[0].hp = 0;
  state.players[0].alive = false;

  state.players[1].x = 10;
  state.players[1].y = 2;
  state = step(state, neutralInputs());

  assert.strictEqual(state.players[1].damageTaken, TEMP.mine.damage);
  assert.strictEqual(state.players[0].damageByExplosive.mine, TEMP.mine.damage, 'credit survives the owner');
  assert.strictEqual(state.explosives.length, 0);
});

// --- Timed effects ---

test('overcharge: exact multiplier on Shoot, refreshes instead of stacking, expires', () => {
  let state = newPlayingGame(61, ['berserker', 'berserker', 'summoner']); // baseline shooter
  clearInvuln(state);
  state.players[0].x = 5;
  state.players[0].y = 2;
  state.players[1].x = 7;
  state.players[1].y = 2;
  state.players[2].x = 4;
  state.players[2].y = 14;

  applyPickup(state, state.players[0], { type: 'overcharge', family: 'temporary' });
  const until = state.players[0].effects.overchargeUntilTick;
  assert.strictEqual(until, state.tick + TEMP.overcharge.durationTicks);

  // Re-picking refreshes rather than stacking the duration.
  state = step(state, neutralInputs());
  applyPickup(state, state.players[0], { type: 'overcharge', family: 'temporary' });
  assert.strictEqual(
    state.players[0].effects.overchargeUntilTick,
    state.tick + TEMP.overcharge.durationTicks,
    'refreshed, not extended'
  );

  state = step(state, [makeInput({ fire: true, aimX: 1, aimY: 0 }), neutral, neutral]);
  for (let i = 0; i < 20; i++) state = step(state, neutralInputs());
  assert.strictEqual(state.players[1].damageTaken, ACTIONS.shoot.damage * TEMP.overcharge.mult);
});

test('adrenaline: exact speed multiplier while active, back to normal after it expires', () => {
  const runFor = (ticks, withAdrenaline) => {
    let state = newPlayingGame(62, ['sniper', 'berserker', 'summoner']);
    clearInvuln(state);
    parkOthers(state);
    state.players[0].x = 2;
    state.players[0].y = 2;
    if (withAdrenaline) applyPickup(state, state.players[0], { type: 'adrenaline', family: 'temporary' });
    const start = state.players[0].x;
    const right = makeInput({ moveX: 1 });
    for (let i = 0; i < ticks; i++) state = step(state, [right, neutral, neutral]);
    return state.players[0].x - start;
  };

  const plain = runFor(60, false);
  const boosted = runFor(60, true);
  assert.ok(Math.abs(boosted / plain - TEMP.adrenaline.mult) < 1e-9, `ratio was ${boosted / plain}`);
});

test('cloak: ends the moment you Shoot or Slash, and hides you from aim assist', () => {
  let state = newPlayingGame(63, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);
  parkOthers(state);
  state.players[0].x = 2;
  state.players[0].y = 2;

  applyPickup(state, state.players[0], { type: 'cloak', family: 'temporary' });
  assert.ok(state.players[0].effects.cloakUntilTick > state.tick);

  // Moving keeps it.
  state = step(state, [makeInput({ moveX: 1 }), neutral, neutral]);
  assert.ok(state.players[0].effects.cloakUntilTick > state.tick, 'moving does not break cloak');

  // Shooting drops it immediately.
  state = step(state, [makeInput({ fire: true, aimX: 1, aimY: 0 }), neutral, neutral]);
  assert.strictEqual(state.players[0].effects.cloakUntilTick, 0, 'shooting breaks cloak');

  // And slashing does too.
  let slashState = newPlayingGame(64, ['sniper', 'berserker', 'summoner']);
  clearInvuln(slashState);
  parkOthers(slashState);
  applyPickup(slashState, slashState.players[0], { type: 'cloak', family: 'temporary' });
  slashState = step(slashState, [makeInput({ slash: true, aimX: 1, aimY: 0 }), neutral, neutral]);
  assert.strictEqual(slashState.players[0].effects.cloakUntilTick, 0, 'slashing breaks cloak');
});

test('medkit and shield battery: heal is capped at max HP, battery clears the cooldown', () => {
  let state = newPlayingGame(65, ['berserker', 'sniper', 'summoner']);
  clearInvuln(state);
  parkOthers(state);

  // Heal caps.
  state.players[0].hp = state.players[0].maxHp - 5;
  applyPickup(state, state.players[0], { type: 'medkit', family: 'temporary' });
  assert.strictEqual(state.players[0].hp, state.players[0].maxHp, 'never overheals');

  // Heal amount when there is room.
  state.players[0].hp = state.players[0].maxHp - 100;
  applyPickup(state, state.players[0], { type: 'medkit', family: 'temporary' });
  assert.strictEqual(state.players[0].hp, state.players[0].maxHp - 100 + TEMP.medkit.heal);

  // Battery clears a running cooldown...
  state = step(state, [makeInput({ shield: true }), neutral, neutral]);
  for (let i = 0; i < ACTIONS.shield.durationTicks + 5; i++) state = step(state, neutralInputs());
  assert.ok(state.tick < state.players[0].shieldReadyAtTick, 'precondition: on cooldown');
  applyPickup(state, state.players[0], { type: 'shieldBattery', family: 'temporary' });
  assert.ok(state.tick >= state.players[0].shieldReadyAtTick, 'shield is ready again');

  // ...but does nothing to a shield that is currently up.
  state = step(state, [makeInput({ shield: true }), neutral, neutral]);
  const readyAt = state.players[0].shieldReadyAtTick;
  applyPickup(state, state.players[0], { type: 'shieldBattery', family: 'temporary' });
  assert.strictEqual(state.players[0].shieldReadyAtTick, readyAt, 'no effect while the shield is active');
});

// --- Amulets ---

test('amulets: N of a type apply exactly (1 + N x perStack), composed with boosts', () => {
  const state = createInitialState(71, ['berserker', 'berserker', 'summoner'], [
    { hp: 5, speed: 5, shootDmg: 0, slashDmg: 0 },
    undefined,
    undefined,
  ]);
  const player = state.players[0];
  const def = CHARACTERS.berserker;

  for (let n = 1; n <= 4; n++) {
    player.amulets.amuletSpeed = n;
    player.amulets.amuletVitality = n;
    player.amulets.amuletMarksman = n;
    player.amulets.amuletBlade = n;
    recomputeDerivedStats(player);

    assert.strictEqual(
      player.speedTilesPerSec,
      def.speedTilesPerSec * (1 + BOOST_BONUS_PER_POINT.speed * 5) * (1 + PER.speed * n),
      `speed with ${n} amulets`
    );
    assert.strictEqual(
      player.maxHp,
      def.hp * (1 + BOOST_BONUS_PER_POINT.hp * 5) * (1 + PER.hp * n),
      `maxHp with ${n} amulets`
    );
    assert.strictEqual(player.shootDamage, ACTIONS.shoot.damage * (1 + PER.shoot * n));
    assert.strictEqual(player.slashDamage, ACTIONS.slash.damage * (1 + PER.slash * n));
  }
});

test('amulets: Ward shortens the Shield cooldown down to the floor and no further', () => {
  const state = createInitialState(72, ['sniper', 'berserker', 'summoner']);
  const player = state.players[0];

  player.amulets.amuletWard = 1;
  recomputeDerivedStats(player);
  assert.strictEqual(player.shieldCooldownTicks, ACTIONS.shield.cooldownTicks - PER.shieldCdTicks);

  // Far more Wards than the cooldown can absorb: the STAT floors, the count doesn't.
  player.amulets.amuletWard = 50;
  recomputeDerivedStats(player);
  assert.strictEqual(player.shieldCooldownTicks, PICKUPS.amulets.shieldCooldownFloorTicks);
  assert.strictEqual(player.amulets.amuletWard, 50, 'no cap on how many are held');
});

test('amulets: Fury scales ult charge, Hunter widens pickup reach', () => {
  const state = createInitialState(73, ['sniper', 'berserker', 'summoner']);
  const player = state.players[0];

  player.amulets.amuletFury = 3;
  player.amulets.amuletHunter = 2;
  recomputeDerivedStats(player);

  assert.strictEqual(player.ultGainMultiplier, 1 + PER.ultGain * 3);
  assert.strictEqual(player.pickupRadiusTiles, PICKUPS.pickupRadius + PER.pickupRadius * 2);
});

test('amulets: Vitality mid-round raises current HP by the same delta, not to full', () => {
  let state = newPlayingGame(74, ['berserker', 'sniper', 'summoner']);
  clearInvuln(state);
  parkOthers(state);

  const player = state.players[0];
  player.hp = 50;
  const prevMax = player.maxHp;

  applyPickup(state, player, { type: 'amuletVitality', family: 'amulet' });

  const delta = player.maxHp - prevMax;
  assert.ok(delta > 0, 'max HP went up');
  assert.strictEqual(player.hp, 50 + delta, 'current HP rises by the same delta');
  assert.ok(player.hp < player.maxHp, 'it is a buff, not a full heal');
});

test('amulets: picked up mid-round they apply immediately', () => {
  let state = newPlayingGame(75, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);
  parkOthers(state);
  state.players[0].x = 10;
  state.players[0].y = 2;
  const before = state.players[0].speedTilesPerSec;

  placePickup(state, 'amuletSpeed', 'amulet', 10, 2);
  state = step(state, neutralInputs());

  assert.strictEqual(state.players[0].amulets.amuletSpeed, 1);
  assert.ok(Math.abs(state.players[0].speedTilesPerSec - before * (1 + PER.speed)) < 1e-12);
});

// --- Persistence ---

test('persistence: amulets survive rounds and death; everything temporary does not', () => {
  let state = newPlayingGame(81, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);
  parkOthers(state);

  const player = state.players[0];
  applyPickup(state, player, { type: 'amuletBlade', family: 'amulet' });
  applyPickup(state, player, { type: 'amuletBlade', family: 'amulet' });
  applyPickup(state, player, { type: 'overcharge', family: 'temporary' });
  player.item = 'grenade';
  placePickup(state, 'medkit', 'temporary', 12, 2);
  state.players[0].x = 10;
  state.players[0].y = 2;
  state.players[0].item = 'grenade';
  state = step(state, [makeInput({ item: true }), neutral, neutral]); // leave a live mine/grenade behind

  const slashDamageWithAmulets = state.players[0].slashDamage;

  // End the round by eliminating the other two.
  state.players[1].hp = 0;
  state.players[1].alive = false;
  state.players[2].hp = 0;
  state.players[2].alive = false;
  state = step(state, neutralInputs());
  assert.strictEqual(state.roundState, 'recap');

  // Roll into the next round.
  let guard = 0;
  while (state.roundState !== 'playing' && guard < 2000) {
    state = step(state, neutralInputs());
    guard += 1;
  }

  const next = state.players[0];
  assert.strictEqual(next.amulets.amuletBlade, 2, 'amulets carry into the next round');
  assert.strictEqual(next.slashDamage, slashDamageWithAmulets, 'and their effect carries too');
  assert.strictEqual(next.item, null, 'the item slot is emptied');
  assert.strictEqual(next.effects.overchargeUntilTick, 0, 'timed effects are dropped');
  assert.strictEqual(state.pickups.length, 0, 'map items are wiped');
  assert.strictEqual(state.explosives.length, 0, 'live explosives are wiped');
  assert.deepStrictEqual(next.itemsUsed, { grenade: 0, mine: 0 }, 'per-round tallies reset');

  // An eliminated player keeps theirs too.
  const eliminated = state.players[1];
  eliminated.amulets.amuletFury = 1;
  recomputeDerivedStats(eliminated);
  assert.strictEqual(eliminated.amulets.amuletFury, 1);
});

test('persistence: a brand-new match starts with no amulets', () => {
  const fresh = createInitialState(82, ['sniper', 'berserker', 'summoner']);
  for (const player of fresh.players) {
    for (const count of Object.values(player.amulets)) assert.strictEqual(count, 0);
    assert.strictEqual(player.item, null);
    assert.strictEqual(player.pickupRadiusTiles, PICKUPS.pickupRadius);
  }
  assert.strictEqual(fresh.pickups.length, 0);
  assert.strictEqual(fresh.explosives.length, 0);
});

// --- Log ---

test('log: the round log records pickups, items used and amulets held', () => {
  let state = newPlayingGame(91, ['sniper', 'berserker', 'summoner']);
  clearInvuln(state);
  parkOthers(state);

  applyPickup(state, state.players[0], { type: 'amuletSpeed', family: 'amulet' });
  applyPickup(state, state.players[0], { type: 'medkit', family: 'temporary' });
  placePickup(state, 'grenade', 'temporary', 20, 2);

  state.players[1].hp = 0;
  state.players[1].alive = false;
  state.players[2].hp = 0;
  state.players[2].alive = false;
  state = step(state, neutralInputs());

  const log = state.logs[state.logs.length - 1];
  const p0 = log.players[0];
  assert.strictEqual(p0.amulets.amuletSpeed, 1);
  assert.strictEqual(p0.pickupsCollected.medkit, 1);
  assert.strictEqual(p0.pickupsCollected.amuletSpeed, 1);
  assert.ok(Array.isArray(log.pickupEvents));
  assert.ok(
    log.pickupEvents.some((e) => e.type === 'grenade' && e.outcome === 'uncollected'),
    'an item still on the map at round end is logged as uncollected'
  );
});
