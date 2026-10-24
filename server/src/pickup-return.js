import { allTurns, emptyTurn, advanceOwnRevision, syncDrawPhase } from './turns.js';
import { moveError } from './move-error.js';
export function pickupReturnReason(game,playerId) {
  const checkpoint=game.pickupReturns?.[playerId];
  if(!checkpoint)return 'Vous n’avez aucune prise de Défausse à annuler.';
  if(game.phase==='round-ended')return 'La manche est terminée ; cette prise ne peut plus être annulée.';
  if((game.irreversibleRevision??0)!==checkpoint.afterIrreversible)return 'Une action de jeu irréversible a eu lieu depuis cette prise. Le retour exact à la Défausse n’est plus possible.';
  if(checkpoint.used)return 'La carte a déjà été utilisée ; sa prise ne peut plus être annulée, même après Annuler.';
  const turn=allTurns(game)[playerId];
  if(!game.mustDiscard[playerId]||!turn||turn.staged.length||turn.collages.length||turn.recoveries.length||turn.turnUndo.length)return 'La carte a déjà été utilisée ou votre préparation a changé ; la prise ne peut plus être annulée.';
  if(!game.hands[playerId].some(card=>card.id===checkpoint.cardId))return 'La carte physique prise n’est plus dans votre main.';
  if(game.discard.map(card=>card.id).join(',')!==checkpoint.discardIds.join(','))return 'La Défausse a changé ; la carte ne peut plus être remise à sa place.';
  return null;
}
export function cancelPickup(game,playerId,payload) {
  if(!game||!Object.hasOwn(game.hands,playerId))throw moveError('Votre identité de joueur n’est pas reconnue. Reconnectez-vous.');
  const reason=pickupReturnReason(game,playerId);if(reason)throw moveError(reason);
  const checkpoint=game.pickupReturns[playerId];
  if(payload?.cardId!==undefined&&payload.cardId!==checkpoint.cardId)throw moveError('Remettez exactement la carte physique prise à la Défausse.');
  if(payload?.revision!==game.revision)throw moveError('La table a changé. Vérifiez à nouveau si l’annulation de prise est disponible.');
  const candidate=structuredClone(game);candidate.turns=structuredClone(allTurns(game));
  const index=candidate.hands[playerId].findIndex(card=>card.id===checkpoint.cardId);
  candidate.discard.push(candidate.hands[playerId].splice(index,1)[0]);
  candidate.mustDiscard[playerId]=false;delete candidate.turns[playerId];delete candidate.pickupReturns[playerId];
  Object.assign(candidate,emptyTurn());candidate.contextPlayerId=null;
  candidate.activePlayerId=playerId;candidate.revision++;
  candidate.irreversibleRevision=(game.irreversibleRevision??0)+1;
  advanceOwnRevision(candidate,playerId);syncDrawPhase(candidate);
  Object.assign(game,candidate);
}
