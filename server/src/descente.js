import { randomUUID } from 'node:crypto';
import { validateCombination, validateOpening } from './combinations.js';
import { effectiveGroup, findBaseGroup, canCollageOn, extendGroup, validatePreservedGroup, validateCollageOverlays } from './collage.js';
import { replacementBase, prepareRecovery, restoreRecoveredJoker, validateRecoveries } from './joker-state.js';
import { teamOpeningDonor, validateTeamOpening } from './team-opening.js';
import { validPosition } from './group-layout.js';
import { emptyTurn, allTurns } from './turns.js';

const requireMove = (condition) => { if (!condition) throw new Error('Coup invalide'); };
const physical = (card) => ({ id: card.id, rank: card.rank, suit: card.suit });
const copy = (value) => structuredClone(value);
export const openingMinimumTotal = (game) => game.firstOpening === null ? 71 : game.firstOpening.total + 1;

export function groupProposal(group) {
  const joker = group.cards.find((card) => card.rank === 'Joker');
  return { type: group.type, cardIds: group.cards.map((card) => card.id),
    ...(joker ? { joker: { cardId: joker.id, ...joker.substitution } } : {}) };
}

export function turnCards(game, playerId) {
  return [...game.hands[playerId], ...game.staged.flatMap((group) => replacementBase(game, playerId, group).cards.map(physical)),
    ...game.collages.flatMap((overlay) => overlay.group.cards.filter((card) => overlay.addedCardIds.includes(card.id)).map(physical)),
    ...game.recoveries.filter((record) => record.ownerId !== playerId || !game.staged.some((group) => group.id === record.groupId)).map((record) => physical(record.natural))];
}

export function openingStatus(game, playerId, groups = game.staged, cards = turnCards(game, playerId), taken = game.discardTakenCardId) {
  const inheritedFrom = teamOpeningDonor(game, playerId);
  const proposals = groups.map((group) => groupProposal(effectiveGroup(game, playerId, group)));
  if (inheritedFrom) {
    const result = validateTeamOpening(proposals, cards, { discardTakenCardId: taken });
    return { valid: result.valid, qualifyingNaturalPoints: result.qualifyingNaturalPoints, totalLaidPoints: result.totalLaidPoints,
      minimumTotal: 0, kind: 'team', inheritedFrom, collageEligibilityTotal: game.openingTotals[inheritedFrom], errors: result.errors };
  }
  const minimumTotal = openingMinimumTotal(game);
  const result = validateOpening(proposals, cards, { discardTakenCardId: taken });
  return { valid: result.valid && result.totalLaidPoints >= minimumTotal,
    qualifyingNaturalPoints: result.qualifyingNaturalPoints, totalLaidPoints: result.totalLaidPoints,
    minimumTotal, errors: [...result.errors, ...(result.totalLaidPoints < minimumTotal && game.firstOpening !== null
      ? [{ code: 'OPENING_ESCALATION', message: `La pose doit totaliser au moins ${minimumTotal} points.` }] : [])] };
}

function validateGroups(proposals, cards) {
  requireMove(Array.isArray(proposals) && proposals.length > 0 && proposals.length <= 36);
  const groups = Array.from(proposals).map((proposal) => {
    const result = validateCombination(proposal, cards);
    requireMove(result.valid);
    requireMove(proposal.position === undefined || validPosition(proposal.position));
    return { id: randomUUID(), type: result.type, cards: result.cards, ...(proposal.position ? { position: { x: proposal.position.x, y: proposal.position.y } } : {}) };
  });
  const ids = groups.flatMap((group) => group.cards.map((card) => card.id));
  requireMove(new Set(ids).size === ids.length);
  return groups;
}

export function startTurnStaging(game, playerId, taken = null) {
  Object.assign(game,emptyTurn(game.hands[playerId],taken));
  game.contextPlayerId=playerId;
  game.mustDiscard[playerId]=true;
}

function validateStagingTurn(game, playerId, payload) {
  requireMove(game && game.contextPlayerId === playerId && game.mustDiscard[playerId] && ['discard', 'draw'].includes(game.phase)
    && !game.initialDiscard && game.revision === payload?.revision);
}
function remember(game, playerId) {
  game.turnUndo.push({ hand: copy(game.hands[playerId]), staged: copy(game.staged), collages: copy(game.collages), recoveries: copy(game.recoveries) });
}

/** Add one or several groups; hands and staged cards remain disjoint at all times. */
export function stageGroups(game, playerId, payload) {
  validateStagingTurn(game, playerId, payload);
  const groups = validateGroups(payload?.groups, game.hands[playerId]);
  const staged = [...game.staged, ...groups];
  const cards = turnCards(game, playerId);
  const ids = new Set(groups.flatMap((group) => group.cards.map((card) => card.id)));
  requireMove(game.hands[playerId].length > ids.size); // Keep a physical card for the mandatory discard.
  // A Joker batch needs a qualifying opening under the applicable ordinary/team rule.
  // Natural groups may be built incrementally below 71; discard remains the commit gate.
  if (!game.opened[playerId] && groups.some((group) => group.cards.some((card) => card.rank === 'Joker'))) {
    requireMove(teamOpeningDonor(game, playerId) ? openingStatus(game, playerId, staged, cards).valid
      : validateOpening(staged.map((group) => groupProposal(effectiveGroup(game, playerId, group))), cards, { discardTakenCardId: game.discardTakenCardId }).valid);
  }
  remember(game, playerId);
  game.staged = staged;
  for (const group of groups) if (group.position) {
    game.groupPositions ??= {}; game.groupPositions[group.id] = group.position;
    game.layoutRevision = (game.layoutRevision ?? 0) + 1;
  }
  game.hands[playerId] = game.hands[playerId].filter((card) => !ids.has(card.id));
  game.revision++;
}

/** Preflight an unopened discard pickup before touching either pile or hand. */
export function prepareDiscardOpening(game, playerId, proposals) {
  requireMove(game.discard.length > 0);
  const top = game.discard.at(-1);
  const cards = [...game.hands[playerId], top];
  const groups = validateGroups(proposals, cards);
  const count = groups.reduce((sum, group) => sum + group.cards.length, 0);
  requireMove(count < cards.length && openingStatus(game, playerId, [...game.staged, ...groups], [...turnCards(game, playerId), top], top.id).valid);
  return groups;
}

export function installDiscardOpening(game, playerId, groups) {
  const used = new Set(groups.flatMap((group) => group.cards.map((card) => card.id)));
  remember(game, playerId);
  game.staged = [...game.staged, ...groups];
  for (const group of groups) if (group.position) {
    game.groupPositions ??= {}; game.groupPositions[group.id] = group.position;
    game.layoutRevision = (game.layoutRevision ?? 0) + 1;
  }
  game.hands[playerId] = game.hands[playerId].filter((card) => !used.has(card.id));
}

export function undoStaging(game, playerId, payload) {
  validateStagingTurn(game, playerId, payload);
  requireMove(typeof payload?.all === 'boolean' && game.turnUndo.length > 0);
  if (payload.all) {
    game.hands[playerId] = copy(game.turnBaseHand);
    game.staged = [];
    game.collages = [];
    game.recoveries = [];
    game.turnUndo = [];
  } else {
    const last = game.turnUndo.pop();
    game.hands[playerId] = last.hand;
    game.staged = last.staged;
    game.collages = last.collages;
    game.recoveries = last.recoveries;
  }
  game.revision++;
}

export function retrieveStaged(game, playerId, payload) {
  validateStagingTurn(game, playerId, payload);
  if(payload?.selections!==undefined){
    const selections=payload.selections;
    requireMove(Array.isArray(selections)&&selections.length>0&&selections.length<=36);
    requireMove(new Set(selections.map(item=>`${item?.ownerId}:${item?.groupId}`)).size===selections.length);
    const candidate=copy(game),historyLength=game.turnUndo.length;
    for(const selection of selections){
      requireMove(selection&&typeof selection.groupId==='string'&&typeof selection.ownerId==='string');
      requireMove(Array.isArray(selection.cardIds)&&selection.cardIds.length>0&&selection.cardIds.length<=108&&new Set(selection.cardIds).size===selection.cardIds.length);
      requireMove(!Object.entries(allTurns(game)).some(([owner,turn])=>owner!==playerId&&turn.collages.some(overlay=>overlay.groupId===selection.groupId)));
      retrieveStaged(candidate,playerId,{ownerId:selection.ownerId,groupId:selection.groupId,cardIds:selection.cardIds,revision:candidate.revision});
    }
    // One gesture is one undoable, atomic operation, even across multiple groups.
    candidate.turnUndo=[...game.turnUndo,candidate.turnUndo[historyLength]];
    candidate.revision=game.revision+1;
    Object.assign(game,candidate);
    return;
  }
  const index = game.staged.findIndex((group) => group.id === payload?.groupId);
  if (index === -1) return retrieveCollage(game, playerId, payload);
  requireMove(payload.ownerId === undefined || payload.ownerId === playerId);
  requireMove(!game.recoveries.some((record) => record.ownerId === playerId && record.groupId === payload.groupId));
  const group = effectiveGroup(game, playerId, game.staged[index]);
  let returned = group.cards;
  let replacement = null;
  if (payload.cardId !== undefined || payload.cardIds !== undefined) {
    const ids=payload.cardIds??[payload.cardId];
    requireMove(Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&Array.from(ids).every(id=>typeof id==='string'&&group.cards.some(card=>card.id===id)));
    returned = group.cards.filter((card) => ids.includes(card.id));
    const remaining = { ...group, type: group.type === 'carre' ? 'tierce' : group.type,
      cards: group.cards.filter((card) => !ids.includes(card.id)) };
    const result = validateCombination(groupProposal(remaining), remaining.cards.map(physical));
    if(result.valid)replacement = { ...group, type: result.type, cards: result.cards };
    else if(payload.cardIds!==undefined)returned=group.cards; // Dissolve an incomplete provisional group.
    else requireMove(false);
  }
  remember(game, playerId);
  game.hands[playerId].push(...returned.map(physical));
  if (replacement) game.staged[index] = replacement;
  else game.staged.splice(index, 1);
  game.collages = game.collages.filter((overlay) => !(overlay.ownerId === playerId && overlay.groupId === group.id));
  game.revision++;
}

export { cancelPickup as cancelDiscardPickup } from './pickup-return.js';

/** Validate everything first; callers commit only after this succeeds. */
export function validateStagedCommit(game, playerId) {
  requireMove(!game.initialDiscard || (game.staged.length === 0 && game.collages.length === 0 && game.recoveries.length === 0));
  const cards = turnCards(game, playerId);
  requireMove(new Set(cards.map((card) => card.id)).size === cards.length);
  for (const group of game.staged) requireMove(validateCombination(groupProposal(effectiveGroup(game, playerId, group)), cards).valid);
  const needsOpening = !game.opened[playerId] && (game.staged.length > 0 || game.discardTakenCardId !== null);
  const status = needsOpening ? openingStatus(game, playerId) : null;
  if (needsOpening) requireMove(status.valid);
  validateCollageOverlays(game, playerId, status);
  validateRecoveries(game, playerId, status, game.staged.map((group) => effectiveGroup(game, playerId, group)));
  return status;
}

/** Extend a target without ever mutating its committed base. */
export function stageCollage(game, playerId, payload) {
  validateStagingTurn(game, playerId, payload);
  const base = findBaseGroup(game, payload?.ownerId, payload?.groupId);
  requireMove(base && canCollageOn(game, playerId, payload.ownerId, game.opened[playerId] ? null : openingStatus(game, playerId)));
  const ids = payload?.cardIds;
  requireMove(Array.isArray(ids) && ids.length > 0 && ids.length <= 11 && new Set(ids).size === ids.length
    && game.hands[playerId].length > ids.length);
  const cards = Array.from(ids).map((id) => game.hands[playerId].find((card) => card.id === id));
  requireMove(cards.every((card) => card && card.rank !== 'Joker'));
  const current = effectiveGroup(game, payload.ownerId, base);
  const expanded = extendGroup(current, cards.map(physical), payload.side ?? 'auto');
  const previous = game.collages.find((overlay) => overlay.ownerId === payload.ownerId && overlay.groupId === base.id);
  const overlay = { ownerId: payload.ownerId, groupId: base.id, group: expanded,
    addedCardIds: [...(previous?.addedCardIds ?? []), ...ids] };
  const collages = [...game.collages.filter((item) => item !== previous), overlay];
  const candidate = { ...game, collages, hands: { ...game.hands, [playerId]: game.hands[playerId].filter((card) => !ids.includes(card.id)) } };
  // A same-turn opening must remain complete (e.g. do not erase the only Tierce by making it a Carré).
  if (!game.opened[playerId]) requireMove(openingStatus(candidate, playerId).valid);
  remember(game, playerId);
  game.collages = collages;
  game.hands[playerId] = candidate.hands[playerId];
  game.revision++;
}

function retrieveCollage(game, playerId, payload) {
  const overlay = game.collages.find((item) => item.groupId === payload?.groupId && (payload.ownerId === undefined || item.ownerId === payload.ownerId));
  requireMove(overlay);
  const base = replacementBase(game, overlay.ownerId, findBaseGroup(game, overlay.ownerId, overlay.groupId));
  let returnedIds = payload.cardIds ?? (payload.cardId === undefined ? overlay.addedCardIds : [payload.cardId]);
  requireMove(Array.isArray(returnedIds)&&new Set(returnedIds).size===returnedIds.length);
  requireMove(returnedIds.length > 0 && Array.from(returnedIds).every((id) => overlay.addedCardIds.includes(id)));
  let returned = overlay.group.cards.filter((card) => returnedIds.includes(card.id));
  let remaining = { ...overlay.group, cards: overlay.group.cards.filter((card) => !returnedIds.includes(card.id)) };
  if (base.type === 'tierce' && remaining.cards.length === 3) remaining.type = 'tierce';
  let result;
  try{result=validatePreservedGroup(base, remaining);}
  catch(error){
    if(payload.cardIds===undefined)throw error;
    // Return only this turn's additions; the committed base is never dismantled.
    returnedIds=overlay.addedCardIds;
    returned=overlay.group.cards.filter(card=>returnedIds.includes(card.id));
    remaining={...base,cards:overlay.group.cards.filter(card=>!returnedIds.includes(card.id))};
    result=validatePreservedGroup(base,remaining);
  }
  remember(game, playerId);
  game.hands[playerId].push(...returned.map(physical));
  const addedCardIds = overlay.addedCardIds.filter((id) => !returnedIds.includes(id));
  if (addedCardIds.length) {
    overlay.group = result;
    overlay.addedCardIds = addedCardIds;
  } else if (game.recoveries.some((record) => record.ownerId === overlay.ownerId && record.groupId === overlay.groupId)) {
    overlay.group = result; overlay.addedCardIds = [];
  } else game.collages = game.collages.filter((item) => item !== overlay);
  game.revision++;
}

/** Exchange a natural card for the exact publicly assigned Joker, without Collage threshold checks. */
export function recoverJoker(game, playerId, payload) {
  validateStagingTurn(game, playerId, payload);
  requireMove(game.opened[playerId] || openingStatus(game, playerId).valid);
  const base = findBaseGroup(game, payload?.ownerId, payload?.groupId);
  requireMove(base);
  const natural = game.hands[playerId].find((card) => card.id === payload?.cardId);
  const current = effectiveGroup(game, payload.ownerId, base);
  const prepared = prepareRecovery(game, payload.ownerId, current, payload?.jokerId, natural);
  const previous = game.collages.find((item) => item.ownerId === payload.ownerId && item.groupId === base.id);
  const overlay = { ownerId: payload.ownerId, groupId: base.id, group: prepared.group, addedCardIds: [...(previous?.addedCardIds ?? [])] };
  const recoveries = [...game.recoveries, prepared.record];
  const hand = [...game.hands[playerId].filter((card) => card.id !== natural.id), physical(prepared.record.joker)];
  const candidate = { ...game, recoveries, collages: [...game.collages.filter((item) => item !== previous), overlay], hands: { ...game.hands, [playerId]: hand } };
  if (!game.opened[playerId]) requireMove(openingStatus(candidate, playerId).valid);
  remember(game, playerId);
  game.recoveries = recoveries; game.collages = candidate.collages; game.hands[playerId] = hand;
  game.revision++;
}

/** A specific replacement can be reversed once its recovered Joker is back in hand. */
export function reverseJokerRecovery(game, playerId, payload) {
  validateStagingTurn(game, playerId, payload);
  const record = game.recoveries.find((item) => item.joker.id === payload?.jokerId
    && item.ownerId === payload?.ownerId && item.groupId === payload?.groupId);
  requireMove(record && game.hands[playerId].some((card) => card.id === record.joker.id));
  const overlay = game.collages.find((item) => item.ownerId === record.ownerId && item.groupId === record.groupId);
  requireMove(overlay);
  const restored = restoreRecoveredJoker(overlay.group, record);
  remember(game, playerId);
  game.hands[playerId] = [...game.hands[playerId].filter((card) => card.id !== record.joker.id), physical(record.natural)];
  game.recoveries = game.recoveries.filter((item) => item !== record);
  if (overlay.addedCardIds.length || game.recoveries.some((item) => item.ownerId === record.ownerId && item.groupId === record.groupId)) overlay.group = restored;
  else game.collages = game.collages.filter((item) => item !== overlay);
  game.revision++;
}
