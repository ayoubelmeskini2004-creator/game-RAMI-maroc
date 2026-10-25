import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir,writeFile } from 'node:fs/promises';
import { createApp } from '../server/src/app.js';
import { createRound,buildDeck,privateGame } from '../server/src/game.js';
import { physicalCards } from '../server/test-support/match-scenarios.js';
import { browser,until } from './browser-support.mjs';

const faces=(ranks,suits)=>ranks.map((rank,i)=>({rank,suit:rank==='Joker'?null:Array.isArray(suits)?suits[i]:suits}));
const cases=[
 {name:'suite-six-coeur',type:'suite',faces:faces(['4','5','6','7','8','9'],'hearts'),top:0,partial:2},
 {name:'suite-as-haut-carreau',type:'suite',faces:faces(['10','V','D','R','A'],'diamonds'),top:4,partial:2},
 {name:'tierce-deux',type:'tierce',faces:faces(['2','2','2'],['hearts','diamonds','clubs']),top:2},
 {name:'carre-rois',type:'carre',faces:faces(['R','R','R','R'],['hearts','diamonds','clubs','spades']),top:3,partial:1},
 {name:'suite-joker-pique',type:'suite',faces:faces(['A','2','Joker'],'spades'),top:2,joker:{rank:'3',suit:'spades'}},
 {name:'suite-trefle',type:'suite',faces:faces(['8','9','10'],'clubs'),top:0},
 {name:'tierce-valets-joker',type:'tierce',faces:faces(['V','V','Joker'],['hearts','diamonds',null]),top:0,joker:{rank:'V',suit:'clubs'}},
 {name:'carre-dames-joker',type:'carre',faces:faces(['D','D','D','Joker'],['hearts','clubs','spades',null]),top:3,joker:{rank:'D',suit:'diamonds'}},
];
const output=new URL('../.audit-artifacts/retrieve-return/',import.meta.url);await mkdir(output,{recursive:true});
const chrome=await browser(),report=[];
try{
 for(const scenario of cases){
  let engine,top,groups,initialPile;const requests=[];
  const server=createApp({makeRound:order=>{
   engine=createRound(order);Object.assign(engine,{stock:buildDeck(),hands:Object.fromEntries(order.map(id=>[id,[]])),initialDiscard:false,activePlayerId:order[0],contextPlayerId:null,phase:'draw',mustDiscard:Object.fromEntries(order.map(id=>[id,false])),opened:Object.fromEntries(order.map(id=>[id,true])),openingTotals:Object.fromEntries(order.map(id=>[id,100])),firstOpening:{playerId:order[0],total:100}});
   const take=({rank,suit})=>{const i=engine.stock.findIndex(c=>c.rank===rank&&c.suit===suit);assert.ok(i>=0);return engine.stock.splice(i,1)[0];};
   const primary=scenario.faces.map(take);top=primary[scenario.top];engine.hands[order[0]].push(...primary.filter(c=>c.id!==top.id));
   const other=faces(['5','6','7'],'clubs').map(take);engine.hands[order[0]].push(...other);
   groups=[{type:scenario.type,cards:primary,joker:scenario.joker},{type:'suite',cards:other}];
   for(const id of order)while(engine.hands[id].length<14)engine.hands[id].push(engine.stock.pop());
   engine.discard=[engine.stock.pop(),engine.stock.pop(),top];initialPile=engine.discard.map(c=>c.id);return engine;
  }});
  server.io.on('connection',socket=>socket.onAny((event,payload)=>{if(event.startsWith('game:'))requests.push({event,...payload});}));
  const pages=[];
  try{
   server.httpServer.listen(0,'127.0.0.1');await once(server.httpServer,'listening');const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
   for(let i=0;i<2;i++){
    const page=await chrome.page(origin,1440,900);pages.push(page);await until(()=>page.evaluate('document.querySelector("#name")?.disabled===false'),'accueil');await page.fill('#name',i?'Sara':'Hamza');
    if(!i)await page.click('form button[type="submit"]');else{await page.fill('#code',await pages[0].evaluate('document.querySelector(".room-code").textContent'));await page.click('.join button');}await until(()=>page.evaluate('!!document.querySelector(".room-code")'),'salon');
   }
   for(const page of pages){await page.click('.ready-toggle');await until(()=>page.evaluate('document.querySelector(".ready-toggle")?.getAttribute("aria-pressed")==="true"'),'prêt');}await pages[0].click('.start-button');const [actor,observer]=pages;
   await until(()=>actor.evaluate('document.querySelector(\'[aria-label="Piocher une carte"]\')?.disabled===false'),'table');
   const owner=engine.order[0],baseline=engine.hands[owner].map(c=>c.id).sort();
   const conserve=()=>{const cards=physicalCards(engine);assert.equal(cards.length,108);assert.equal(new Set(cards.map(c=>c.id)).size,108);};
   const change=async(action,label)=>{const revision=engine.revision;await action();await until(()=>engine.revision>revision,label);conserve();await until(()=>actor.evaluate('document.querySelector(".own-hand button")?.disabled===false'),'acquittement');};
   const groupSelector=id=>`.seat-bottom [data-group-id="${id}"]`;
   async function compose(){
    await actor.button('Descendre','.table-actions');const used=new Set();
    for(const group of groups){
     for(const card of group.cards){const available=engine.hands[owner].filter(c=>!used.has(c.id));await actor.click(`.composer-card:nth-child(${available.findIndex(c=>c.id===card.id)+1})`);}
     await actor.evaluate(`(()=>{const s=document.querySelector('.composer-fields select');s.value=${JSON.stringify(group.type)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
     if(group.joker)await actor.evaluate(`(()=>{const s=document.querySelectorAll('.composer-fields select');s[1].value=${JSON.stringify(group.joker.rank)};s[1].dispatchEvent(new Event('change',{bubbles:true}));s[2].value=${JSON.stringify(group.joker.suit)};s[2].dispatchEvent(new Event('change',{bubbles:true}));})()`);
     await actor.button('Ajouter au projet','.descente-composer');for(const card of group.cards)used.add(card.id);
    }
    await change(()=>actor.button('Descendre','.descente-composer'),'poses provisoires');await until(()=>actor.evaluate('!document.querySelector(".descente-composer")'),'composeur fermé');
    await until(()=>observer.evaluate(`document.querySelectorAll('.staged-group').length===2`),'deux poses synchronisées');
   }
   // Take, stage, retrieve entire combinations with a real sustained mouse gesture.
   await change(()=>actor.drag('[data-pointer-drag="discard"]','.own-hand'),'prise de la Défausse vers la main');
   assert.equal(engine.hands[owner].at(-1).id,top.id);await compose();assert.equal(privateGame(engine,owner).canCancelDiscard,false);
   for(const group of [...engine.staged])await change(()=>actor.drag(`${groupSelector(group.id)} .group-move`,'.own-hand'),'combinaison entière vers la main');
   assert.equal(engine.staged.length,0);assert.deepEqual(engine.hands[owner].map(c=>c.id).sort(),[...baseline,top.id].sort());
   // Buttons still operate on the same history after mouse retrieval.
   await change(()=>actor.button('Annuler','.undo-actions'),'annuler la dernière récupération');assert.ok(engine.staged.length>0);
   await change(()=>actor.button('Tout annuler','.undo-actions'),'tout annuler');assert.equal(engine.staged.length,0);
   assert.ok(engine.hands[owner].some(c=>c.id===top.id));assert.equal(privateGame(engine,owner).canCancelDiscard,true);
   // Repeat with individual/multiple cards, across groups for short combinations.
   await compose();const first=engine.staged[0],second=engine.staged[1];
   const count=scenario.partial??1;const selected=first.cards.slice(0,count);
   for(const card of selected)await actor.click(`${groupSelector(first.id)} [data-card-id="${card.id}"]`);
   if(!scenario.partial){const extra=second.cards[0];await actor.click(`${groupSelector(second.id)} [data-card-id="${extra.id}"]`);selected.push(extra);}
   await change(()=>actor.drag(`${groupSelector(first.id)} [data-card-id="${selected[0].id}"]`,'.own-hand'),'sélection de cartes vers la main');
   const retrieval=requests.filter(r=>r.event==='game:retrieve').at(-1);assert.equal(retrieval.selections.flatMap(s=>s.cardIds).length,selected.length);
   if(scenario.partial){assert.equal(engine.staged.find(g=>g.id===first.id).cards.length,first.cards.length-count);if(scenario.type==='carre')assert.equal(engine.staged.find(g=>g.id===first.id).type,'tierce');}
   for(const group of [...engine.staged])await change(()=>actor.drag(`${groupSelector(group.id)} .group-move`,'.own-hand'),'récupération du reste des poses');
   assert.equal(privateGame(engine,owner).canCancelDiscard,true);await until(()=>observer.evaluate('document.querySelectorAll(".staged-group").length===0'),'poses retirées chez le témoin');
   assert.ok(engine.turnUndo.length>0); // No undo button is needed before returning the pickup.
   const before=await actor.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`${scenario.name}-avant-retour.png`,output),Buffer.from(before.data,'base64'));
   await change(()=>actor.drag(`.own-hand [data-card-id="${top.id}"]`,'.discard-pile'),'retour de la carte physique exacte');
   assert.deepEqual(engine.discard.map(c=>c.id),initialPile);assert.deepEqual(engine.hands[owner].map(c=>c.id).sort(),baseline);assert.equal(engine.activePlayerId,owner);assert.equal(engine.mustDiscard[owner],false);assert.equal(privateGame(engine,owner).canDraw,true);
   const stock=engine.stock.at(-1).id;await change(()=>actor.click('[aria-label="Piocher une carte"]'),'pioche immédiate sans terminer le tour');assert.ok(engine.hands[owner].some(c=>c.id===stock));assert.equal(engine.mustDiscard[owner],true);assert.deepEqual(engine.discard.map(c=>c.id),initialPile);
   assert.equal(await observer.evaluate('document.querySelectorAll(".opponent-hand .card-face").length'),0);
   const after=await actor.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`${scenario.name}-apres-pioche.png`,output),Buffer.from(after.data,'base64'));
   report.push({scenario:scenario.name,wholeGroup:true,selectionSize:selected.length,exactReturn:true,immediateStockDraw:true,conservedCards:108});console.log(`PASS souris : ${scenario.name}, groupes entiers, sélection ${selected.length}, retour exact puis Pioche`);
  }finally{for(const page of pages)await page.close();await new Promise(resolve=>server.io.close(resolve));}
 }
 assert.deepEqual(chrome.errors,[]);
}finally{await chrome.close();await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));}
