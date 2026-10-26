import { randomInt, randomUUID } from 'node:crypto';
import { startTurnStaging, validateStagedCommit, openingStatus, openingMinimumTotal, stageCollage, stageGroups } from './descente.js';
import { committedMelds, canCollageOn, jokerOpeningReady } from './collage.js';
import { recoveryPendingIds } from './joker-state.js';
import { teamOpeningDonor } from './team-opening.js';
import { roundResult } from './scoring.js';
import { allTurns, playerContext, saveContext, emptyTurn, syncDrawPhase, actOnTurn, ownRevision, advanceOwnRevision } from './turns.js';
import { pickupReturnReason } from './pickup-return.js';
import { moveError } from './move-error.js';

export const INVALID_MOVE = 'Coup invalide';
const requireMove = (condition) => { if (!condition) throw new Error(INVALID_MOVE); };

export function buildDeck() {
  const cards = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of ['hearts', 'diamonds', 'clubs', 'spades']) {
      for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R']) {
        cards.push({ id: randomUUID(), rank, suit });
      }
    }
  }
  for (let i = 0; i < 4; i++) cards.push({ id: randomUUID(), rank: 'Joker', suit: null });
  return cards;
}

export function secureShuffle(cards) {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Clockwise from the bottom of the rendered table: bottom, left, top, right.
export function seatingOrder(players, mode) {
  if (mode === 'teams') {
    const a = players.filter((p) => p.team === 'A');
    const b = players.filter((p) => p.team === 'B');
    requireMove(a.length === 2 && b.length === 2);
    return [a[0].id, b[0].id, a[1].id, b[1].id];
  }
  return players.map((p) => p.id);
}

// Later rounds rotate clockwise. Only the server lifecycle may create another deal.
export function createRound(order, previous = null) {
  requireMove(order.length >= 2 && order.length <= 4 && new Set(order).size === order.length);
  if (previous) requireMove(order.length === previous.order.length && order.every((id, i) => id === previous.order[i]));
  const starterIndex = previous ? (order.indexOf(previous.starterId) + 1) % order.length : randomInt(order.length);
  const stock = secureShuffle(buildDeck());
  const hands = Object.fromEntries(order.map((id) => [id, []]));
  for (let n = 0; n < 14; n++) {
    for (let offset = 0; offset < order.length; offset++) hands[order[(starterIndex + offset) % order.length]].push(stock.pop());
  }
  const starterId = order[starterIndex];
  hands[starterId].push(stock.pop());
  return { round: (previous?.round ?? 0) + 1, roundId: randomUUID(), revision: 0, order: [...order], starterId,
    activePlayerId: starterId, phase: 'discard', initialDiscard: true, turns: {}, contextPlayerId: starterId, playerRevisions: {}, pickupReturns: {}, irreversibleRevision:0,
    mustDiscard: Object.fromEntries(order.map((id) => [id, id === starterId])), groupPositions: {}, layoutRevision: 0,
    stock, discard: [], hands, opened: Object.fromEntries(order.map((id) => [id, false])),
    laid: Object.fromEntries(order.map((id) => [id, []])), staged: [], turnUndo: [],
    turnBaseHand: [], discardTakenCardId: null, firstOpening: null, openingTotals: {}, collages: [],
    mode: 'individual', teams: {}, openingInheritedFrom: {}, recoveries: [], roundResult: null };
}

function validateTurn(game, playerId, revision, phase) {
  requireMove(game && Object.hasOwn(game.hands, playerId) && game.activePlayerId === playerId
    && game.revision === revision && game.phase === phase);
}

export function drawCard(game, playerId, payload) {
  // Reserve both piles until the pickup is committed or returned; reversible poses do not release it.
  if (game && Object.keys(game.pickupReturns ?? {}).length) throw moveError('La prise de Défausse doit être utilisée et validée, ou annulée, avant une nouvelle pioche.');
  validateTurn(game,playerId,payload?.revision,'draw');
  requireMove(!game.initialDiscard && !game.mustDiscard[playerId] && ['stock','discard'].includes(payload?.source));
  requireMove(game.returnStockPlayerId !== playerId || payload.source === 'stock');
  const candidate=structuredClone(game);
  candidate.returnStockPlayerId = null;
  candidate.turns=structuredClone(allTurns(game));
  let taken=null;
  if(payload.source==='discard') {
    requireMove(candidate.discard.length>0);
    taken=candidate.discard.at(-1).id;
    requireMove(payload.cardId===undefined || payload.cardId===taken);
    candidate.hands[playerId].push(candidate.discard.pop());
  } else {
    if(!candidate.stock.length) {
      requireMove(candidate.discard.length>1);
      const top=candidate.discard.at(-1);candidate.stock=secureShuffle(candidate.discard.slice(0,-1));candidate.discard=[top];
    }
    candidate.hands[playerId].push(candidate.stock.pop());
  }
  startTurnStaging(candidate,playerId,taken);
  candidate.activePlayerId=playerId;candidate.phase='discard';
  if(payload.openingGroups) stageGroups(candidate,playerId,{groups:payload.openingGroups,revision:candidate.revision});
  saveContext(candidate,playerId);
  if(payload.target) {
    requireMove(payload.source==='discard' && candidate.opened[playerId]);
    actOnTurn(candidate,playerId,{...payload.target,cardIds:[taken],revision:candidate.revision},stageCollage);
  }
  candidate.activePlayerId=game.order[(game.order.indexOf(playerId)+1)%game.order.length];
  candidate.revision=game.revision+1;
  candidate.irreversibleRevision=(game.irreversibleRevision??0)+1;
  advanceOwnRevision(candidate,playerId);
  candidate.pickupReturns??={};delete candidate.pickupReturns[playerId];
  if(taken)candidate.pickupReturns[playerId]={cardId:taken,afterIrreversible:candidate.irreversibleRevision,discardIds:candidate.discard.map(card=>card.id)};
  syncDrawPhase(candidate);
  Object.assign(game,candidate);
}

function commitStaging(game, playerId) {
  const opening = validateStagedCommit(game, playerId);
  game.laid = committedMelds(game, playerId);
  if (opening) {
    game.opened[playerId] = true;
    game.openingTotals[playerId] = opening.totalLaidPoints;
    if (opening.kind === 'team') game.openingInheritedFrom[playerId] = opening.inheritedFrom;
    if (game.firstOpening === null) game.firstOpening = { playerId, total: opening.totalLaidPoints };
  }
  return opening;
}

export function discardCard(game, playerId, payload) {
  if(!game||!Object.hasOwn(game.hands,playerId))throw moveError('Votre identité de joueur n’est pas reconnue. Reconnectez-vous.');
  if(game.phase==='round-ended')throw moveError('La manche est terminée ; vous ne pouvez plus défausser.');
  if(!game.mustDiscard[playerId])throw moveError('Vous devez d’abord piocher : vous n’avez pas de défausse en attente.');
  const fresh=payload?.turnRevision===undefined?payload?.revision===game.revision:Number.isSafeInteger(payload?.revision)&&payload.revision>=0&&payload.revision<=game.revision&&payload.turnRevision===ownRevision(game,playerId);
  if(!fresh)throw moveError('Votre main ou vos poses ont changé. Vérifiez votre sélection avant de défausser.');
  if(game.initialDiscard&&playerId!==game.starterId)throw moveError('Seul le joueur ayant reçu 15 cartes effectue la première défausse.');
  if (Object.keys(game.pickupReturns ?? {}).some(id => id !== playerId)) throw moveError('Attendez la décision du joueur ayant pris la Défausse avant de défausser.');
  const cursor=game.activePlayerId,initial=game.initialDiscard;
  const candidate=structuredClone(game);candidate.turns=structuredClone(allTurns(game));
  Object.assign(candidate,playerContext(candidate,playerId));
  const index=candidate.hands[playerId].findIndex(card=>card.id===payload?.cardId);
  if(index<0)throw moveError('La carte sélectionnée n’est plus dans votre main.');
  if(candidate.recoveries.some(record=>record.joker.id===payload.cardId))throw moveError('Ce Joker a été récupéré : rejouez-le dans une combinaison valide avant de défausser.');
  if(recoveryPendingIds(candidate,[...candidate.staged.map(group=>candidate.collages.find(overlay=>overlay.ownerId===playerId&&overlay.groupId===group.id)?.group??group),...candidate.collages.map(overlay=>overlay.group)]).length)throw moveError('Rejouez tous les Jokers récupérés dans des combinaisons valides avant de défausser.');
  if(!candidate.opened[playerId]&&(candidate.staged.length||candidate.discardTakenCardId!==null)){
    const status=openingStatus(candidate,playerId);
    if(!status.valid)throw moveError(status.kind==='team'?'Ouverture d’équipe incomplète : posez au moins une Suite valide avant de défausser.':`Ouverture incomplète : une Suite pure, une Tierce pure, 71 points naturels et ${status.minimumTotal} points posés sont requis. La carte prise ne peut pas servir dans les groupes purs obligatoires.`);
  }
  if (candidate.discardTakenCardId !== null) {
    const taken = candidate.discardTakenCardId;
    const used = candidate.staged.some(group => group.cards.some(card => card.id === taken))
      || candidate.collages.some(overlay => overlay.addedCardIds.includes(taken) && overlay.group.cards.some(card => card.id === taken));
    if (!used || candidate.hands[playerId].some(card => card.id === taken)) throw moveError('Utilisez la carte prise dans une Descente ou un Collage légal, ou annulez la prise puis piochez dans la Pioche.');
  }
  let opening;
  try{opening=validateStagedCommit(candidate,playerId);}catch{throw moveError('Vos poses ou Collages ne sont plus valides. Corrigez-les ou annulez-les avant de défausser.');}
  requireMove(candidate.hands[playerId].length>1 || candidate.opened[playerId] || opening?.valid);
  const wasOpened=candidate.opened[playerId];
  commitStaging(candidate,playerId);
  candidate.discard.push(candidate.hands[playerId].splice(index,1)[0]);
  candidate.mustDiscard[playerId]=false;delete candidate.turns[playerId];
  if(!candidate.hands[playerId].length) {
    // Uncommitted opponents' cards still count in their hands for round penalties.
    for(const [other,turn]of Object.entries(candidate.turns))candidate.hands[other]=structuredClone(turn.turnBaseHand);
    candidate.turns={};candidate.roundResult=roundResult(candidate,playerId,wasOpened);
  }
  Object.assign(candidate,emptyTurn());candidate.contextPlayerId=null;
  candidate.activePlayerId=initial?game.order[(game.order.indexOf(playerId)+1)%game.order.length]:cursor;
  candidate.initialDiscard=false;candidate.revision=game.revision+1;
  candidate.irreversibleRevision=(game.irreversibleRevision??0)+1;
  advanceOwnRevision(candidate,playerId);delete candidate.pickupReturns?.[playerId];
  syncDrawPhase(candidate);Object.assign(game,candidate);
}

export function publicGame(game) {
  if (!game) return null;
  const turns=allTurns(game);
  const staged=Object.entries(turns).flatMap(([ownerId,turn])=>turn.staged.map(group=>({...structuredClone(group),ownerId})));
  const collages=Object.entries(turns).flatMap(([actorId,turn])=>turn.collages.map(overlay=>({...structuredClone(overlay),actorId})));
  const recoveries=Object.entries(turns).flatMap(([actorId,turn])=>turn.recoveries.map(record=>({actorId,ownerId:record.ownerId,groupId:record.groupId,jokerId:record.joker.id,replacementCardId:record.natural.id})));
  return { round: game.round, roundId: game.roundId, revision: game.revision, order: [...game.order], starterId: game.starterId,
    activePlayerId: game.activePlayerId, phase: game.phase, initialDiscard: game.initialDiscard,
    pickupDecisionPlayerId: Object.keys(game.pickupReturns ?? {})[0] ?? null,
    mustDiscard: { ...game.mustDiscard }, groupPositions: structuredClone(game.groupPositions ?? {}), layoutRevision: game.layoutRevision ?? 0,
    stockCount: game.stock.length, discardCount: game.discard.length,
    discardTop: game.discard.at(-1) ? { ...game.discard.at(-1) } : null,
    counts: Object.fromEntries(game.order.map((id) => [id, game.hands[id].length])),
    opened: { ...game.opened }, laid: structuredClone(game.laid), staged, collages,
    recoveries,
    firstOpening: game.firstOpening ? { ...game.firstOpening } : null,
    roundResult: game.roundResult ? structuredClone(game.roundResult) : null,
    openingTotals: { ...game.openingTotals }, openingInheritedFrom: { ...game.openingInheritedFrom }, minimumOpeningTotal: openingMinimumTotal(game) };
}

export function privateGame(game, playerId) {
  requireMove(game && Object.hasOwn(game.hands,playerId));
  const context=playerContext(game,playerId), owes=!!game.mustDiscard[playerId];
  const pending=owes&&!game.opened[playerId]&&context.staged.length?openingStatus(context,playerId):null;
  const blockedGroupIds=Object.entries(allTurns(game)).filter(([id])=>id!==playerId).flatMap(([,turn])=>turn.collages.map(overlay=>overlay.groupId));
  const returnReason=pickupReturnReason(game,playerId);
  return {...publicGame(game),viewerId:playerId,turnRevision:ownRevision(game,playerId),hand:game.hands[playerId].map(card=>({...card})),
    canDraw:game.phase!=='round-ended'&&!game.initialDiscard&&game.activePlayerId===playerId&&!owes&&!Object.keys(game.pickupReturns??{}).length,
    canDiscard:game.phase!=='round-ended'&&owes&&!Object.keys(game.pickupReturns??{}).some(id=>id!==playerId)
      &&(context.discardTakenCardId===null||!game.hands[playerId].some(card=>card.id===context.discardTakenCardId)),
    canTakeDiscard:game.returnStockPlayerId!==playerId,
    canStage:game.phase!=='round-ended'&&!game.initialDiscard&&owes,
    teamOpeningEligible:teamOpeningDonor(game,playerId)!==null,
    canUndo:owes&&context.turnUndo.length>0,canCancelDiscard:returnReason===null,cancelPickupCardId:game.pickupReturns?.[playerId]?.cardId??null,cancelPickupReason:returnReason,blockedGroupIds,
    jokerCollageTargets:game.order.filter(id=>canCollageOn(context,playerId,id,pending)||id===playerId&&jokerOpeningReady(pending)),
    collageTargets:game.order.filter(id=>canCollageOn(context,playerId,id,pending)),
    discardCollageTargets:game.opened[playerId]?game.order.filter(id=>canCollageOn(context,playerId,id)):[],
    canRecoverJoker:Boolean(game.opened[playerId]||pending?.valid),
    recoveredJokerIds:owes?context.recoveries.map(record=>record.joker.id):[],
    pendingRecoveredJokerIds:owes?recoveryPendingIds(context,[...context.staged.map(group=>context.collages.find(overlay=>overlay.ownerId===playerId&&overlay.groupId===group.id)?.group??group),...context.collages.map(overlay=>overlay.group)]):[],
    reversibleRecoveryIds:owes?context.recoveries.filter(record=>game.hands[playerId].some(card=>card.id===record.joker.id)).map(record=>record.joker.id):[],
    openingStatus:pending};
}
