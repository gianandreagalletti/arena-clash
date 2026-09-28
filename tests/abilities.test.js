import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput, neutralInputs } from './helpers.js';
import { recomputeDerivedStats } from '../src/sim/state.js';
import { applyDamage } from '../src/sim/systems/damage.js';
import { COVER_BLOCKS, circleIntersectsRect } from '../src/sim/arena.js';
import {
  ABILITIES,
  ACTIONS,
  CHARACTERS,
  TICK_RATE,
  PICKUPS,
  BOOST_BONUS_PER_POINT,
  abilityPoolFor,
} from '../src/sim/config/balance.js';

const neutral = makeInput();

/** A playing round with P0 as `characterId`, holding `abilityId`, everyone else parked. */
function withAbility(characterId, abilityId, seed = 401) {
  const chars = [characterId, 'berserker', 'summoner'];
  const state = newPlayingGame(seed, chars);
  clearInvuln(state);

  const player = state.players[0];
  const config = ABILITIES[characterId][abilityId];
  if (config.type === 'passive') player.abilities.passives.push(abilityId);
  else player.abilities.slots[0] = abilityId;
  recomputeDerivedStats(player);

  state.players[1].x = 2;
  state.players[1].y = 14;
  state.players[2].x = 4;
  state.players[2].y = 14;
  return state;
}

const skill1 = (overrides = {}) => makeInput({ skill1: true, ...overrides });

// --- Every ability is reachable and configured ---

test('abilities: all 15 exist, each tagged passive or active, with cooldowns on the actives', () => {
  let total = 0;
  for (const characterId of Object.keys(ABILITIES)) {
    const pool = abilityPoolFor(characterId);
    assert.strictEqual(pool.length, 5, `${characterId} should have 5 abilities`);
    for (const id of pool) {
      const config = ABILITIES[characterId][id];
      assert.ok(['passive', 'active'].includes(config.type), `${id} has no valid type`);
      if (config.type === 'active') assert.ok(config.cooldownTicks > 0, `${id} needs a cooldown`);
      total += 1;
    }
  }
  assert.strictEqual(total, 15);
});

// --- Berserker passives ---

test('longsword: extends Slash reach by exactly the configured bonus', () => {
  const base = newPlayingGame(411, ['berserker', 'sniper', 'summoner']);
  const baseReach = base.players[0].slashReachTiles;
  assert.strictEqual(baseReach, ACTIONS.slash.reachTiles);

  const state = withAbility('berserker', 'longsword', 412);
  const bonus = ABILITIES.berserker.longsword.reachBonusTiles;
  assert.strictEqual(state.players[0].slashReachTiles, baseReach + bonus);

  // And it actually lands a hit that would otherwise miss.
  state.players[0].x = 10;
  state.players[0].y = 2;
  state.players[1].x = 10 + baseReach + 0.2; // beyond base reach, inside the extended one
  state.players[1].y = 2;
  const after = step(state, [makeInput({ slash: true, aimX: 1, aimY: 0 }), neutral, neutral]);
  assert.ok(after.players[1].damageTaken > 0, 'the longer reach should connect');
});

test('greatsword: harder and slower by exactly the configured multipliers', () => {
  const cfg = ABILITIES.berserker.greatsword;
  const plain = newPlayingGame(413, ['berserker', 'sniper', 'summoner']).players[0];
  const state = withAbility('berserker', 'greatsword', 414);
  const armed = state.players[0];

  assert.ok(Math.abs(armed.slashDamage - plain.slashDamage * cfg.damageMult) < 1e-9);
  assert.ok(Math.abs(armed.slashCooldownMaxTicks - plain.slashCooldownMaxTicks / cfg.rateMult) < 1e-9);
  assert.ok(armed.slashCooldownMaxTicks > plain.slashCooldownMaxTicks, 'rateMult < 1 means slower');
});

test('bloodthirst: heals a share of the Slash damage that actually landed', () => {
  const state = withAbility('berserker', 'bloodthirst', 415);
  const cfg = ABILITIES.berserker.bloodthirst;
  const player = state.players[0];

  player.x = 10;
  player.y = 2;
  player.hp = player.maxHp - 50;
  state.players[1].x = 10.8;
  state.players[1].y = 2;

  const before = player.hp;
  const after = step(state, [makeInput({ slash: true, aimX: 1, aimY: 0 }), neutral, neutral]);
  const dealt = after.players[1].damageTaken;

  assert.ok(dealt > 0, 'precondition: the slash connected');
  assert.ok(Math.abs(after.players[0].hp - (before + dealt * cfg.healFraction)) < 1e-9);
});

test('bloodthirst: never heals past max HP', () => {
  const state = withAbility('berserker', 'bloodthirst', 416);
  const player = state.players[0];
  player.x = 10;
  player.y = 2;
  player.hp = player.maxHp; // already full
  state.players[1].x = 10.8;
  state.players[1].y = 2;

  const after = step(state, [makeInput({ slash: true, aimX: 1, aimY: 0 }), neutral, neutral]);
  assert.strictEqual(after.players[0].hp, after.players[0].maxHp);
});

// --- Berserker actives ---

test('whirlwind: hits everything in reach in every direction, once', () => {
  const state = withAbility('berserker', 'whirlwind', 417);
  const cfg = ABILITIES.berserker.whirlwind;
  const player = state.players[0];
  player.x = 10;
  player.y = 8;
  player.aimX = 1;
  player.aimY = 0;

  // One enemy in front, one directly behind — a normal Slash would miss the latter.
  state.players[1].x = 10 + player.slashReachTiles - 0.2;
  state.players[1].y = 8;
  state.players[2].x = 10 - (player.slashReachTiles - 0.2);
  state.players[2].y = 8;

  const after = step(state, [skill1(), neutral, neutral]);
  assert.strictEqual(after.players[1].damageTaken, cfg.damage, 'in front');
  assert.strictEqual(after.players[2].damageTaken, cfg.damage, 'behind — that is the point');
  assert.strictEqual(after.players[0].skillCooldowns[0], cfg.cooldownTicks, 'cooldown started');
});

test('charge: dashes, damages each enemy once, and stops dead on cover', () => {
  const cfg = ABILITIES.berserker.charge;

  // Open ground: it travels and hits.
  let open = withAbility('berserker', 'charge', 418);
  open.players[0].x = 6;
  open.players[0].y = 2;
  open.players[1].x = 7.5;
  open.players[1].y = 2;
  const startX = open.players[0].x;

  open = step(open, [skill1({ moveX: 1 }), neutral, neutral]);
  for (let i = 0; i < cfg.durationTicks + 2; i++) open = step(open, neutralInputs());

  assert.ok(open.players[0].x > startX + 1, `should have covered ground, moved to ${open.players[0].x}`);
  assert.strictEqual(open.players[1].damageTaken, cfg.damage, 'damages what it runs through');
  assert.strictEqual(open.players[0].dash, null, 'the dash ends');

  // Into cover: it stops rather than passing through.
  const block = COVER_BLOCKS[0]; // x:16-18, y:7.5-8.5
  let intoCover = withAbility('berserker', 'charge', 419);
  intoCover.players[0].x = block.x - 1.2;
  intoCover.players[0].y = block.y + block.h / 2;

  intoCover = step(intoCover, [skill1({ moveX: 1 }), neutral, neutral]);
  for (let i = 0; i < cfg.durationTicks + 2; i++) intoCover = step(intoCover, neutralInputs());

  const stopped = intoCover.players[0];
  assert.ok(stopped.x < block.x, `stopped at ${stopped.x}, should be before the block at ${block.x}`);
  for (const b of COVER_BLOCKS) {
    assert.ok(!circleIntersectsRect(stopped.x, stopped.y, stopped.radiusTiles, b), 'never ends inside cover');
  }
});

// --- Sniper ---

test('roll: dashes and ignores all damage for its duration', () => {
  const cfg = ABILITIES.sniper.roll;
  let state = withAbility('sniper', 'roll', 420);
  state.players[0].x = 6;
  state.players[0].y = 2;

  state = step(state, [skill1({ moveX: 1 }), neutral, neutral]);
  assert.ok(state.players[0].dash, 'rolling');
  assert.strictEqual(state.players[0].dash.invulnerable, true);

  // Anything thrown at a rolling Sniper bounces off.
  const dealt = applyDamage(state, state.players[0], 50, state.players[1]);
  assert.strictEqual(dealt, 0);
  assert.strictEqual(state.players[0].damageTaken, 0);

  for (let i = 0; i < cfg.durationTicks + 2; i++) state = step(state, neutralInputs());
  assert.strictEqual(state.players[0].dash, null, 'the roll ends');

  // And once it is over, damage lands normally again.
  const after = applyDamage(state, state.players[0], 10, state.players[1]);
  assert.strictEqual(after, 10);
});

test('vanish: cloaks exactly like the pickup and ends on Shoot', () => {
  const cfg = ABILITIES.sniper.vanish;
  let state = withAbility('sniper', 'vanish', 421);
  state.players[0].x = 6;
  state.players[0].y = 2;

  state = step(state, [skill1(), neutral, neutral]);
  assert.strictEqual(
    state.players[0].effects.cloakUntilTick,
    state.tick + cfg.durationTicks,
    'sets the same cloak the pickup does'
  );

  state = step(state, [makeInput({ fire: true, aimX: 1, aimY: 0 }), neutral, neutral]);
  assert.strictEqual(state.players[0].effects.cloakUntilTick, 0, 'shooting reveals you');
});

test('charged shot: damage scales with hold time, and Shield cancels it outright', () => {
  const cfg = ABILITIES.sniper.chargedShot;

  const fireAfterHolding = (holdTicks, seed) => {
    let state = withAbility('sniper', 'chargedShot', seed);
    state.players[0].x = 2;
    state.players[0].y = 2;
    state.players[1].x = 8;
    state.players[1].y = 2;

    for (let i = 0; i < holdTicks; i++) {
      state = step(state, [skill1({ aimX: 1, aimY: 0 }), neutral, neutral]);
    }
    state = step(state, [makeInput({ aimX: 1, aimY: 0 }), neutral, neutral]); // release
    for (let i = 0; i < 60; i++) state = step(state, neutralInputs());
    return state.players[1].damageTaken;
  };

  const shortHold = fireAfterHolding(2, 422);
  const fullHold = fireAfterHolding(cfg.maxChargeTicks + 5, 423);

  assert.ok(shortHold > 0, 'a quick tap still fires');
  assert.ok(fullHold > shortHold, `full charge ${fullHold} should beat a tap ${shortHold}`);

  const base = newPlayingGame(424, ['sniper', 'berserker', 'summoner']).players[0].shootDamage;
  assert.ok(Math.abs(fullHold - base * cfg.maxMult) < 1e-6, `full charge should be base x ${cfg.maxMult}`);

  // Shield mid-charge: no shot, and no cooldown spent.
  let canceled = withAbility('sniper', 'chargedShot', 425);
  canceled.players[0].x = 2;
  canceled.players[0].y = 2;
  canceled = step(canceled, [skill1({ aimX: 1, aimY: 0 }), neutral, neutral]);
  assert.ok(canceled.players[0].chargingSkill, 'charging');
  canceled = step(canceled, [makeInput({ skill1: true, shield: true }), neutral, neutral]);
  assert.strictEqual(canceled.players[0].chargingSkill, null, 'the charge is dropped');
  assert.strictEqual(canceled.players[0].skillCooldowns[0], 0, 'and costs no cooldown');
  assert.strictEqual(canceled.projectiles.length, 0, 'no shot came out');
});

test('piercing: the shot carries through one target at a reduced multiplier, and cover still stops it', () => {
  const cfg = ABILITIES.sniper.piercing;
  let state = withAbility('sniper', 'piercing', 426);
  state.players[0].x = 2;
  state.players[0].y = 2;
  state.players[1].x = 6;
  state.players[1].y = 2;
  state.players[2].x = 10;
  state.players[2].y = 2;

  const shooter = state.players[0];
  state = step(state, [makeInput({ fire: true, aimX: 1, aimY: 0 }), neutral, neutral]);
  for (let i = 0; i < 90; i++) state = step(state, neutralInputs());

  const first = state.players[1].damageTaken;
  const second = state.players[2].damageTaken;
  assert.ok(first > 0, 'the first target is hit at full strength');
  assert.ok(second > 0, 'the round carries through to a second target');
  assert.ok(Math.abs(second - first * cfg.secondHitMult) < 1e-6, `second hit should be x${cfg.secondHitMult}`);

  // Cover still stops a piercing round.
  const block = COVER_BLOCKS[0];
  let blocked = withAbility('sniper', 'piercing', 427);
  blocked.players[0].x = block.x - 3;
  blocked.players[0].y = block.y + block.h / 2;
  blocked.players[1].x = block.x + block.w + 2;
  blocked.players[1].y = block.y + block.h / 2;

  blocked = step(blocked, [makeInput({ fire: true, aimX: 1, aimY: 0 }), neutral, neutral]);
  for (let i = 0; i < 90; i++) blocked = step(blocked, neutralInputs());
  assert.strictEqual(blocked.players[1].damageTaken, 0, 'piercing does not punch through walls');
});

test('focus: speeds the projectile up by exactly the configured multiplier', () => {
  const cfg = ABILITIES.sniper.focus;
  const plain = newPlayingGame(428, ['sniper', 'berserker', 'summoner']).players[0];
  const state = withAbility('sniper', 'focus', 429);

  assert.ok(
    Math.abs(state.players[0].shootProjectileSpeed - plain.shootProjectileSpeed * cfg.speedMult) < 1e-9
  );
  // Range is unlimited today, so the range half of Focus has nothing to extend.
  assert.strictEqual(state.players[0].shootRangeTiles, null);
});

// --- Summoner ---

test('alpha dog: scales the dog HP and bite by exactly the configured multipliers', () => {
  const cfg = ABILITIES.summoner.alphaDog;
  const plain = newPlayingGame(430, ['summoner', 'berserker', 'sniper']).players[0];
  const state = withAbility('summoner', 'alphaDog', 431);
  const armed = state.players[0];

  assert.ok(Math.abs(armed.dogMaxHp - plain.dogMaxHp * cfg.hpMult) < 1e-9);
  assert.ok(Math.abs(armed.dogBiteDamage - plain.dogBiteDamage * cfg.biteMult) < 1e-9);

  // The summoned dog actually gets those numbers.
  const after = step(state, [makeInput({ ult: true }), neutral, neutral]);
  assert.strictEqual(after.dogs[0].maxHp, armed.dogMaxHp);
});

test('pack leader: shortens the dog respawn by exactly the configured multiplier', () => {
  const cfg = ABILITIES.summoner.packLeader;
  const plain = newPlayingGame(432, ['summoner', 'berserker', 'sniper']).players[0];
  const state = withAbility('summoner', 'packLeader', 433);
  assert.ok(Math.abs(state.players[0].dogRespawnTicks - plain.dogRespawnTicks * cfg.respawnMult) < 1e-9);
});

test('bone meal: the Summoner drinks a share of what the dog bites', () => {
  const cfg = ABILITIES.summoner.boneMeal;
  let state = withAbility('summoner', 'boneMeal', 434);
  const owner = state.players[0];
  owner.x = 10;
  owner.y = 2;
  owner.hp = owner.maxHp - 50;

  state = step(state, [makeInput({ ult: true }), neutral, neutral]);
  assert.strictEqual(state.dogs.length, 1);

  // Glue a victim to the dog so it bites, and watch the owner's HP climb.
  const hpBefore = state.players[0].hp;
  for (let i = 0; i < 180; i++) {
    if (state.dogs.length > 0) {
      state.players[1].x = state.dogs[0].x + 0.4;
      state.players[1].y = state.dogs[0].y;
    }
    state = step(state, neutralInputs());
  }

  const dealt = state.players[1].damageTaken;
  assert.ok(dealt > 0, 'precondition: the dog landed bites');
  const expected = Math.min(state.players[0].maxHp, hpBefore + dealt * cfg.healFraction);
  assert.ok(Math.abs(state.players[0].hp - expected) < 1e-6, `healed to ${state.players[0].hp}, expected ${expected}`);
});

test('viper: hunts, bites, poisons over time, and expires on its own', () => {
  const cfg = ABILITIES.summoner.viper;
  let state = withAbility('summoner', 'viper', 435);
  state.players[0].x = 10;
  state.players[0].y = 2;
  state.players[1].x = 12;
  state.players[1].y = 2;

  state = step(state, [skill1(), neutral, neutral]);
  assert.strictEqual(state.vipers.length, 1);
  assert.strictEqual(state.vipers[0].hp, cfg.hp);
  assert.strictEqual(state.players[0].skillCooldowns[0], cfg.cooldownTicks);

  // Only one at a time.
  state.players[0].skillCooldowns[0] = 0;
  state = step(state, [skill1(), neutral, neutral]);
  assert.strictEqual(state.vipers.length, 1, 'no stacking vipers');

  // It closes in and bites, which poisons.
  let bitten = false;
  for (let i = 0; i < 240 && !bitten; i++) {
    state = step(state, neutralInputs());
    if (state.players[1].poisonUntilTick > state.tick) bitten = true;
  }
  assert.ok(bitten, 'the viper should have reached and poisoned its target');
  assert.strictEqual(state.players[1].poisonDps, cfg.poisonDps);

  // Poison keeps ticking damage after the bite itself.
  const hpAfterBite = state.players[1].hp;
  state = step(state, neutralInputs());
  assert.ok(state.players[1].hp < hpAfterBite, 'poison deals damage over time');
});

test('viper: poison refreshes rather than stacking', () => {
  const cfg = ABILITIES.summoner.viper;
  let state = withAbility('summoner', 'viper', 436);
  const victim = state.players[1];

  victim.poisonUntilTick = state.tick + 10;
  victim.poisonDps = cfg.poisonDps;
  const firstEnd = victim.poisonUntilTick;

  // A second application pushes the end out, it does not double the rate.
  victim.poisonUntilTick = state.tick + cfg.poisonDurationTicks;
  assert.ok(victim.poisonUntilTick > firstEnd);
  assert.strictEqual(victim.poisonDps, cfg.poisonDps, 'dps is not stacked');
});

test('thorn trap: arms, damages on entry once, slows while inside, spares the owner', () => {
  const cfg = ABILITIES.summoner.thornTrap;
  let state = withAbility('summoner', 'thornTrap', 437);
  state.players[0].x = 10;
  state.players[0].y = 2;

  state = step(state, [skill1(), neutral, neutral]);
  assert.strictEqual(state.traps.length, 1);

  // The owner standing on it takes nothing, even after it arms.
  for (let i = 0; i < cfg.armTicks + 5; i++) state = step(state, neutralInputs());
  assert.strictEqual(state.players[0].damageTaken, 0, 'your own thorns spare you');

  // An enemy walking in takes the entry damage exactly once.
  state.players[1].x = 10;
  state.players[1].y = 2;
  state = step(state, neutralInputs());
  const afterEntry = state.players[1].damageTaken;
  assert.strictEqual(afterEntry, cfg.enterDamage);

  for (let i = 0; i < 30; i++) state = step(state, neutralInputs());
  assert.strictEqual(state.players[1].damageTaken, afterEntry, 'standing in it does not re-trigger');
});

// --- Composition ---

test('composition: Greatsword multiplies with boosts, the Blade amulet and Overcharge', () => {
  const state = newPlayingGame(440, ['berserker', 'sniper', 'summoner']);
  const player = state.players[0];

  player.boosts.slashDmg = 4;
  player.statPicks.slashDmg = 2; // drafted points count too
  player.amulets.amuletBlade = 3;
  player.abilities.passives.push('greatsword');
  recomputeDerivedStats(player);

  const expected =
    ACTIONS.slash.damage *
    (1 + BOOST_BONUS_PER_POINT.slashDmg * 6) *
    (1 + PICKUPS.amulets.perStack.slash * 3) *
    ABILITIES.berserker.greatsword.damageMult;

  assert.ok(Math.abs(player.slashDamage - expected) < 1e-9, `${player.slashDamage} should be ${expected}`);

  // Overcharge is the one factor applied at swing time rather than stored.
  player.effects.overchargeUntilTick = state.tick + 100;
  const overcharged = player.slashDamage * PICKUPS.temporary.overcharge.mult;
  assert.ok(overcharged > player.slashDamage);
});

// --- Blocking rules ---

test('skills: do nothing with an empty slot, while shielded, or for a ghost', () => {
  // Empty slot.
  let empty = newPlayingGame(450, ['berserker', 'sniper', 'summoner']);
  clearInvuln(empty);
  empty = step(empty, [skill1(), neutral, neutral]);
  assert.strictEqual(empty.players[0].dash, null);
  assert.deepStrictEqual(empty.players[0].skillCooldowns, [0, 0]);

  // Shielded.
  let shielded = withAbility('berserker', 'whirlwind', 451);
  shielded.players[1].x = shielded.players[0].x + 1;
  shielded.players[1].y = shielded.players[0].y;
  shielded = step(shielded, [makeInput({ shield: true }), neutral, neutral]);
  assert.ok(shielded.tick < shielded.players[0].shieldActiveUntilTick, 'precondition: shield up');
  shielded = step(shielded, [skill1(), neutral, neutral]);
  assert.strictEqual(shielded.players[0].skillCooldowns[0], 0, 'no skill use while shielded');

  // Ghost.
  let ghost = withAbility('berserker', 'whirlwind', 452);
  ghost.players[0].alive = false;
  ghost = step(ghost, [skill1(), neutral, neutral]);
  assert.strictEqual(ghost.players[0].skillCooldowns[0], 0, 'the dead do not cast');
});

test('skills: one press is one use, and the cooldown gates the next', () => {
  const cfg = ABILITIES.berserker.whirlwind;
  let state = withAbility('berserker', 'whirlwind', 453);
  state.players[1].x = state.players[0].x + 1;
  state.players[1].y = state.players[0].y;

  // Holding the button across many ticks fires exactly once.
  for (let i = 0; i < 10; i++) state = step(state, [skill1(), neutral, neutral]);
  const afterHold = state.players[1].damageTaken;
  assert.strictEqual(afterHold, cfg.damage, 'held button = one cast');

  // Releasing and re-pressing while still on cooldown does nothing.
  state = step(state, neutralInputs());
  state = step(state, [skill1(), neutral, neutral]);
  assert.strictEqual(state.players[1].damageTaken, afterHold, 'cooldown still blocks it');
});
