import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createApp } from '../server/src/app.js';
import { createRound,buildDeck } from '../server/src/game.js';
import { startTurnStaging } from '../server/src/descente.js';
import { validateCombination } from '../server/src/combinations.js';
import { physicalCards } from '../server/test-support/match-scenarios.js';
import { until } from './browser-support.mjs';

export async function overlappingBrowser(chrome,artifacts){
 for(const directCollage of[true,false]){
  let engine,nine,three,core,extra,end;
  const server=createApp({makeRound:order=>{
   engine=createRound(order);Object.assign(engine,{stock:buildDeck(),hands:Object.fromEntries(order.map(id=>[id,[]])),activePlayerId:order[1],initialDiscard:false,phase:'draw',mustDiscard:{[order[0]]:true,[order[1]]:false},contextPlayerId:null,turns:{},opened:{[order[0]]:false,[order[1]]:true},openingTotals:{[order[1]]:71},firstOpening:null});
   const take=(rank,suit='hearts')=>engine.stock.splice(engine.stock.findIndex(c=>c.rank===rank&&c.suit===suit),1)[0];
   const hand=(player,rank,suit)=>{const c=take(rank,suit);engine.hands[player].push(c);return c;};
   const group=(ranks,suits,type='suite')=>({type,cardIds:ranks.map((rank,i)=>hand(order[0],rank,Array.isArray(suits)?suits[i]:suits).id)});
   const base=['hearts','spades','diamonds'].map(suit=>take('9',suit));const result=validateCombination({type:'tierce',cardIds:base.map(c=>c.id)},base);engine.laid[order[1]].push({id:'tierce-nine',type:'tierce',cards:result.cards});
   nine=hand(order[0],'9','clubs');three=hand(order[1],'3','hearts');end=hand(order[0],'2','diamonds');
   core=[group(['8','9','10'],'diamonds'),group(['R','R','R'],['clubs','diamonds','spades'],'tierce'),group(['4','5','6'],'clubs')];
   const one=hand(order[0],'A'),two=hand(order[0],'2');extra={type:'suite',cardIds:[one.id,two.id,three.id]};
   while(engine.hands[order[0]].length<15)engine.hands[order[0]].push(engine.stock.pop());while(engine.hands[order[1]].length<11)engine.hands[order[1]].push(engine.stock.pop());
   startTurnStaging(engine,order[0]);return engine;
  }});const pages=[];
  try{
   server.httpServer.listen(0,'127.0.0.1');await once(server.httpServer,'listening');const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
   for(let i=0;i<2;i++){
    const page=await chrome.page(origin,1280,820);pages.push(page);await until(()=>page.evaluate('document.querySelector("#name")?.disabled===false'),'bienvenue');await page.fill('#name',i?'Sara':'Hamza');
    if(!i)await page.click('form button[type="submit"]');else{await page.fill('#code',await pages[0].evaluate('document.querySelector(".room-code").textContent'));await page.click('.join button');}await until(()=>page.evaluate('!!document.querySelector(".room-code")'),'salon');
   }
   for(const page of pages){await page.click('.ready-toggle');await until(()=>page.evaluate('document.querySelector(".ready-toggle")?.getAttribute("aria-pressed")==="true"'),'préparation acquittée');}await pages[0].click('.start-button');const[a,b]=pages;
   await until(()=>a.evaluate('!!document.querySelector(".own-hand button")'),'table');
   assert.deepEqual(new Set(await a.evaluate(`[...document.querySelectorAll('.own-hand .card-face:not(.joker-card) .card-corner:first-child span')].map(e=>e.textContent)`)),new Set(['♥','♦','♠','♣']));
   assert.equal(await a.evaluate(`[...document.querySelectorAll('.own-hand .card-face:not(.joker-card)')].every(card=>{const suit=card.querySelector('.card-corner span').textContent;return card.classList.contains(['♥','♦'].includes(suit)?'red-suit':'black-suit')})`),true);
   const conserve=()=>{const cards=physicalCards(engine);assert.equal(cards.length,108);assert.equal(new Set(cards.map(c=>c.id)).size,108);};
   const change=async(action,label)=>{const revision=engine.revision;await action();await until(()=>engine.revision>revision,label);conserve();};
   const pick=async(page,id)=>{await until(()=>page.evaluate(`document.querySelector('[data-card-id="${id}"]')?.disabled===false`),'main disponible');await page.evaluate(`document.querySelector('[data-card-id="${id}"]').click()`);};
   const discard=async(page,id)=>{await pick(page,id);await change(()=>page.button('Défausser','.table-actions'),'défausse indépendante');};
   assert.equal(await b.evaluate(`document.querySelector('[aria-label="Piocher une carte"]').disabled`),false);
   if(directCollage){
    // B can draw now, but waits for A's new discard to decide.
    await discard(a,nine.id);assert.equal(engine.activePlayerId,engine.order[1]);
    await until(()=>b.evaluate(`document.querySelector('[aria-label="Prendre la dernière carte de la défausse"]').disabled===false`),'défausse glissable');
    await change(()=>b.drag('[aria-label="Prendre la dernière carte de la défausse"]','[data-group-id="tierce-nine"]'),'prise et quatrième carte par drag');
    assert.equal(engine.mustDiscard[engine.order[1]],true);assert.equal(engine.laid[engine.order[1]][0].type,'tierce');
    await until(()=>a.evaluate(`document.querySelectorAll('[data-group-id="tierce-nine"] .laid-card').length===4`),'Carré provisoire public');
    await change(()=>b.button('Annuler','.undo-actions'),'annuler le Collage sans annuler la prise');
    assert.ok(engine.hands[engine.order[1]].some(card=>card.id===nine.id));assert.equal(engine.discard.length,0);
    await until(()=>b.evaluate(`document.querySelector('[data-card-id="${nine.id}"]')?.disabled===false`),'quatrième carte en main');
    await change(()=>b.drag(`[data-card-id="${nine.id}"]`,'[data-group-id="tierce-nine"] .laid-card:last-child'),'quatrième carte depuis la main directement sur une carte de Tierce');
    await until(()=>a.evaluate(`document.querySelectorAll('[data-group-id="tierce-nine"] .laid-card').length===4`),'Carré public après Collage depuis la main');
    // A draws while B still owes its own discard.
    await change(()=>a.click('[aria-label="Piocher une carte"]'),'pioche avant défausse adverse');
    assert.ok(engine.mustDiscard[engine.order[0]]&&engine.mustDiscard[engine.order[1]]);
    await discard(b,three.id);assert.equal(engine.laid[engine.order[1]][0].type,'carre');
    await change(()=>b.click('[aria-label="Piocher une carte"]'),'nouvelle pioche après défausse personnelle');
    assert.equal(await a.evaluate(`document.querySelector('[aria-label="Piocher une carte"]').disabled`),true);
    assert.equal(engine.mustDiscard[engine.order[0]],true);
    console.log('PASS navigateur : attente de Défausse, Tierce → Carré depuis Défausse et main, undo et obligations chevauchantes');
   }else{
    await change(()=>b.click('[aria-label="Piocher une carte"]'),'B pioche avant défausse de A');
    assert.equal(engine.mustDiscard[engine.order[0]],true);assert.equal(engine.activePlayerId,engine.order[0]);
    await discard(a,nine.id);assert.equal(engine.mustDiscard[engine.order[1]],true);
    await discard(b,three.id);
    await until(()=>a.evaluate(`document.querySelector('[aria-label="Prendre la dernière carte de la défausse"]').disabled===false`),'prise autorisée');
    await change(()=>a.drag('[aria-label="Prendre la dernière carte de la défausse"]','.own-hand',{insertion:true,targetPoint:{x:.8,y:.5}}),'défausse vers main privée');
    assert.ok(engine.hands[engine.order[0]].some(c=>c.id===three.id));assert.equal(engine.opened[engine.order[0]],false);
    await pick(a,end.id);await a.button('Défausser','.table-actions');await until(()=>a.evaluate('document.querySelector(".match-error")?.textContent.startsWith("Ouverture incomplète")'),'ouverture obligatoire');await pick(a,end.id);
    await a.button('Descendre','.table-actions');let available=engine.hands[engine.order[0]].map(c=>c.id);
    for(const proposal of[...core,extra]){
     await a.fill('.composer-fields select',proposal.type,true);for(const id of proposal.cardIds)await a.click(`.composer-card:nth-child(${available.indexOf(id)+1})`);
     await a.button('Ajouter au projet','.descente-composer');available=available.filter(id=>!proposal.cardIds.includes(id));
    }
    await change(()=>a.button('Descendre','.descente-composer'),'ouverture préparée après prise');await discard(a,end.id);
    assert.equal(engine.opened[engine.order[0]],true);assert.equal(engine.openingTotals[engine.order[0]],78);
    console.log('PASS navigateur : pioche anticipée, obligation maintenue, drag Défausse vers main et ouverture contrôlée');
   }
   for(const page of pages){assert.equal(await page.evaluate('document.querySelectorAll(".opponent-hand .card-face").length'),0);}
   // Every natural visible face retains one of the four classic suit symbols, never a decorative star.
   for(const page of pages)assert.equal(await page.evaluate(`[...document.querySelectorAll('.card-face:not(.joker-card)')].every(card=>[...card.querySelectorAll('.card-corner span')].every(symbol=>['♥','♦','♠','♣'].includes(symbol.textContent)))`),true);
   for(const[width,height]of[[1440,900],[1280,820]]){await a.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});assert.equal(await a.evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".table-actions").getBoundingClientRect().bottom<=innerHeight'),true);const shot=await a.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`overlap-${directCollage?'collage':'hand'}-${width}.png`,artifacts),Buffer.from(shot.data,'base64'));}
  }finally{await Promise.all(pages.map(p=>p.close()));await new Promise(resolve=>server.io.close(resolve));}
 }
}
