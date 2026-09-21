import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/sim/state.js';
import { step, NEUTRAL_INPUT } from '../src/sim/step.js';

function scriptedInputs(tick) {
  // A deterministic (non-random) but varying input sequence exercising
  // movement, aiming and all three actions for all 3 players.
  const t = tick / 60;
  return [
    {
      ...NEUTRAL_INPUT,
      moveX: Math.sin(t),
      moveY: Math.cos(t * 0.7),
      aimX: 1,
      aimY: 0,
      fire: tick % 10 === 0,
      slash: tick % 17 === 0,
      shield: tick % 97 === 0,
    },
    {
      ...NEUTRAL_INPUT,
      moveX: -Math.cos(t * 0.5),
      moveY: Math.sin(t),
      aimX: -1,
      aimY: 0.3,
      fire: tick % 13 === 0,
      slash: tick % 11 === 0,
      shield: tick % 131 === 0,
    },
    {
      ...NEUTRAL_INPUT,
      moveX: 0.5,
      moveY: -0.5,
      aimX: 0,
      aimY: -1,
      fire: tick % 7 === 0,
      slash: tick % 23 === 0,
      shield: tick % 73 === 0,
    },
  ];
}

test('determinism: same seed + same input sequence run twice -> identical final state', () => {
  const chars = ['sniper', 'berserker', 'summoner'];
  let a = createInitialState(42, chars);
  let b = createInitialState(42, chars);

  for (let tick = 1; tick <= 400; tick++) {
    a = step(a, scriptedInputs(tick));
    b = step(b, scriptedInputs(tick));
  }

  assert.deepStrictEqual(a, b);
});
