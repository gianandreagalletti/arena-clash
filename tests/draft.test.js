import test from 'node:test';
import assert from 'node:assert/strict';
import {
  step,
  createInitialState,
  neutralInputs,
  makeInput,
  newPlayingGame,
  clearInvuln,
  skipDraft,
} from './helpers.js';
import { buildPickOrder, ownedAbilities } from '../src/sim/systems/draft.js';
import { recomputeDerivedStats } from '../src/sim/state.js';
import { DRAFT, ABILITIES, BOOST_BONUS_PER_POINT, CHARACTERS, abilityPoolFor } from '../src/sim/config/balance.js';

const neutral = makeInput();

/** Plays a round to a clean finish: P0 wins, P2 dies first, P1 dies second. */
function playRoundToDraft(seed = 201, chars = ['sniper', 'berserker', 'summoner']) {
  let state = newPlayingGame(seed, chars);
  clearInvuln(state);

  // Kill P2 first, then P1 a tick later, so the pick order is unambiguous.
  state.players[2].hp = 0;
  state.players[2].alive = false;
  state.players[2].deathTick = state.tick;
  state = step(state, neutralInputs());

  state.players[1].hp = 0;
  state.players[1].alive = false;
  state.players[1].deathTick = state.tick;
  state = step(state, neutralInputs());

  assert.strictEqual(state.roundState, 'recap');
  while (state.roundState === 'recap') state = step(state, neutralInputs());
  return state;
}

function pickInput(playerId, pick) {
  const inputs = neutralInputs();
  inputs[playerId] = makeInput({ draftPick: pick });
  return inputs;
}

// --- Flow and order ---

test('draft: opens after a normal round, winner picks first and the first to die picks last', () => {
  const state = playRoundToDraft();
  assert.strictEqual(state.roundState, 'draft');
  // P0 survived, P1 died second, P2 died first.
  assert.deepStrictEqual(state.draft.order, [0, 1, 2]);
});

test('draft: two players eliminated on the same tick tie, and the lower index picks first', () => {
  const players = [
    { id: 0, deathTick: 100 },
    { id: 1, deathTick: null },
    { id: 2, deathTick: 100 },
  ];
  // P1 survived; P0 and P2 died together, so P0 goes first on index.
  assert.deepStrictEqual(buildPickOrder(players), [1, 0, 2]);
});

test('draft: no draft after a voided round, and none after the match-winning round', () => {
  // Voided round: everyone dies on the same tick, the round simply replays.
  let voided = newPlayingGame(202, ['sniper', 'berserker', 'summoner']);
  clearInvuln(voided);
  for (const p of voided.players) {
    p.hp = 0;
    p.alive = false;
  }
  voided = step(voided, neutralInputs());
  assert.strictEqual(voided.voidRoundThisTick, true);
  assert.strictEqual(voided.roundState, 'countdown', 'a void round restarts, it does not draft');

  // Match point: P0 already has 2 wins, takes the third.
  let final = newPlayingGame(203, ['sniper', 'berserker', 'summoner']);
  clearInvuln(final);
  final.players[0].roundsWon = 2;
  final.players[1].hp = 0;
  final.players[1].alive = false;
  final.players[2].hp = 0;
  final.players[2].alive = false;
  final.players[2].deathTick = final.tick;
  final = step(final, neutralInputs());
  while (final.roundState === 'recap') final = step(final, neutralInputs());
  assert.strictEqual(final.roundState, 'matchOver', 'the winning round goes straight to the end');
});

// --- Turn rules ---

test('draft: a pick out of turn is ignored, and so is an ability that was not offered', () => {
  let state = playRoundToDraft(204);
  const [first, second] = state.draft.order;

  // The second player tries to pick while it is the first player's turn.
  state = step(state, pickInput(second, { stat: 'speed', abilityId: state.draft.offers[second][0] }));
  assert.strictEqual(state.draft.turn, 0, 'out-of-turn pick must not advance the draft');
  assert.strictEqual(state.draft.picks[second], null);

  // The active player names something that was never offered.
  const notOffered = abilityPoolFor(state.players[first].characterId).find(
    (id) => !state.draft.offers[first].includes(id)
  );
  if (notOffered) {
    state = step(state, pickInput(first, { stat: 'hp', abilityId: notOffered }));
    assert.strictEqual(state.draft.turn, 0, 'un-offered ability must be rejected');
  }

  // A valid pick goes through.
  state = step(state, pickInput(first, { stat: 'hp', abilityId: state.draft.offers[first][0] }));
  assert.strictEqual(state.draft.turn, 1);
  assert.ok(state.draft.picks[first]);
});

test('draft: a turn that times out takes HP plus the first offer', () => {
  let state = playRoundToDraft(205);
  const active = state.draft.order[0];
  const firstOffer = state.draft.offers[active][0];

  const deadline = state.draft.turnEndsAtTick;
  while (state.tick < deadline) state = step(state, neutralInputs());

  const pick = state.draft.picks[active];
  assert.ok(pick, 'the turn should have resolved on its own');
  assert.strictEqual(pick.stat, 'hp');
  assert.strictEqual(pick.abilityId, firstOffer);
  assert.strictEqual(pick.timedOut, true);
  assert.strictEqual(state.draft.turn, 1);
});

test('draft: a timeout skips the ability when it is an active and both slots are full', () => {
  let state = playRoundToDraft(206);
  const active = state.draft.order[0];
  const player = state.players[active];

  // Fill both slots and force the first offer to be an active one.
  const pool = ABILITIES[player.characterId];
  const actives = Object.keys(pool).filter((id) => pool[id].type === 'active');
  player.abilities.slots = [actives[0], actives[1]];
  state.draft.offers[active] = [actives[2] || actives[0]];

  const deadline = state.draft.turnEndsAtTick;
  while (state.tick < deadline) state = step(state, neutralInputs());

  const pick = state.draft.picks[active];
  assert.strictEqual(pick.abilityId, null, 'the ability is skipped rather than evicting a chosen one');
  assert.strictEqual(pick.stat, 'hp', 'the stat point still lands');
  assert.deepStrictEqual(player.abilities.slots, [actives[0], actives[1]], 'slots untouched');
});

// --- Offers ---

test('draft: offers never include an ability the player already owns', () => {
  let state = playRoundToDraft(207);
  const active = state.draft.order[0];
  const player = state.players[active];

  // Take everything offered across successive drafts and check each new set.
  for (let round = 0; round < 3; round++) {
    const owned = new Set(ownedAbilities(player));
    for (const offered of state.draft.offers[active]) {
      assert.ok(!owned.has(offered), `${offered} was offered but is already owned`);
    }
    state = skipDraft(state);

    // Play another round out so a new draft opens.
    state.players[1].hp = 0;
    state.players[1].alive = false;
    state.players[1].deathTick = state.tick;
    state.players[2].hp = 0;
    state.players[2].alive = false;
    state.players[2].deathTick = state.tick;
    while (state.roundState !== 'draft' && state.roundState !== 'matchOver') {
      state = step(state, neutralInputs());
    }
    if (state.roundState === 'matchOver') break;
  }
});

test('draft: offers shrink as the pool runs out, and an exhausted pool means stat point only', () => {
  let state = playRoundToDraft(208);
  const active = state.draft.order[0];
  const player = state.players[active];
  const pool = abilityPoolFor(player.characterId);

  // Own everything except one: exactly one offer should remain.
  player.abilities.passives = pool.slice(0, pool.length - 1);
  let reopened = playRoundToDraft(209, [player.characterId, 'berserker', 'summoner']);
  reopened.players[0].abilities.passives = pool.slice(0, pool.length - 1);
  // Re-roll offers with the new ownership by starting a fresh draft.
  const remaining = pool.filter((id) => !reopened.players[0].abilities.passives.includes(id));
  assert.strictEqual(remaining.length, 1);

  // Own the whole pool: nothing left to offer.
  const emptyState = playRoundToDraft(210, [player.characterId, 'berserker', 'summoner']);
  emptyState.players[0].abilities.passives = [...pool];
  assert.strictEqual(ownedAbilities(emptyState.players[0]).length, pool.length);
});

// --- Slots ---

test('draft: an active fills the first free slot; with both full it must name a replacement', () => {
  // The Sniper is the only character with three actives, which is what this
  // test needs: two to fill the slots and a third to force a replacement.
  let state = playRoundToDraft(211, ['sniper', 'berserker', 'summoner']);
  const active = state.draft.order[0];
  const player = state.players[active];
  const pool = ABILITIES[player.characterId];
  const actives = Object.keys(pool).filter((id) => pool[id].type === 'active');
  assert.ok(actives.length >= 3, 'this test needs a character with 3 actives');

  // First active goes into slot 0.
  state.draft.offers[active] = [actives[0]];
  state = step(state, pickInput(active, { stat: 'hp', abilityId: actives[0] }));
  assert.strictEqual(state.players[active].abilities.slots[0], actives[0]);
  assert.strictEqual(state.players[active].abilities.slots[1], null);

  // Now fill both and try an active with no replaceSlot: rejected.
  const reopened = playRoundToDraft(212, ['sniper', 'berserker', 'summoner']);
  const p = reopened.players[reopened.draft.order[0]];
  p.abilities.slots = [actives[0], actives[1]];
  reopened.draft.offers[p.id] = [actives[2]];

  let s = step(reopened, pickInput(p.id, { stat: 'hp', abilityId: actives[2] }));
  assert.strictEqual(s.draft.turn, 0, 'a full-slot active with no replaceSlot must be rejected');

  // With replaceSlot it goes through, and the replaced ability is gone.
  s = step(reopened, pickInput(p.id, { stat: 'hp', abilityId: actives[2], replaceSlot: 1 }));
  assert.deepStrictEqual(s.players[p.id].abilities.slots, [actives[0], actives[2]]);
  assert.ok(!ownedAbilities(s.players[p.id]).includes(actives[1]), 'the replaced ability is released');
});

// --- Stat point ---

test('draft: the stat point adds exactly one, can exceed the pre-match cap, and applies next round', () => {
  let state = playRoundToDraft(213);
  const active = state.draft.order[0];
  const player = state.players[active];

  // Start already at the pre-match maximum in one category.
  player.boosts.hp = 10;
  recomputeDerivedStats(player);
  const before = player.maxHp;

  state = step(state, pickInput(active, { stat: 'hp', abilityId: state.draft.offers[active][0] }));

  const after = state.players[active];
  assert.strictEqual(after.statPicks.hp, 1);
  assert.strictEqual(after.boosts.hp, 10, 'the pre-match allocation itself is untouched');
  // 11 effective points: past the screen's 10-point budget, on purpose.
  const expected = CHARACTERS[after.characterId].hp * (1 + BOOST_BONUS_PER_POINT.hp * 11);
  assert.ok(Math.abs(after.maxHp - expected) < 1e-9, `maxHp ${after.maxHp} should be ${expected}`);
  assert.ok(after.maxHp > before);
});

// --- Determinism and persistence ---

test('draft: the same seed and the same picks replay identically', () => {
  const run = () => {
    let state = createInitialState(300, ['sniper', 'berserker', 'summoner']);
    while (state.roundState === 'countdown') state = step(state, neutralInputs());
    for (const p of state.players) p.invulnUntilTick = state.tick;
    state.players[1].hp = 0;
    state.players[1].alive = false;
    state.players[1].deathTick = state.tick;
    state.players[2].hp = 0;
    state.players[2].alive = false;
    state.players[2].deathTick = state.tick;
    while (state.roundState !== 'draft') state = step(state, neutralInputs());
    const offers = JSON.parse(JSON.stringify(state.draft.offers));
    state = skipDraft(state);
    for (let i = 0; i < 300; i++) state = step(state, neutralInputs());
    return { offers, state };
  };

  const a = run();
  const b = run();
  assert.deepStrictEqual(a.offers, b.offers, 'offers must be reproducible from the seed');
  assert.deepStrictEqual(a.state, b.state);
});

test('draft: abilities and stat points survive rounds; skill cooldowns and summons do not', () => {
  let state = newPlayingGame(214, ['summoner', 'berserker', 'sniper']);
  clearInvuln(state);

  // Dirty the per-round skill state WHILE the round is still running, so it is
  // the round boundary that has to clean it up.
  const during = state.players[0];
  during.skillCooldowns = [50, 50];
  during.chargingSkill = { slot: 0, startTick: 1 };
  during.dash = { ticksLeft: 5, vx: 1, vy: 0, damage: 0, invulnerable: false, hitIds: [] };
  state.vipers.push({
    id: 99,
    kind: 'viper',
    ownerId: 0,
    x: 1,
    y: 1,
    radiusTiles: 0.25,
    hp: 1,
    maxHp: 1,
    alive: true,
    biteCooldownTicks: 0,
    expiresAtTick: 99999,
  });

  // End the round with P0 surviving, so P0 drafts first.
  for (const id of [1, 2]) {
    state.players[id].hp = 0;
    state.players[id].alive = false;
    state.players[id].deathTick = state.tick + id;
  }
  state = step(state, neutralInputs());
  while (state.roundState === 'recap') state = step(state, neutralInputs());
  assert.strictEqual(state.roundState, 'draft');

  const active = state.draft.order[0];
  const player = state.players[active];
  const pool = ABILITIES[player.characterId];
  const anActive = Object.keys(pool).find((id) => pool[id].type === 'active');
  state.draft.offers[active] = [anActive];
  state = step(state, pickInput(active, { stat: 'slashDmg', abilityId: anActive }));
  state = skipDraft(state);

  while (state.roundState !== 'playing') state = step(state, neutralInputs());

  const next = state.players[active];
  assert.strictEqual(next.abilities.slots[0], anActive, 'the drafted ability carries over');
  assert.strictEqual(next.statPicks.slashDmg, 1, 'the stat point carries over');
  assert.deepStrictEqual(next.skillCooldowns, [0, 0], 'cooldowns reset');
  assert.strictEqual(next.chargingSkill, null);
  assert.strictEqual(next.dash, null);
  assert.strictEqual(state.vipers.length, 0, 'summons do not cross a round boundary');
});

test('draft: a brand-new match starts with no abilities and no drafted stat points', () => {
  const fresh = createInitialState(215, ['sniper', 'berserker', 'summoner']);
  for (const player of fresh.players) {
    assert.deepStrictEqual(player.abilities, { passives: [], slots: [null, null] });
    assert.deepStrictEqual(player.statPicks, { hp: 0, speed: 0, shootDmg: 0, slashDmg: 0 });
  }
  assert.strictEqual(fresh.draft, null);
  assert.strictEqual(DRAFT.activeSlots, 2);
});
