import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import PlayingCard from './PlayingCard.jsx';
import { cardLabel } from './card-label.js';
import { CARD_DRAG_TYPE, DISCARD_DRAG_TYPE } from './hand-order.js';
import { dropPosition, GROUP_DRAG_TYPE } from './group-proposal.js';
import { freePosition } from './free-layout.js';
import usePointerDrag from './usePointerDrag.jsx';
import { MELD_DRAG_TYPE } from './meld-drag.js';
import { remoteMeldLayout } from './remote-meld-layout.js';

export default function FreeMeldArea({ name, player, game, own, selected, selectedGroup, onGroupSelect, onRetrieve, editable, onCollage, onDropCard, onRecover, onReverse, layoutEditable, onFreeDrop }) {
  const [over,setOver]=useState(false);
  const [crowded,setCrowded]=useState(false);
  const [returnSelection,setReturnSelection]=useState([]);
  const surface=useRef(null);
  const canvasRef=useRef(null);
  const [remoteLayout,setRemoteLayout]=useState(null);
  const remoteView=useRef({roundId:null,populated:false});
  const previousPositions=useRef(null);
  const pointer=usePointerDrag({enabled:!!layoutEditable,scope:game?.roundId});
  const groups=[...(game?.laid[player.id]??[]),...(game?.staged.filter(group=>group.ownerId===player.id)??[])].map(group=>game.collages.find(overlay=>overlay.ownerId===player.id&&overlay.groupId===group.id)?.group??group);
  const stagedIds=new Set(game?.staged.map(group=>group.id));
  const eligible=editable&&game?.collageTargets.includes(player.id);
  const selectedCard=selected.length===1?game?.hand.find(card=>card.id===selected[0]):null;
  const recoverable=editable&&game?.canRecoverJoker;
  const clickCollage=eligible&&selectedCard&&selectedCard.rank!=='Joker';
  useEffect(()=>{
    setReturnSelection(current=>current.filter(id=>groups.some(group=>group.cards.some(card=>card.id===id))));
  },[groups.map(group=>group.cards.map(card=>card.id).join(',')).join('|'),game?.roundId]);
  const dragContext={playerId:game?.viewerId,roundId:game?.roundId,revision:game?.revision,turnRevision:game?.turnRevision};
  function startReturn(event,card){
    event.stopPropagation();
    const ids=returnSelection.includes(card.id)?returnSelection:[card.id];
    const selections=groups.map(group=>({ownerId:player.id,groupId:group.id,cardIds:group.cards.filter(item=>ids.includes(item.id)).map(item=>item.id)})).filter(item=>item.cardIds.length);
    pointer.start(event,{type:MELD_DRAG_TYPE,data:{...dragContext,selections},cards:groups.flatMap(group=>group.cards.filter(item=>ids.includes(item.id)))});
  }
  function placeDrop(event){
    event.preventDefault();event.stopPropagation();setOver(false);setCrowded(false);
    if(!own||!layoutEditable)return;
    try{
      const canvas=event.currentTarget,rect=canvas.getBoundingClientRect();
      const moving=event.dataTransfer.types.includes(GROUP_DRAG_TYPE)?JSON.parse(event.dataTransfer.getData(GROUP_DRAG_TYPE)).groupId:null;
      const elements=[...canvas.querySelectorAll('.laid-group')];
      const source=elements.find(element=>element.dataset.groupId===moving)?.getBoundingClientRect();
      const data=moving?null:JSON.parse(event.dataTransfer.getData(CARD_DRAG_TYPE));
      const count=data?.cardIds?.length??1;
      const size=source?{width:source.width,height:source.height}:{width:Math.min(rect.width,count*33+6),height:72};
      const occupied=elements.filter(element=>element.dataset.groupId!==moving).map(element=>{const box=element.getBoundingClientRect();return{x:box.left-rect.left,y:box.top-rect.top,width:box.width,height:box.height};});
      const position=freePosition(dropPosition(event),size,{width:rect.width,height:rect.height},occupied);
      if(!position){setCrowded(true);return;}
      onFreeDrop(event,position);
    }catch{onFreeDrop(event,dropPosition(event));}
  }
  useLayoutEffect(()=>{
    if(own)return;
    const canvas=canvasRef.current;
    const update=()=>{
      const elements=[...canvas.querySelectorAll('.laid-group')];
      const layout=remoteMeldLayout(elements.map((element,index)=>({
        id:element.dataset.groupId,
        position:game.groupPositions?.[element.dataset.groupId]??{x:(index%3)/2,y:Math.min(1,Math.floor(index/3)/2)},
        width:element.offsetWidth,height:element.offsetHeight,
      })),canvas.clientWidth);
      setRemoteLayout(previous=>JSON.stringify(previous)===JSON.stringify(layout)?previous:layout);
      const firstView=remoteView.current.roundId!==game?.roundId||!remoteView.current.populated;
      remoteView.current={roundId:game?.roundId,populated:elements.length>0};
      if(firstView&&elements.length)canvas.parentElement.scrollTop=Math.min(...Object.values(layout.positions).map(position=>position.top));
    };
    update();
    const observer=new ResizeObserver(update);
    observer.observe(canvas);
    for(const element of canvas.querySelectorAll('.laid-group'))observer.observe(element);
    return ()=>observer.disconnect();
  },[own,game?.groupPositions,groups.map(group=>group.id).join(',')]);
  useEffect(()=>{
    if(!own)return;
    const positions=game?.groupPositions??{};
    const changed=groups.filter(group=>JSON.stringify(previousPositions.current?.[group.id])!==JSON.stringify(positions[group.id]));
    const target=previousPositions.current===null?groups[0]:changed.at(-1);
    previousPositions.current=positions;
    if(target) surface.current?.querySelector(`[data-group-id="${target.id}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});
  },[game?.groupPositions,groups.map(group=>group.id).join(',')]);
  const canvas=<div ref={canvasRef} className="free-meld-canvas" style={!own&&remoteLayout&&groups.length?{minHeight:remoteLayout.height}:undefined}
    onDragOver={event=>{if(own&&layoutEditable&&(event.dataTransfer.types.includes(GROUP_DRAG_TYPE)||editable&&event.dataTransfer.types.includes(CARD_DRAG_TYPE))){event.preventDefault();event.dataTransfer.dropEffect='move';setOver(true);}}}
    onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOver(false);}}
    onDrop={placeDrop}>
    {crowded&&<span className="free-area-warning" role="status">Zone encombrée : déplacez d’abord un groupe.</span>}
    {!groups.length&&<span className="free-meld-hint">{own?'Votre descente · Déposez une combinaison ici':'Aucune combinaison posée'}</span>}
    {groups.map((group,index)=>{
      const staged=stagedIds.has(group.id);
      const overlay=game.collages.find(item=>item.ownerId===player.id&&item.groupId===group.id);
      const ownOverlay=overlay?.actorId===game.viewerId;
      const blocked=game.blockedGroupIds?.includes(group.id);
      const groupEligible=eligible&&!blocked&&(!staged||own);
      const discardEligible=game.canDraw&&game.discardTop?.rank!=='Joker'&&game.discardCollageTargets?.includes(player.id)&&!staged&&!blocked;
      const groupClickCollage=clickCollage&&groupEligible;
      const position=game.groupPositions?.[group.id]??{x:(index%3)/2,y:Math.min(1,Math.floor(index/3)/2)};
      return <div key={group.id} className={`laid-group ${staged?'staged-group':''} ${overlay?'collage-group':''} ${groupEligible||discardEligible?'collage-target':''} ${blocked?'reserved-group':''} ${selectedGroup===group.id?'selected-group':''}`} data-group-id={group.id} data-owner-id={player.id}
        style={!own?{left:`${position.x*100}%`,top:remoteLayout?.positions[group.id]?.top,transform:`translateX(${-position.x*100}%)`}:{left:`${position.x*100}%`,top:`${position.y*100}%`,transform:`translate(${-position.x*100}%,${-position.y*100}%)`}}
        onClick={()=>{if(groupClickCollage)onCollage(player.id,group.id,selected[0]);}}
        onDragOver={event=>{
          const hand=event.dataTransfer.types.includes(CARD_DRAG_TYPE),discard=event.dataTransfer.types.includes(DISCARD_DRAG_TYPE);
          if(!hand&&!discard)return;
          event.stopPropagation();
          if(hand&&groupEligible||discard&&discardEligible){event.preventDefault();event.dataTransfer.dropEffect='move';}
          else event.dataTransfer.dropEffect='none';
        }}
        onDrop={event=>{
          const hand=event.dataTransfer.types.includes(CARD_DRAG_TYPE),discard=event.dataTransfer.types.includes(DISCARD_DRAG_TYPE);
          if(!hand&&!discard)return;
          // A group is a Collage target, never an implicit blank-surface drop.
          event.preventDefault();event.stopPropagation();
          if(hand&&groupEligible||discard&&discardEligible)onDropCard(event,player.id,group.id);
        }}>
        <div className="group-tools">{blocked&&<span className="group-reservation">Pose en cours</span>}
          {own&&<button className="group-move" aria-label="Déplacer cette combinaison" title="Déplacer cette combinaison ; glissez vers votre main pour reprendre une pose de ce tour" disabled={!layoutEditable} draggable={false} data-pointer-drag="group"
            onClick={event=>event.stopPropagation()} onDragStart={event=>event.preventDefault()} onPointerDown={event=>{event.stopPropagation();pointer.start(event,{type:GROUP_DRAG_TYPE,data:{...dragContext,groupId:group.id,ownerId:player.id,cardIds:own&&staged?group.cards.map(card=>card.id):ownOverlay?overlay.addedCardIds:[]},cards:group.cards});}}>⠿</button>}
          {(own&&staged||ownOverlay&&overlay?.addedCardIds.length>0)&&<button className="group-select" disabled={!editable} aria-label={staged?'Sélectionner ce groupe provisoire':'Sélectionner les ajouts de ce tour'} aria-pressed={selectedGroup===group.id} onClick={event=>{event.stopPropagation();onGroupSelect(selectedGroup===group.id?null:group.id);}}>{staged?'Sélectionner':'Ajouts'}</button>}
          {groupClickCollage&&<button className="coller-button" onClick={event=>{event.stopPropagation();onCollage(player.id,group.id,selected[0]);}}>Coller ici</button>}
        </div>
        <div className="laid-cards">{group.cards.map(card=>{
          const added=overlay?.addedCardIds.includes(card.id);
          const sourceRecovery=game.recoveries.some(item=>item.ownerId===player.id&&item.groupId===group.id);
          const replacement=game.recoveries.some(item=>item.replacementCardId===card.id);
          const retrievable=editable&&!blocked&&(own&&staged&&!sourceRecovery||ownOverlay&&added);
          const jokerTarget=recoverable&&!blocked&&(!staged||own)&&card.rank==='Joker';
          const clickRecover=jokerTarget&&selectedCard&&selectedCard.rank!=='Joker';
          return <button className={`laid-card ${staged||added||replacement?'newly-laid-card':''} ${jokerTarget?'joker-target':''} ${returnSelection.includes(card.id)?'return-selected-card':''}`} key={card.id} data-card-id={card.id} data-pointer-drag={retrievable?'meld':undefined} aria-pressed={retrievable?returnSelection.includes(card.id):undefined} draggable={false}
            onDragStart={event=>event.preventDefault()} onPointerDown={event=>{if(retrievable)startReturn(event,card);}} disabled={!groupClickCollage&&!retrievable&&!jokerTarget}
            title={jokerTarget?'Remplacer ce Joker par sa carte naturelle exacte':retrievable?'Sélectionnez une ou plusieurs cartes puis glissez vers votre main. Si le reste est invalide, le groupe entier revient en main.':'Carte engagée'}
            onDragOver={event=>{if(jokerTarget&&event.dataTransfer.types.includes(CARD_DRAG_TYPE)){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';}}}
            onDrop={event=>{if(jokerTarget&&event.dataTransfer.types.includes(CARD_DRAG_TYPE)){event.preventDefault();event.stopPropagation();onDropCard(event,player.id,group.id,card.id);}}}
            onClick={event=>{event.stopPropagation();if(clickRecover)onRecover(player.id,group.id,card.id,selected[0]);else if(groupClickCollage)onCollage(player.id,group.id,selected[0]);else if(retrievable)setReturnSelection(current=>current.includes(card.id)?current.filter(id=>id!==card.id):[...current,card.id]);}}><PlayingCard {...card}/>{card.substitution&&<small>{cardLabel(card.substitution.rank)} {({hearts:'♥',diamonds:'♦',clubs:'♣',spades:'♠'})[card.substitution.suit]}</small>}</button>;
        })}</div>
        {game.recoveries.filter(item=>item.actorId===game.viewerId&&item.ownerId===player.id&&item.groupId===group.id).map(item=><button key={item.jokerId} className="joker-reverse" disabled={!editable||!game.reversibleRecoveryIds.includes(item.jokerId)} onClick={event=>{event.stopPropagation();onReverse(item);}}>Rétablir le Joker</button>)}
      </div>;
    })}
    </div>;
  return <div ref={surface} className={`meld-areas free-meld-area ${own?'own-meld-area':`remote-meld-area ${!groups.length?'remote-meld-empty':''}`} ${over?'free-drop-over':''}`} aria-label={`Zone de descente de ${name}`} data-layout-owner={player.id}>
    {!own&&<h3 className="remote-meld-title">Descente de {name}</h3>}
    {own?canvas:<div className="remote-meld-scroll" tabIndex={0} role="region" aria-label={`Combinaisons de ${name}`}>{canvas}</div>}
    {pointer.preview}
  </div>;
}
