import { validHandDrag } from './hand-order.js';

// The exact pickup is always a return request, even when return is now forbidden.
// Every other card is a normal discard, never a way to clear a pickup condition.
export function discardDrop(data, game, playerId) {
  if (!validHandDrag(data, data?.cardId, game, playerId, { privateOrder:true }) || (data.cardIds?.length ?? 1)!==1)
    return { error:'Déposez une seule carte de votre main dans la Défausse.' };
  if(data.cardId===game.cancelPickupCardId){
    if(!game.canCancelDiscard)return {error:game.cancelPickupReason??'Cette prise ne peut plus être annulée.'};
    return {event:'game:cancel-discard',cardId:data.cardId};
  }
  if(!game.canDiscard)return {error:'Vous devez d’abord piocher : vous n’avez pas de défausse en attente.'};
  if(game.recoveredJokerIds.includes(data.cardId))return {error:'Ce Joker récupéré doit être rejoué dans une combinaison avant de défausser.'};
  return {event:'game:discard',cardId:data.cardId};
}
