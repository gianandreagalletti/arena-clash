// The end-of-round log's draft and ability columns.
//
// These are the numbers a balance pass will actually be read off, so the test
// pins the SHAPE (what is recorded, in what order) rather than any one value.

import test from 'node:test';
import assert from 'node:assert/strict';
import { step, neutralInputs, makeInput, newPlayingGame, clearInvuln } from './helpers.js';
import { abilityConfig } from '../src/sim/config/balance.js';

/** Plays a round to its end: P0 wins, P2 dies first, P1 second. */
function playRoundToEnd(state) {
  let s = clearInvuln(state);
  s.players[2].hp = 0;
  s.players[2].alive = false;
  s.players[2].deathTick = s.tick;
  s = step(s, neutralInputs());

  s.players[1].hp = 0;
  s.players[1].alive = false;
  s.players[1].deathTick = s.tick;
  return step(s, neutralInputs());
}

/** Runs the recap out and drives the draft with explicit picks. */
function draftWith(state, pickFor) {
  let s = state;
  while (s.roundState === 'recap') s = step(s, neutralInputs());
  assert.strictEqual(s.roundState, 'draft');

  while (s.roundState === 'draft') {
    const active = s.draft.order[s.draft.turn];
    const pick = pickFor(active, s.draft.offers[active], s);
    if (pick === null) {
      // Let this turn time out instead of picking.
      while (s.roundState === 'draft' && s.draft.order[s.draft.turn] === active) {
        s = step(s, neutralInputs());
      }
      continue;
    }
    const inputs = neutralInputs();
    inputs[active] = makeInput({ draftPick: pick });
    s = step(s, inputs);
  }
  return s;
}

test('log: round 1 has no draft, round 2 records order, offers and picks', () => {
  let state = playRoundToEnd(newPlayingGame(401));

  const first = state.logs[0];
  assert.strictEqual(first.draft, null, 'nothing is drafted before round 1');

  const takenBy = {};
  state = draftWith(state, (playerId, offers) => {
    takenBy[playerId] = offers[0] || null;
    return { stat: 'speed', abilityId: offers[0] || null, replaceSlot: 0 };
  });

  // Play round 2 out the same way and read its log.
  while (state.roundState === 'countdown') state = step(state, neutralInputs());
  state = playRoundToEnd(state);

  const log = state.logs[1];
  assert.ok(log.draft, 'round 2 is preceded by a draft and must record it');
  // Pick order from round 1: P0 survived, P1 died second, P2 died first.
  assert.deepStrictEqual(log.draft.order, [0, 1, 2]);
  assert.deepStrictEqual(
    log.draft.picks.map((p) => p.playerId),
    [0, 1, 2],
    'picks are listed in pick order, not player order'
  );

  for (const pick of log.draft.picks) {
    assert.ok(pick.offers.length > 0, `P${pick.playerId} was offered nothing`);
    assert.strictEqual(pick.stat, 'speed');
    assert.strictEqual(pick.abilityId, takenBy[pick.playerId]);
    assert.ok(pick.offers.includes(pick.abilityId), 'what was taken must have been offered');
    assert.strictEqual(pick.timedOut, false);
    assert.strictEqual(pick.characterId, state.players[pick.playerId].characterId);
  }
});

test('log: a turn that runs out is recorded as timed out, with the default pick', () => {
  let state = playRoundToEnd(newPlayingGame(402));

  // P1 never picks; everyone else does.
  state = draftWith(state, (playerId, offers) =>
    playerId === 1 ? null : { stat: 'hp', abilityId: offers[0] || null, replaceSlot: 0 }
  );

  while (state.roundState === 'countdown') state = step(state, neutralInputs());
  state = playRoundToEnd(state);

  const picks = state.logs[1].draft.picks;
  const timedOut = picks.find((p) => p.playerId === 1);
  const chose = picks.find((p) => p.playerId === 0);

  assert.strictEqual(timedOut.timedOut, true);
  assert.strictEqual(timedOut.stat, 'hp', 'the timeout default puts the point in HP');
  assert.strictEqual(chose.timedOut, false);
});

test('log: loadout and per-ability damage/uses are recorded per player', () => {
  let state = playRoundToEnd(newPlayingGame(403));

  // Give P0 (the sniper) a known ability, then play a round using it.
  state = draftWith(state, (playerId, offers) => {
    if (playerId !== 0) return { stat: 'hp', abilityId: offers[0] || null, replaceSlot: 0 };
    const roll = offers.includes('roll') ? 'roll' : offers[0];
    return { stat: 'hp', abilityId: roll, replaceSlot: 0 };
  });

  while (state.roundState === 'countdown') state = step(state, neutralInputs());
  state = clearInvuln(state);

  // Asserted, not guarded: if a balance change stops offering Roll here, this
  // test must fail loudly rather than quietly stop checking anything.
  const slot = state.players[0].abilities.slots.indexOf('roll');
  assert.notStrictEqual(slot, -1, 'P0 should have drafted Roll at this seed');

  const inputs = neutralInputs();
  inputs[0] = makeInput({ [slot === 0 ? 'skill1' : 'skill2']: true, moveX: 1 });
  state = step(state, inputs);
  // Let the dash run out before the round is ended.
  const duration = abilityConfig('sniper', 'roll').durationTicks;
  for (let i = 0; i < duration + 2; i++) state = step(state, neutralInputs());

  state = playRoundToEnd(state);
  const p0 = state.logs[1].players[0];

  assert.ok(Array.isArray(p0.slots) && p0.slots.length === 2, 'both slots are recorded');
  assert.ok(Array.isArray(p0.passives));
  assert.deepStrictEqual(Object.keys(p0.statPicks).sort(), ['hp', 'shootDmg', 'slashDmg', 'speed']);
  assert.ok(p0.statPicks.hp >= 1, 'the drafted stat point shows up');

  assert.strictEqual(p0.abilityUses.roll, 1, 'a Roll deals no damage, so it counts as a use');
  assert.strictEqual(p0.damageByAbility.roll, undefined, 'and must not also appear as damage');
  assert.ok(p0.slots.includes('roll'), 'the drafted active shows in the recorded loadout');
});

test('log: a replacement records the slot used and what it dropped; a free slot records neither', () => {
  let state = playRoundToEnd(newPlayingGame(404));

  // Round 1 draft: everyone fills a free slot.
  state = draftWith(state, (playerId, offers) => {
    const active = offers.find((id) => abilityConfig(state.players[playerId].characterId, id).type === 'active');
    return { stat: 'hp', abilityId: active || offers[0] || null, replaceSlot: 1 };
  });
  while (state.roundState === 'countdown') state = step(state, neutralInputs());
  state = playRoundToEnd(state);

  for (const pick of state.logs[1].draft.picks) {
    if (!pick.abilityId) continue;
    assert.strictEqual(pick.replaced, null, 'a free slot drops nothing, whatever the input asked for');
  }

  // Round 2 draft: force P0 into a replacement by filling both its slots.
  state.players[0].abilities.slots = ['roll', 'vanish'];
  state = draftWith(state, (playerId, offers) => {
    const characterId = state.players[playerId].characterId;
    const active = offers.find((id) => abilityConfig(characterId, id).type === 'active');
    return { stat: 'hp', abilityId: active || offers[0] || null, replaceSlot: 1 };
  });
  while (state.roundState === 'countdown') state = step(state, neutralInputs());
  state = playRoundToEnd(state);

  const p0Pick = state.logs[2].draft.picks.find((p) => p.playerId === 0);
  assert.strictEqual(p0Pick.slot, 1, 'the replacement went into the slot that was named');
  assert.strictEqual(p0Pick.replaced, 'vanish', 'and the log says what it pushed out');
  assert.strictEqual(state.players[0].abilities.slots[1], p0Pick.abilityId);
});
