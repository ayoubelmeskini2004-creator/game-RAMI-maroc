import { validateOpening } from './combinations.js';

/** Only committed openings unlock the partner exception; team membership is server-owned. */
export function teamOpeningDonor(game, playerId) {
  if (game.mode !== 'teams' || game.opened[playerId] || game.order.length !== 4
    || new Set(game.order).size !== 4
    || !['A', 'B'].every((team) => game.order.filter((id) => game.teams[id] === team).length === 2)) return null;
  const partner = game.order.find((id) => id !== playerId && game.teams[id] === game.teams[playerId]);
  return partner && game.opened[partner] && Number.isFinite(game.openingTotals[partner])
    && game.openingInheritedFrom[partner] === undefined ? partner : null;
}

/** Keep ordinary structural/ownership checks, replacing only its minimum/pure-group requirements. */
export function validateTeamOpening(proposals, cards, options) {
  const result = validateOpening(proposals, cards, options);
  const ordinaryRequirements = new Set(['MISSING_PURE_SUITE', 'MISSING_PURE_TIERCE', 'INSUFFICIENT_NATURAL_POINTS']);
  const errors = result.errors.filter((error) => !ordinaryRequirements.has(error.code));
  if (!result.groups.some((group) => group.type === 'suite')) errors.push({ code: 'MISSING_TEAM_SUITE', message: 'Une Suite valide est obligatoire pour votre ouverture d’équipe.' });
  return { ...result, valid: errors.length === 0, errors };
}
