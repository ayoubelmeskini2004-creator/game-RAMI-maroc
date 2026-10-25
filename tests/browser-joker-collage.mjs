import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir,writeFile } from 'node:fs/promises';
import { createApp } from '../server/src/app.js';
import { createRound,buildDeck } from '../server/src/game.js';
import { startTurnStaging } from '../server/src/descente.js';
import { validateCombination } from '../server/src/combinations.js';
import { physicalCards } from '../server/test-support/match-scenarios.js';
import { browser,until } from './browser-support.mjs';
const output=new URL('../.audit-artifacts/joker-collage/',import.meta.url);await mkdir(output,{recursive:true});
const chrome=await browser(),report=[];
try{for(const kind of ['staged-suite','staged-tierce','committed-opponent','recovered-committed']){
 let engine,groups,joker,secondJoker,end,extension,targetId,targetOwner,natural;
 const committed=kind.includes('committed');
 const server=createApp({makeRound:order=>{
  engine=createRound(order);const [a,b]=order;Object.assign(engine,{stock:buildDeck(),hands:{[a]:[],[b]:[]},initialDiscard:false,activePlayerId:a,phase:'discard',mustDiscard:{[a]:true,[b]:false},opened:{[a]:committed,[b]:true},openingTotals:{[b]:committed?90:108,...(committed?{[a]:120}:{})},firstOpening:{playerId:b,total:committed?90:108}});
  const take=(rank,suit='hearts')=>{const i=engine.stock.findIndex(c=>c.rank===rank&&c.suit===(rank==='Joker'?null:suit));assert.ok(i>=0);return engine.stock.splice(i,1)[0];};
  const group=(type,ranks,suits='hearts')=>{const cards=ranks.map((r,i)=>take(r,Array.isArray(suits)?suits[i]:suits));engine.hands[a].push(...cards);return{type,cardIds:cards.map(c=>c.id)};};
  if(committed){
   const cards=['8','9','10'].map(r=>take(r,'diamonds'));engine.laid[b]=[{id:'opponent-run',type:'suite',cards:validateCombination({type:'suite',cardIds:cards.map(c=>c.id)},cards).cards}];targetId='opponent-run';targetOwner=b;groups=[];
  }else{
   groups=[group('suite',['8','9','10']),group('tierce',['R','R','R'],['clubs','diamonds','spades']),group('suite',['4','5','6'],'clubs')];
   groups.push(kind==='staged-suite'?group('suite',['8','9','10'],'diamonds'):group('tierce',['D','D','D'],['hearts','clubs','diamonds']));targetOwner=a;
  }
  joker=take('Joker');secondJoker=take('Joker');end=take('2','spades');
  if(kind==='recovered-committed'){const source=[take('4'),take('5'),joker];engine.laid[a]=[{id:'source-joker',type:'suite',cards:validateCombination({type:'suite',cardIds:source.map(c=>c.id),joker:{cardId:joker.id,rank:'6',suit:'hearts'}},source).cards}];natural=take('6');engine.hands[a].push(natural,secondJoker,end);}
  else engine.hands[a].push(joker,secondJoker,end);
  extension=take(kind==='staged-tierce'?'V':'D',kind==='staged-tierce'?'hearts':'diamonds');
  for(const id of order)while(engine.hands[id].length<14)engine.hands[id].push(engine.stock.pop());engine.stock.push(extension);startTurnStaging(engine,a);return engine;
 }});
 const pages=[];
 try{
  server.httpServer.listen(0,'127.0.0.1');await once(server.httpServer,'listening');const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  for(let i=0;i<2;i++){const p=await chrome.page(origin,1440,900);pages.push(p);await until(()=>p.evaluate('document.querySelector("#name")?.disabled===false'),'accueil');await p.fill('#name',i?'Sara':'Hamza');if(!i)await p.click('form button[type="submit"]');else{await p.fill('#code',await pages[0].evaluate('document.querySelector(".room-code").textContent'));await p.click('.join button');}await until(()=>p.evaluate('!!document.querySelector(".room-code")'),'salon');}
  for(const p of pages){await p.click('.ready-toggle');await until(()=>p.evaluate('document.querySelector(".ready-toggle")?.getAttribute("aria-pressed")==="true"'),'prêt');}await pages[0].click('.start-button');const [actor,observer]=pages;await until(()=>actor.evaluate('!!document.querySelector(".own-hand button")'),'table');
  const conserve=()=>{const cards=physicalCards(engine);assert.equal(cards.length,108);assert.equal(new Set(cards.map(c=>c.id)).size,108);};
  const change=async(action,label)=>{const revision=engine.revision;await action();await until(()=>engine.revision>revision,label);conserve();if(engine.phase!=='round-ended')await until(()=>actor.evaluate('document.querySelector(".own-hand button")?.disabled===false'),'acquittement');};
  if(groups.length){
   assert.match(await actor.evaluate('document.querySelector(".own-opening-score").textContent'),/Non descendu/);
   await actor.button('Descendre','.table-actions');const used=new Set();for(const g of groups){for(const id of g.cardIds){const available=engine.hands[engine.order[0]].filter(c=>!used.has(c.id));await actor.click(`.composer-card:nth-child(${available.findIndex(c=>c.id===id)+1})`);}await actor.evaluate(`(()=>{const s=document.querySelector('.composer-fields select');s.value=${JSON.stringify(g.type)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await actor.button('Ajouter au projet','.descente-composer');for(const id of g.cardIds)used.add(id);}
   await change(()=>actor.button('Descendre','.descente-composer'),'poses naturelles');targetId=engine.staged.at(-1).id;
  }
  if(kind==='staged-suite'){
   const unchanged=structuredClone(engine);
   await actor.drag(`.own-hand [data-card-id="${joker.id}"]`,'.seat-bottom .free-meld-area',{targetPoint:{x:.95,y:.9}});
   await until(()=>actor.evaluate('document.querySelector(".match-error")?.textContent.includes("Glissez le Joker sur une combinaison")'),'Joker seul refusé dans la zone vide');assert.deepEqual(engine,unchanged);
  }
  if(natural)await change(()=>actor.drag(`.own-hand [data-card-id="${natural.id}"]`,'[data-group-id="source-joker"] .joker-target'),'récupération réelle du Joker');
  const target=`[data-group-id="${targetId}"]`;
  await change(async()=>{
   await actor.drag(`.own-hand [data-card-id="${joker.id}"]`,target,{inspectPreview:async()=>{assert.equal(await actor.evaluate('document.querySelectorAll(".pointer-card-preview .joker-card").length'),1);const shot=await actor.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`${kind}-pendant-glisse.png`,output),Buffer.from(shot.data,'base64'));}});
   if(await actor.evaluate('!!document.querySelector(".joker-choice")'))await actor.click('.joker-choice button:first-of-type');
  },'Joker intégré au groupe');
  assert.equal(engine.collages.find(item=>item.groupId===targetId).group.cards.length,4);assert.equal(engine.collages.find(item=>item.groupId===targetId).group.cards.filter(c=>c.rank==='Joker').length,1);
  await until(()=>observer.evaluate(`document.querySelectorAll('${target} .joker-card').length===1`),'Joker visible chez le témoin');
  assert.equal(await actor.evaluate(`document.querySelectorAll('${target} .laid-card').length`),4);
  if(natural)await until(()=>actor.evaluate('!document.querySelector(".table-actions>span").textContent.includes("à rejouer")'),'obligation de réemploi satisfaite par le Collage');
  const before=structuredClone(engine);await actor.drag(`.own-hand [data-card-id="${secondJoker.id}"]`,target);await until(()=>actor.evaluate('document.querySelector(".match-error")?.textContent.includes("un seul Joker")'),'deuxième Joker refusé');assert.deepEqual(engine,before);
  await actor.evaluate(`document.querySelector('.own-hand [data-card-id="${end.id}"]').click()`);await change(()=>actor.button('Défausser','.table-actions'),'validation de la première descente');
  const expected=kind==='staged-suite'?109:kind==='staged-tierce'?112:120;assert.equal(engine.openingTotals[engine.order[0]],expected);
  await until(()=>actor.evaluate(`document.querySelector('.own-opening-score strong').textContent==='${expected} points'`),'score propre fixe');
  await until(()=>observer.evaluate(`document.querySelector('.seat-top .opening-points').textContent==='${expected} points'`),'score synchronisé');
  await change(()=>actor.click('[aria-label="Piocher une carte"]'),'tour suivant');
  const extensionGroup=kind==='staged-tierce'?engine.laid[engine.order[0]][0].id:targetId;
  await change(()=>actor.drag(`.own-hand [data-card-id="${extension.id}"]`,`[data-group-id="${extensionGroup}"]`),'Collage naturel ultérieur');assert.equal(engine.openingTotals[engine.order[0]],expected);
  await actor.evaluate(`document.querySelector('.own-hand [data-card-id="${secondJoker.id}"]').click()`);await change(()=>actor.button('Défausser','.table-actions'),'validation du Collage ultérieur');assert.equal(engine.openingTotals[engine.order[0]],expected);
  if(committed)assert.equal(engine.openingTotals[targetOwner],90);
  for(const [width,height] of [[1920,1080],[1440,900],[1280,820]]){await actor.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await actor.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await actor.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);const shot=await actor.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`${kind}-${width}.png`,output),Buffer.from(shot.data,'base64'));}
  report.push({kind,opening:expected,oneJoker:true,mouse:true,fixedAfterCollage:true});console.log(`PASS souris : ${kind}, Joker intégré, score ${expected} fixe après Collage`);
 }finally{for(const p of pages)await p.close();await new Promise(r=>server.io.close(r));}
}assert.deepEqual(chrome.errors,[]);}finally{await chrome.close();await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));}
