import React, { useEffect, useRef, useState } from 'react';
import PlayingCard from './PlayingCard.jsx';
import usePointerDrag from './usePointerDrag.jsx';
import { handInsertion } from './pointer-drag.js';
import { automaticOrder, CARD_DRAG_TYPE, DISCARD_DRAG_TYPE, moveCards, orderedHand, readOrder, reconcileOrder, replaceVisibleOrder, validHandDrag, validDiscardDrag } from './hand-order.js';

export default function PrivateHand({ game, playerId, selected, onSelect, locked, onDiscardDrop }) {
  const key = `rami71.hand:${playerId}:${game.roundId}`;
  const [order, setOrder] = useState(() => { try { return readOrder(window.localStorage, key); } catch { return []; } });
  const [insertion, setInsertion] = useState(undefined);
  const source = useRef(null);
  const pointer=usePointerDrag({enabled:!locked,onFinish:()=>{source.current=null;setInsertion(undefined);}});
  const hand = orderedHand(order, game.hand);
  useEffect(() => {
    const next = reconcileOrder(order, game.hand);
    try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* Ordering still works in memory. */ }
    if (next.length !== order.length) setOrder(next);
  }, [order, game.hand, key]);
  useEffect(() => { if(locked || source.current && !game.hand.some(card=>card.id===source.current)){ source.current = null; setInsertion(undefined); } }, [game.hand, locked]);
  function position(event) {
    return handInsertion([...event.currentTarget.querySelectorAll('.hand-card-button')].map(button=>({id:button.dataset.cardId,left:button.getBoundingClientRect().left,right:button.getBoundingClientRect().right})),event.clientX);
  }
  return <>
    <div className={`own-hand ${insertion === null ? 'insert-at-end' : ''}`} style={{'--hand-gaps':Math.max(1,hand.length-1)}} aria-label="Votre main privée"
      onDragOver={(event) => {
        if (locked || !(source.current && event.dataTransfer.types.includes(CARD_DRAG_TYPE) || game.canDraw && event.dataTransfer.types.includes(DISCARD_DRAG_TYPE))) return;
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setInsertion(position(event));
      }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInsertion(undefined); }}
      onDrop={(event) => {
        event.preventDefault(); event.stopPropagation(); setInsertion(undefined);
        try {
          if(event.dataTransfer.types.includes(DISCARD_DRAG_TYPE)) {
            const data=JSON.parse(event.dataTransfer.getData(DISCARD_DRAG_TYPE));
            if(!locked&&validDiscardDrag(data,game,playerId)){
              const before=position(event);
              setOrder(current=>moveCards(current,[...game.hand,game.discardTop],[data.cardId],before));
              onDiscardDrop(data);
            }
            return;
          }
          const data = JSON.parse(event.dataTransfer.getData(CARD_DRAG_TYPE));
          const before = position(event);
          if (!locked && validHandDrag(data, source.current, game, playerId, {privateOrder:true})) setOrder((current) => moveCards(current, game.hand, data.cardIds ?? [data.cardId], before));
        } catch { /* Foreign drags do not change the hand or send a game action. */ }
        source.current = null;
      }}>
      {hand.map((card) => <button className={`hand-card-button ${insertion === card.id ? 'insert-before' : ''}`} data-card-id={card.id} data-pointer-drag="hand" disabled={locked} key={card.id} aria-pressed={selected.includes(card.id)} draggable={false}
        onDragStart={event=>event.preventDefault()}
        onPointerDown={event=>{source.current=card.id;const cards=selected.includes(card.id)?hand.filter(item=>selected.includes(item.id)):[card];pointer.start(event,{type:CARD_DRAG_TYPE,data:{cardId:card.id,cardIds:cards.map(item=>item.id),playerId,revision:game.revision,turnRevision:game.turnRevision,roundId:game.roundId},cards});}}
        onClick={() => onSelect(selected.includes(card.id) ? selected.filter((id) => id !== card.id) : [...selected, card.id])}>
        <PlayingCard {...card} />{game.recoveredJokerIds.includes(card.id) && <small className="recovered-joker-badge">À rejouer</small>}
      </button>)}
    </div>
    {pointer.preview}
    <div className="hand-order-tools"><button disabled={locked} onClick={() => setOrder((current) => replaceVisibleOrder(current, game.hand, automaticOrder(game.hand)))}>Tri automatique</button><span>Glissez vos cartes pour les ranger · Ordre privé</span></div>
  </>;
}
