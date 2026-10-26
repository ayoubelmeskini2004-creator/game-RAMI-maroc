import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createApp } from '../server/src/app.js';
import { createRound,buildDeck,privateGame } from '../server/src/game.js';
import { validateCombination } from '../server/src/combinations.js';
import { physicalCards } from '../server/test-support/match-scenarios.js';
import { until } from './browser-support.mjs';
export async function pickupReturnBrowser(chrome,artifacts){
 let engine,first,second,third,unrelated,runA,runB,base;
 const server=createApp({makeRound:order=>{
  engine=createRound(order);const[a,b]=order;Object.assign(engine,{stock:buildDeck(),hands:{[a]:[],[b]:[]},starterId:a,activePlayerId:a,contextPlayerId:a,mustDiscard:{[a]:true,[b]:false},opened:{[a]:true,[b]:true},openingTotals:{[a]:100,[b]:100},firstOpening:{playerId:a,total:100}});
  const take=(rank,suit)=>{const i=engine.stock.findIndex(c=>c.rank===rank&&c.suit===suit);assert.ok(i>=0);return engine.stock.splice(i,1)[0];};
  first=take('9','hearts');second=take('10','hearts');third=take('9','spades');runA=[second,take('V','hearts'),take('D','hearts')];runB=[take('7','hearts'),take('8','hearts'),first];unrelated=['4','5','6'].map(rank=>take(rank,'clubs'));
  engine.hands[a].push(first,...runA.slice(1),third);engine.hands[b].push(second,...runB.slice(0,2),...unrelated);
  const cards=['6','7','8'].map(rank=>take(rank,'spades'));base={id:'decision-collage',type:'suite',cards:validateCombination({type:'suite',cardIds:cards.map(c=>c.id)},cards).cards};engine.laid[b].push(base);
  for(const id of order)while(engine.hands[id].length<(id===a?15:14))engine.hands[id].push(engine.stock.pop());return engine;
 }});const pages=[];
 try{
  server.httpServer.listen(0,'127.0.0.1');await once(server.httpServer,'listening');const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  for(let i=0;i<2;i++){const page=await chrome.page(origin,1280,820);pages.push(page);await until(()=>page.evaluate('document.querySelector("#name")?.disabled===false'),'accueil');await page.fill('#name',i?'Sara':'Hamza');if(!i)await page.click('form button[type="submit"]');else{await page.fill('#code',await pages[0].evaluate('document.querySelector(".room-code").textContent'));await page.click('.join button');}await until(()=>page.evaluate('!!document.querySelector(".room-code")'),'salon');}
  for(const p of pages){await p.click('.ready-toggle');await until(()=>p.evaluate('document.querySelector(".ready-toggle")?.getAttribute("aria-pressed")==="true"'),'prêt');}await pages[0].click('.start-button');const[a,b]=pages;await until(()=>a.evaluate('!!document.querySelector(".own-hand button")'),'table');
  const conserve=()=>{const cards=physicalCards(engine);assert.equal(cards.length,108);assert.equal(new Set(cards.map(c=>c.id)).size,108);};
  const change=async(page,action,label)=>{const revision=engine.revision;await action();await until(()=>engine.revision>revision,label);conserve();await until(()=>page.evaluate('document.querySelector(".own-hand button")?.disabled===false'),'acquittement');};
  const hand=id=>`.own-hand [data-card-id="${id}"]`;
  const discard=(p,id)=>change(p,()=>p.drag(hand(id),'.discard-pile'),'défausse normale');
  const take=p=>change(p,()=>p.drag('[data-pointer-drag="discard"]','.own-hand'),'prise depuis la Défausse');
  const stage=async(p,cards)=>{for(const card of cards)await p.evaluate(`document.querySelector(${JSON.stringify(hand(card.id))}).click()`);const x=await p.evaluate('document.querySelectorAll(".seat-bottom .staged-group").length')?.85:.4;await change(p,()=>p.drag(hand(cards[0].id),'.seat-bottom .free-meld-area',{targetPoint:{x,y:.7}}),'essai de Suite par sélection et souris');};
  const blocked=async(p,owner)=>{await until(()=>p.evaluate('document.querySelector(\'[aria-label="Piocher une carte"]\')?.disabled===true'),'pioche précédente verrouillée');assert.equal(privateGame(engine,owner).canDraw,false);};
  await discard(a,first.id);const baseline=engine.hands[engine.order[1]].map(c=>c.id).sort();await take(b);await blocked(a,engine.order[0]);
  const unchanged=structuredClone(engine);await b.drag(hand(second.id),'.discard-pile');await until(()=>b.evaluate('document.querySelector(".match-error")?.textContent.startsWith("Utilisez la carte prise")'),'prise inutilisée refusée');assert.deepEqual(engine,unchanged);
  await stage(b,unrelated);await stage(b,runB);await blocked(a,engine.order[0]);
  await change(b,()=>b.button('Annuler','.undo-actions'),'annuler uniquement l’utilisation');assert.ok(engine.hands[engine.order[1]].some(c=>c.id===first.id));assert.equal(privateGame(engine,engine.order[1]).canCancelDiscard,false);
  await change(b,()=>b.button('Tout annuler','.undo-actions'),'restituer tous les essais');assert.equal(privateGame(engine,engine.order[1]).canCancelDiscard,true);
  await b.cdp('Page.reload');await until(()=>b.evaluate(`document.querySelector(${JSON.stringify(hand(first.id))})?.disabled===false`),'reconnexion avec décision conservée');await blocked(a,engine.order[0]);
  const shot=await b.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL('decision-avant-retour.png',artifacts),Buffer.from(shot.data,'base64'));
  await change(b,()=>b.drag(hand(first.id),'.discard-pile'),'retour exact à la Défausse');assert.equal(engine.discard.at(-1).id,first.id);assert.deepEqual(engine.hands[engine.order[1]].map(c=>c.id).sort(),baseline);assert.equal(engine.mustDiscard[engine.order[1]],false);
  const stock=engine.stock.at(-1).id;await change(b,()=>b.click('[aria-label="Piocher une carte"]'),'pioche au stock sans terminer le tour');assert.ok(engine.hands[engine.order[1]].some(c=>c.id===stock));assert.equal(engine.mustDiscard[engine.order[1]],true);assert.equal(privateGame(engine,engine.order[0]).canDraw,true);
  await discard(b,second.id);await take(a);await blocked(b,engine.order[1]);await stage(a,runA);await blocked(b,engine.order[1]);
  await change(a,()=>a.button('Annuler','.undo-actions'),'reprendre une utilisation encore réversible');await blocked(b,engine.order[1]);assert.equal(privateGame(engine,engine.order[0]).canCancelDiscard,true);
  await stage(a,runA);await discard(a,third.id);assert.ok(engine.laid[engine.order[0]].some(g=>g.cards.some(c=>c.id===second.id)));assert.equal(privateGame(engine,engine.order[1]).canDraw,true);
  // A legal direct Collage is also reversible until the owner's personal discard.
  await change(b,()=>b.drag('[data-pointer-drag="discard"]',`[data-group-id="${base.id}"]`),'prise et Collage direct');await blocked(a,engine.order[0]);
  await change(b,()=>b.button('Annuler','.undo-actions'),'annuler le Collage de la prise');assert.equal(privateGame(engine,engine.order[1]).canCancelDiscard,true);await blocked(a,engine.order[0]);
  await change(b,()=>b.drag(hand(third.id),`[data-group-id="${base.id}"]`),'réutiliser la carte prise en Collage');await blocked(a,engine.order[0]);await discard(b,runB[0].id);
  assert.equal(engine.laid[engine.order[1]].find(g=>g.id===base.id).cards.at(-1).id,third.id);assert.equal(privateGame(engine,engine.order[0]).canDraw,true);assert.equal(Object.keys(engine.pickupReturns).length,0);
  for(const p of pages)assert.equal(await p.evaluate('document.querySelectorAll(".opponent-hand .card-face").length'),0);
  for(const[width,height]of[[1440,900],[1280,820]]){await b.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await b.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await b.evaluate('document.querySelector(".table-actions").getBoundingClientRect().bottom<=innerHeight'),true);const capture=await b.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`decision-validee-${width}.png`,artifacts),Buffer.from(capture.data,'base64'));}
  console.log('PASS navigateur : deux joueurs, prise inutilisée refusée, essais/Annuler/Tout annuler, reconnexion verrouillée, retour exact puis Pioche, utilisation en Descente et Collage, déblocage à la défausse et 108 cartes conservées');
 }finally{for(const p of pages)await p.close();await new Promise(r=>server.io.close(r));}
}
