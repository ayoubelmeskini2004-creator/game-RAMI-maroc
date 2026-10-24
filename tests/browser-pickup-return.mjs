import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createApp } from '../server/src/app.js';
import { createRound,buildDeck } from '../server/src/game.js';
import { physicalCards } from '../server/test-support/match-scenarios.js';
import { until } from './browser-support.mjs';
export async function pickupReturnBrowser(chrome,artifacts){
 let engine,top,suite,hold=null;const connections=[],queued=[],requests=[];
 const server=createApp({makeRound:order=>{
  engine=createRound(order);Object.assign(engine,{stock:buildDeck(),hands:Object.fromEntries(order.map(id=>[id,[]])),starterId:order[0],activePlayerId:order[0],contextPlayerId:order[0],mustDiscard:{[order[0]]:true,[order[1]]:false}});
  const take=rank=>engine.stock.splice(engine.stock.findIndex(c=>c.rank===rank&&c.suit==='hearts'),1)[0];
  top=take('9');engine.hands[order[0]].push(top);const seven=take('7'),eight=take('8');engine.hands[order[1]].push(seven,eight);suite={type:'suite',cardIds:[seven.id,eight.id,top.id]};
  for(const id of order)while(engine.hands[id].length<(id===order[0]?15:14))engine.hands[id].push(engine.stock.pop());return engine;
 }});
 server.io.on('connection',socket=>{
  connections.push(socket);const send=socket.client.writeToEngine.bind(socket.client);
  socket.client.writeToEngine=(packets,options)=>{if(hold===socket.id&&packets.some(packet=>typeof packet==='string'&&packet.includes('["game:update",'))){queued.push(()=>send(packets,options));return;}return send(packets,options);};
  socket.onAny((event,payload)=>{if(event==='game:discard')requests.push({socket:socket.id,...payload});});
 });
 const pages=[];
 try{
  server.httpServer.listen(0,'127.0.0.1');await once(server.httpServer,'listening');const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  for(let i=0;i<2;i++){const p=await chrome.page(origin,1280,820);pages.push(p);await until(()=>p.evaluate('document.querySelector("#name")?.disabled===false'),'bienvenue');await p.fill('#name',i?'Sara':'Hamza');if(!i)await p.click('form button[type="submit"]');else{await p.fill('#code',await pages[0].evaluate('document.querySelector(".room-code").textContent'));await p.click('.join button');}await until(()=>p.evaluate('!!document.querySelector(".room-code")'),'salon');}
  for(const p of pages){await p.click('.ready-toggle');await until(()=>p.evaluate('document.querySelector(".ready-toggle")?.getAttribute("aria-pressed")==="true"'),'préparation acquittée');}await pages[0].click('.start-button');const[a,b]=pages;
  await until(()=>a.evaluate('!!document.querySelector(".own-hand button")'),'table');
  const conserve=()=>{const cards=physicalCards(engine);assert.equal(cards.length,108);assert.equal(new Set(cards.map(c=>c.id)).size,108);};
  const change=async(action,label)=>{const revision=engine.revision;await action();await until(()=>engine.revision>revision,label);conserve();};
  const pick=async(page,id)=>{await until(()=>page.evaluate(`document.querySelector('[data-card-id="${id}"]')?.disabled===false`),'carte disponible');await page.evaluate(`document.querySelector('[data-card-id="${id}"]').click()`);};
  const take=()=>change(()=>b.click('[aria-label="Prendre la dernière carte de la défausse"]'),'prise de la carte visible');
  await change(()=>a.drag(`[data-card-id="${top.id}"]`,'.discard-pile'),'première défausse normale par geste natif');
  await take();
  const beforeWrongDiscard=structuredClone(engine),other=engine.hands[engine.order[1]].find(card=>card.id!==top.id);
  await b.drag(`[data-card-id="${other.id}"]`,'.discard-pile');
  await until(()=>b.evaluate('document.querySelector(".match-error")?.textContent.startsWith("Ouverture incomplète")'),'autre carte traitée comme défausse normale, jamais comme annulation');
  assert.deepEqual(engine,beforeWrongDiscard);
  await change(()=>b.button('Annuler la prise','.undo-actions'),'annulation par bouton');
  assert.equal(engine.discard.at(-1).id,top.id);assert.equal(engine.activePlayerId,engine.order[1]);assert.equal(engine.hands[engine.order[1]].length,14);assert.equal(engine.mustDiscard[engine.order[1]],false);
  await until(()=>a.evaluate(`document.querySelector('.discard-slot .card-face')?.getAttribute('aria-label')==='9 de cœur'`),'sommet restauré chez le témoin');
  await take();await until(()=>b.evaluate(`document.querySelector('[data-card-id="${top.id}"]')?.disabled===false`),'carte reprise en main');
  await change(()=>b.drag(`[data-card-id="${top.id}"]`,'.discard-pile'),'annulation par drag vers Défausse');
  assert.equal(engine.discard.at(-1).id,top.id);assert.equal(engine.mustDiscard[engine.order[1]],false);
  await take();await change(()=>a.click('[aria-label="Piocher une carte"]'),'autre joueur pioche avant annulation');
  const before=structuredClone(engine);await until(()=>b.evaluate('![...document.querySelectorAll(".undo-actions button")].some(e=>e.textContent==="Annuler la prise")'),'annulation devenue indisponible');
  await b.drag(`[data-card-id="${top.id}"]`,'.discard-pile');await until(()=>b.evaluate('document.querySelector(".match-error")?.textContent.includes("Une action de jeu irréversible")'),'refus explicite de retour après action adverse');assert.deepEqual(engine,before);
  // Hold the remote update to reproduce a stale client revision with a still-legal own discard.
  hold=connections[0].id;
  await b.button('Descendre','.table-actions');const available=engine.hands[engine.order[1]].map(c=>c.id);for(const id of suite.cardIds)await b.click(`.composer-card:nth-child(${available.indexOf(id)+1})`);await b.button('Ajouter au projet','.descente-composer');await change(()=>b.button('Descendre','.descente-composer'),'utilisation de la prise');
  const currentRevision=engine.revision,card=engine.hands[engine.order[0]][0].id;
  await pick(a,card);await change(()=>a.button('Défausser','.table-actions'),'défausse légale malgré mise à jour adverse retardée');
  const request=requests.at(-1);assert.ok(request.revision<currentRevision);assert.equal(engine.discard.at(-1).id,card);assert.equal(engine.mustDiscard[engine.order[0]],false);
  assert.equal(await a.evaluate('document.querySelector(".match-error")===null'),true);
  hold=null;for(const send of queued.splice(0))send();
  for(const[width,height]of[[1440,900],[1280,820]]){
   await b.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   await until(()=>b.evaluate(`innerWidth===${width}&&innerHeight===${height}`),'dimensions du bureau');
   await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   const geometry=await b.evaluate(`(()=>{const zone=document.querySelector('.seat-bottom .free-meld-area').getBoundingClientRect(),hand=document.querySelector('.own-hand').getBoundingClientRect();return{width:zone.width,height:zone.height,bottom:zone.bottom,handTop:hand.top,actions:document.querySelector('.table-actions').getBoundingClientRect().bottom}})()`);
   assert.ok(geometry.width>=600);assert.ok(geometry.height>=(height===820?88:104));assert.ok(geometry.bottom<geometry.handTop);assert.ok(geometry.actions<=height);
   assert.equal(await b.evaluate(`[...document.querySelectorAll('.card-face:not(.joker-card) .card-corner .suit-symbol')].every(mark=>['♥','♦','♠','♣'].includes(mark.textContent)&&!!mark.querySelector('svg path'))`),true);
   const shot=await b.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`pickup-return-${width}.png`,artifacts),Buffer.from(shot.data,'base64'));
  }
  console.log('PASS navigateur : Annuler la prise par bouton et drag, refus après action adverse, défausse personnelle avec révision globale retardée, zone agrandie et enseignes SVG');
 }finally{await Promise.all(pages.map(p=>p.close()));await new Promise(resolve=>server.io.close(resolve));}
}
