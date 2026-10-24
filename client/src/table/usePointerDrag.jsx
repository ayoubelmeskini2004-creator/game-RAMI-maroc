import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PlayingCard from './PlayingCard.jsx';
import { pastDragThreshold } from './pointer-drag.js';

// Pointer capture owns the gesture; HTML dragstart and the OS drag image are
// deliberately unused. Existing drop handlers remain the single action router.
export default function usePointerDrag({ enabled=true, scope, onFinish }={}) {
  const gesture=useRef(null), latest=useRef(null), suppressClick=useRef(null);
  const [preview,setPreview]=useState(null);
  latest.current={enabled,onFinish};
  const finishRef=useRef(null);
  useEffect(()=>{
    function send(type,target,event,g) {
      if(!target)return false;
      const drag=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:g.transfer,clientX:event.clientX,clientY:event.clientY});
      target.dispatchEvent(drag);
      return drag.defaultPrevented;
    }
    function hover(event,g) {
      const target=document.elementFromPoint(event.clientX,event.clientY);
      if(target!==g.target){send('dragleave',g.target,event,g);send('dragenter',target,event,g);g.target=target;}
      g.accepted=send('dragover',target,event,g);
    }
    function finish(event,commit=false) {
      const g=gesture.current;if(!g)return;
      gesture.current=null;
      if(g.active){
        suppressClick.current=g.element;
        if(commit){hover(event,g);if(g.accepted)send('drop',g.target,event,g);}
        send('dragleave',g.target,event,g);
      }
      if(g.element.hasPointerCapture(g.pointerId))g.element.releasePointerCapture(g.pointerId);
      document.body.classList.remove('rami-pointer-dragging');
      setPreview(null);latest.current.onFinish?.();
      setTimeout(()=>{suppressClick.current=null;},0);
    }
    finishRef.current=()=>finish({clientX:0,clientY:0});
    function move(event){
      const g=gesture.current;if(!g||event.pointerId!==g.pointerId)return;
      if(!latest.current.enabled||event.buttons!==1){finish(event);return;}
      if(!g.active&&!pastDragThreshold(g.start,{x:event.clientX,y:event.clientY}))return;
      g.active=true;event.preventDefault();
      document.body.classList.add('rami-pointer-dragging');
      setPreview({x:event.clientX,y:event.clientY,cards:g.cards});
      hover(event,g);
    }
    const up=event=>{if(event.pointerId===gesture.current?.pointerId)finish(event,true);};
    const cancel=event=>{if(event.pointerId===gesture.current?.pointerId)finish(event);};
    const escape=event=>{if(event.key==='Escape')finish({clientX:0,clientY:0});};
    const blur=()=>finish({clientX:0,clientY:0});
    const click=event=>{if(suppressClick.current?.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();suppressClick.current=null;}};
    window.addEventListener('pointermove',move,{passive:false});
    window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('lostpointercapture',cancel);
    window.addEventListener('blur',blur);window.addEventListener('keydown',escape);
    document.addEventListener('click',click,true);
    return ()=>{
      finish({clientX:0,clientY:0});finishRef.current=null;
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('lostpointercapture',cancel);
      window.removeEventListener('blur',blur);window.removeEventListener('keydown',escape);document.removeEventListener('click',click,true);
    };
  },[]);
  useEffect(()=>{if(!enabled)finishRef.current?.();},[enabled]);
  useEffect(()=>{finishRef.current?.();},[scope]);
  function start(event,{type,data,cards}) {
    if(!latest.current.enabled||event.button!==0||event.isPrimary===false||gesture.current)return;
    suppressClick.current=null;
    const transfer=new DataTransfer();transfer.setData(type,JSON.stringify(data));transfer.effectAllowed='move';
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current={pointerId:event.pointerId,element:event.currentTarget,start:{x:event.clientX,y:event.clientY},cards,transfer,active:false,target:null};
  }
  return {start,preview:preview&&createPortal(<div className="pointer-card-preview" aria-hidden="true" data-card-count={preview.cards.length} style={{left:preview.x+12,top:preview.y+12}}>
    <div>{preview.cards.map(card=><PlayingCard key={card.id} {...card}/>)}</div>
    <span>{preview.cards.length===1?'1 carte':`${preview.cards.length} cartes`}</span>
  </div>,document.body)};
}
