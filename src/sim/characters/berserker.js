// Thin wrapper re-exporting the Berserker's data-only definition from balance.js
// (the single source of truth for numbers — architecture rule 8).
// Shoot/Slash/Shield baselines live in balance.js ACTIONS; per-character
// overrides and abilities live on this character's own CHARACTERS entry.
// Berserker identity: tanky, with the telegraphed AoE `nova` ability.

import { CHARACTERS } from '../config/balance.js';

export const berserker = CHARACTERS.berserker;

export default berserker;
