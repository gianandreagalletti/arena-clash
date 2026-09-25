// The single source of truth for what the controls ARE CALLED.
//
// Display data only: nothing here changes what any button does. The actual
// mappings live in gamepad.js / keyboardMouse.js / the menu scenes, and this
// table names them so the Help screen (and any future rebinding UI) never
// hand-maintains a second copy that can drift out of date.
//
// If you change a mapping in the input layer, change its label here too — the
// Help screen reads this and nothing else.

export const BINDINGS = [
  { action: 'Move', gamepad: 'Left stick', keyboard: 'WASD' },
  { action: 'Aim', gamepad: 'Right stick', keyboard: 'Mouse' },
  { action: 'Shoot (hold)', gamepad: 'RT', keyboard: 'Left click' },
  { action: 'Slash', gamepad: 'RB', keyboard: 'E' },
  { action: 'Shield', gamepad: 'LB', keyboard: 'Q' },
  { action: 'Ultimate', gamepad: 'Y', keyboard: 'R' },
  { action: 'Use item', gamepad: 'X', keyboard: 'F' },
  { action: 'Join / Confirm', gamepad: 'A', keyboard: 'Enter' },
  { action: 'Leave / Back', gamepad: 'B', keyboard: 'Esc' },
  { action: 'Help', gamepad: 'View', keyboard: 'H' },
];

/** Looks up one binding by action name. */
export function bindingFor(action) {
  return BINDINGS.find((b) => b.action === action) || null;
}

/** "X / F" — the short both-devices label Help uses for item prompts. */
export function shortLabelFor(action) {
  const binding = bindingFor(action);
  if (!binding) return '';
  return `${binding.gamepad} / ${binding.keyboard}`;
}

export const DEBUG_BINDINGS = [
  { action: 'Debug solo mode', keyboard: 'F1' },
  { action: 'Gamepad overlay (join screen)', keyboard: 'F2' },
  { action: 'Hitbox / aim overlay (in match)', keyboard: 'F3' },
];

// Xbox-standard index for the View/Back button (left of the Xbox button).
// Kept here next to its label so the two never disagree.
export const GAMEPAD_BUTTON_VIEW = 8;
