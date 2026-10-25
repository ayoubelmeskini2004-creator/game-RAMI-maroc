import { validateCombination } from './combinations.js';
import { replacementBase } from './joker-state.js';

const check = (condition) => { if (!condition) throw new Error('Coup invalide'); };
export const physicalCard = ({ id, rank, suit }) => ({ id, rank, suit });
const proposal = (group) => {
  const joker = group.cards.find((card) => card.rank === 'Joker');
  return { type: group.type, cardIds: group.cards.map((card) => card.id),
    ...(joker ? { joker: { cardId: joker.id, ...joker.substitution } } : {}) };
};

export function findBaseGroup(game, ownerId, groupId) {
  if (!game.order.includes(ownerId)) return null;
  return game.laid[ownerId].find((group) => group.id === groupId)
    ?? (ownerId === game.activePlayerId ? game.staged.find((group) => group.id === groupId) : null);
}
export function effectiveGroup(game, ownerId, group) {
  return game.collages.find((overlay) => overlay.ownerId === ownerId && overlay.groupId === group.id)?.group ?? replacementBase(game, ownerId, group);
}

// The inheritance link is written only by the server at the special opening's atomic commit.
export function recordedCollageTotal(game, playerId) {
  if (!game.opened[playerId]) return null;
  const donor = game.openingInheritedFrom[playerId];
  if (donor !== undefined) {
    if (game.mode !== 'teams' || donor === playerId || !game.order.includes(donor)
      || !game.opened[donor] || !game.teams[playerId] || game.teams[playerId] !== game.teams[donor]
      || game.openingInheritedFrom[donor] !== undefined) return null;
    return Number.isFinite(game.openingTotals[donor]) ? game.openingTotals[donor] : null;
  }
  return Number.isFinite(game.openingTotals[playerId]) ? game.openingTotals[playerId] : null;
}

export function canCollageOn(game, playerId, ownerId, pendingOpening = null) {
  if (!game.order.includes(playerId) || !game.order.includes(ownerId)) return false;
  const ready = game.opened[playerId] || pendingOpening?.valid;
  if (!ready) return false;
  if (ownerId === playerId) return true;
  if (game.mode === 'teams' && game.teams[playerId] && game.teams[playerId] === game.teams[ownerId]) return true;
  const actorTotal = game.opened[playerId] ? recordedCollageTotal(game, playerId)
    : pendingOpening.kind === 'team' ? recordedCollageTotal(game, pendingOpening.inheritedFrom) : pendingOpening.totalLaidPoints;
  const ownerTotal = recordedCollageTotal(game, ownerId);
  return actorTotal !== null && ownerTotal !== null && actorTotal > ownerTotal;
}

/** An existing group stays a contiguous, identical block, including its Joker assignment. */
export function validatePreservedGroup(base, expanded) {
  check(base && expanded && base.id === expanded.id);
  const start = expanded.cards.findIndex((card) => card.id === base.cards[0].id);
  check(start >= 0 && base.cards.every((card, i) => {
    const next = expanded.cards[start + i];
    return next && next.id === card.id && next.rank === card.rank && next.suit === card.suit
      && (card.substitution == null ? next.substitution == null
        : next.substitution?.rank === card.substitution.rank && next.substitution?.suit === card.substitution.suit);
  }));
  const expectedType = base.type === 'tierce' && expanded.cards.length === 4 ? 'carre' : base.type;
  check(expanded.type === expectedType);
  const result = validateCombination(proposal(expanded), expanded.cards.map(physicalCard));
  check(result.valid);
  return { id: base.id, type: result.type, cards: result.cards };
}

export function extendGroup(base, cards, side = 'auto', joker) {
  check(['auto', 'prepend', 'append'].includes(side));
  check(cards.length > 0);
  const addedJoker=cards.find(card=>card.rank==='Joker');
  check(!addedJoker || cards.length===1&&joker?.cardId===addedJoker.id&&!base.cards.some(card=>card.rank==='Joker'));
  check(addedJoker || joker===undefined);
  const results = [];
  for (const edge of side === 'auto' ? ['append', 'prepend'] : [side]) {
    const merged = edge === 'append' ? [...base.cards, ...cards] : [...cards, ...base.cards];
    const type=base.type === 'tierce' && merged.length === 4 ? 'carre' : base.type;
    const assignment=addedJoker?joker:proposal(base).joker;
    const result=validateCombination({type,cardIds:merged.map(card=>card.id),...(assignment?{joker:assignment}:{})},merged.map(physicalCard));
    if(!result.valid)continue;
    const expanded = { ...base, type, cards: result.cards };
    try { results.push(validatePreservedGroup(base, expanded)); } catch { /* Try the other edge, never rearrange. */ }
  }
  check(results.length > 0);
  // For sets both edges are equivalent; append preserves their displayed order by default.
  return results[0];
}

export function validateCollageOverlays(game, playerId, pendingOpening) {
  const usedTargets = new Set();
  const usedCards = new Set();
  for (const overlay of game.collages) {
    const key = `${overlay.ownerId}:${overlay.groupId}`;
    check(!usedTargets.has(key)); usedTargets.add(key);
    const original = findBaseGroup(game, overlay.ownerId, overlay.groupId);
    check(original);
    const base = replacementBase(game, overlay.ownerId, original);
    const hasRecovery = game.recoveries.some((record) => record.ownerId === overlay.ownerId && record.groupId === overlay.groupId);
    check(overlay.addedCardIds.length ? canCollageOn(game, playerId, overlay.ownerId, pendingOpening)
      : hasRecovery && (game.opened[playerId] || pendingOpening?.valid));
    validatePreservedGroup(base, overlay.group);
    const baseIds = new Set(base.cards.map((card) => card.id));
    const actualAdded = overlay.group.cards.filter((card) => !baseIds.has(card.id));
    check((actualAdded.length > 0 || hasRecovery) && actualAdded.length === overlay.addedCardIds.length
      && new Set(overlay.addedCardIds).size === overlay.addedCardIds.length);
    for (const card of actualAdded) {
      check(overlay.addedCardIds.includes(card.id) && !usedCards.has(card.id)
        && (game.turnBaseHand.some((original) => original.id === card.id && original.rank === card.rank && original.suit === card.suit)||game.recoveries.some(record=>record.joker.id===card.id&&card.rank==='Joker')));
      usedCards.add(card.id);
    }
  }
}

/** Build a detached commit plan only after all turn validation has succeeded. */
export function committedMelds(game, playerId) {
  const laid = structuredClone(game.laid);
  for (const ownerId of game.order) laid[ownerId] = laid[ownerId].map((group) => structuredClone(effectiveGroup(game, ownerId, group)));
  laid[playerId].push(...game.staged.map((group) => structuredClone(effectiveGroup(game, playerId, group))));
  return laid;
}

// Enumerate legal explicit assignments; never guess a missing rank or suit.
export function jokerExtensions(base,card){
  if(card?.rank!=='Joker'||!base||base.cards.some(item=>item.rank==='Joker'))return [];
  const results=[];
  for(const side of base.type==='suite'?['append','prepend']:['append'])for(const suit of ['hearts','diamonds','clubs','spades'])for(const rank of ['A','2','3','4','5','6','7','8','9','10','V','D','R']){
    const joker={cardId:card.id,rank,suit};
    try{extendGroup(base,[physicalCard(card)],side,joker);results.push({side,joker});}catch{}
  }
  return results;
}

export const jokerOpeningReady=status=>!!status&&status.errors.every(error=>error.code==='OPENING_ESCALATION');
