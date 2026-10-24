import { validateCombination } from './combinations.js';

const check = (condition) => { if (!condition) throw new Error('Coup invalide'); };
const physical = ({ id, rank, suit }) => ({ id, rank, suit });
const proposal = (group) => {
  const joker = group.cards.find((card) => card.rank === 'Joker');
  return { type: group.type, cardIds: group.cards.map((card) => card.id),
    ...(joker ? { joker: { cardId: joker.id, ...joker.substitution } } : {}) };
};
function validated(group) {
  const result = validateCombination(proposal(group), group.cards.map(physical));
  check(result.valid);
  return { id: group.id, type: result.type, cards: result.cards };
}

/** Replace only explicitly recorded Joker slots in an otherwise immutable base group. */
export function replacementBase(game, ownerId, base) {
  check(base && Array.isArray(base.cards));
  const records = game.recoveries.filter((record) => record.ownerId === ownerId && record.groupId === base.id);
  if (!records.length) return base;
  let cards = base.cards.map((card) => ({ ...card }));
  for (const record of records) {
    const index = cards.findIndex((card) => card.id === record.joker.id);
    const joker = cards[index];
    check(joker && joker.rank === 'Joker' && joker.substitution
      && joker.substitution.rank === record.substitution.rank && joker.substitution.suit === record.substitution.suit
      && record.natural.rank === record.substitution.rank && record.natural.suit === record.substitution.suit);
    cards[index] = { ...physical(record.natural), substitution: null };
  }
  return validated({ ...base, cards });
}

export function prepareRecovery(game, ownerId, current, jokerId, natural) {
  validated(current); // Never recover from an invalid group, even if a swap could repair it.
  const index = current.cards.findIndex((card) => card.id === jokerId);
  const joker = current.cards[index];
  check(joker && joker.rank === 'Joker' && joker.substitution && natural && natural.rank !== 'Joker'
    && natural.rank === joker.substitution.rank && natural.suit === joker.substitution.suit
    && !game.recoveries.some((record) => record.joker.id === jokerId || record.natural.id === natural.id));
  const cards = current.cards.map((card, i) => i === index ? { ...physical(natural), substitution: null } : card);
  return { group: validated({ ...current, cards }), record: {
    ownerId, groupId: current.id, joker: physical(joker), natural: physical(natural), substitution: { ...joker.substitution },
  } };
}

export function restoreRecoveredJoker(group, record) {
  validated(group);
  const index = group.cards.findIndex((card) => card.id === record.natural.id);
  check(index !== -1 && group.cards[index].rank === record.substitution.rank && group.cards[index].suit === record.substitution.suit);
  const cards = group.cards.map((card, i) => i === index ? { ...record.joker, substitution: { ...record.substitution } } : card);
  return validated({ ...group, cards });
}

export function recoveryPendingIds(game, effectiveGroups) {
  const used = new Set(effectiveGroups.flatMap((group) => group.cards.filter((card) => card.rank === 'Joker').map((card) => card.id)));
  return game.recoveries.filter((record) => !used.has(record.joker.id)).map((record) => record.joker.id);
}

/** Recovery rights are independent of opponent Collage thresholds. */
export function validateRecoveries(game, playerId, pendingOpening, effectiveGroups) {
  if (!game.recoveries.length) return;
  check(game.opened[playerId] || pendingOpening?.valid);
  check(new Set(game.recoveries.map((record) => record.joker.id)).size === game.recoveries.length
    && new Set(game.recoveries.map((record) => record.natural.id)).size === game.recoveries.length);
  for (const record of game.recoveries) {
    check(game.order.includes(record.ownerId)
      && game.turnBaseHand.some((card) => card.id === record.natural.id && card.rank === record.natural.rank && card.suit === record.natural.suit)
      && record.joker.rank === 'Joker' && record.joker.suit === null);
    const base = game.laid[record.ownerId].find((group) => group.id === record.groupId)
      ?? (record.ownerId === playerId ? game.staged.find((group) => group.id === record.groupId) : null);
    const overlay = game.collages.find((item) => item.ownerId === record.ownerId && item.groupId === record.groupId);
    check(base && overlay);
    replacementBase(game, record.ownerId, base);
    check(overlay.group.cards.some((card) => card.id === record.natural.id && card.rank === record.natural.rank && card.suit === record.natural.suit));
  }
  check(recoveryPendingIds(game, effectiveGroups).length === 0);
}
