// Thin wrapper re-exporting the Sniper's data-only definition from balance.js
// (the single source of truth for numbers — architecture rule 8).
// Shoot/Slash/Shield baselines live in balance.js ACTIONS; per-character
// overrides and abilities live on this character's own CHARACTERS entry.
// Sniper identity: high damage per shot, low rate of fire (its `shoot` block
// overrides the shared ACTIONS baseline). No ability.

import { CHARACTERS } from '../config/balance.js';

export const sniper = CHARACTERS.sniper;

export default sniper;
