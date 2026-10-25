const fields = ['staged','collages','recoveries','turnUndo','turnBaseHand','discardTakenCardId'];
export const emptyTurn = (hand = [], taken = null) => ({ staged:[],collages:[],recoveries:[],turnUndo:[],turnBaseHand:hand.map(({id,rank,suit})=>({id,rank,suit})),discardTakenCardId:taken });
export function currentTurn(game) { return Object.fromEntries(fields.map(key=>[key,game[key]])); }
export function allTurns(game) {
  return { ...game.turns, ...(game.contextPlayerId && game.mustDiscard[game.contextPlayerId] ? { [game.contextPlayerId]: currentTurn(game) } : {}) };
}
export function playerContext(game, playerId) {
  const context=allTurns(game)[playerId]??emptyTurn(game.hands[playerId]);
  return {...game,...context,activePlayerId:playerId,contextPlayerId:playerId,phase:'discard'};
}
export function saveContext(game, playerId) {
  game.turns ??= {};
  game.turns[playerId]=currentTurn(game);
  game.contextPlayerId=playerId;
}
export function syncDrawPhase(game) {
  if(game.roundResult) { game.phase='round-ended';return; }
  game.phase=game.mustDiscard[game.activePlayerId]?'discard':'draw';
}
export const ownRevision=(game,playerId)=>game.playerRevisions?.[playerId]??0;
export function advanceOwnRevision(game,playerId) {
  game.playerRevisions??={};game.playerRevisions[playerId]=ownRevision(game,playerId)+1;
}
/** Execute against a detached personal context, then publish one atomic revision. */
export function actOnTurn(game,playerId,payload,operation) {
  if(!game || game.phase==='round-ended' || game.initialDiscard || !Object.hasOwn(game.hands,playerId) || !game.mustDiscard[playerId] || payload?.revision!==game.revision) throw Error('Coup invalide');
  const candidate=structuredClone(game);
  candidate.turns=structuredClone(allTurns(game));
  const cursor=game.activePlayerId;
  Object.assign(candidate,playerContext(candidate,playerId));
  if(payload?.groupId){
    for(const [owner,turn]of Object.entries(candidate.turns)){
      if(owner!==playerId&&turn.collages.some(overlay=>overlay.groupId===payload.groupId))throw Error('Coup invalide');
    }
  }
  operation(candidate,playerId,payload);
  advanceOwnRevision(candidate,playerId);
  saveContext(candidate,playerId);
  candidate.activePlayerId=cursor;
  syncDrawPhase(candidate);
  Object.assign(game,candidate);
}
