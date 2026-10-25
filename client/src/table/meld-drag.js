import { GROUP_DRAG_TYPE } from './group-proposal.js';
export const MELD_DRAG_TYPE='application/x-rami-meld-cards';
export function meldRetrieval(data,game,playerId,type=MELD_DRAG_TYPE){
  const current=data?.revision===game.revision||Number.isSafeInteger(data?.turnRevision)&&data.turnRevision===game.turnRevision&&Number.isSafeInteger(data.revision)&&data.revision>=0&&data.revision<=game.revision;
  if(!data||!game.canStage||data.playerId!==playerId||data.roundId!==game.roundId||!current)return null;
  const selections=type===GROUP_DRAG_TYPE?[{ownerId:data.ownerId,groupId:data.groupId,cardIds:data.cardIds}]:data.selections;
  if(!Array.isArray(selections)||!selections.length||selections.length>36)return null;
  const seen=new Set();
  for(const selection of selections){
    if(!selection||!Array.isArray(selection.cardIds)||!selection.cardIds.length)return null;
    const {ownerId,groupId,cardIds}=selection;
    const staged=game.staged.find(group=>group.id===groupId&&group.ownerId===ownerId);
    const overlay=game.collages.find(item=>item.ownerId===ownerId&&item.groupId===groupId);
    const ownOverlay=overlay?.actorId===playerId;
    const base=staged??game.laid[ownerId]?.find(group=>group.id===groupId);
    const group=overlay?.group??base;
    if(!group||game.blockedGroupIds?.includes(groupId)||game.recoveries.some(item=>item.ownerId===ownerId&&item.groupId===groupId)&&staged)return null;
    if(cardIds.some(id=>seen.has(id)||!group.cards.some(card=>card.id===id)||!(staged&&ownerId===playerId||ownOverlay&&overlay.addedCardIds.includes(id))))return null;
    for(const id of cardIds){if(seen.has(id))return null;seen.add(id);}
  }
  return selections;
}
