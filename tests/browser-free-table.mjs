import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createApp } from '../server/src/app.js';
import { createRound, buildDeck } from '../server/src/game.js';
import { startTurnStaging } from '../server/src/descente.js';
import { physicalCards } from '../server/test-support/match-scenarios.js';
import { until } from './browser-support.mjs';

export async function freeTable(chrome,artifacts){
  let engine,first,second,end,extension;
  const server=createApp({makeRound:order=>{
    engine=createRound(order);Object.assign(engine,{stock:buildDeck(),hands:Object.fromEntries(order.map(id=>[id,[]])),activePlayerId:order[0],initialDiscard:false,phase:'discard',mustDiscard:{[order[0]]:true,[order[1]]:false},opened:Object.fromEntries(order.map(id=>[id,true])),openingTotals:{[order[0]]:100,[order[1]]:71},firstOpening:{playerId:order[1],total:71}});
    const take=(rank,suit='hearts')=>engine.stock.splice(engine.stock.findIndex(c=>c.rank===rank&&c.suit===suit),1)[0];
    first=['7','8','9'].map(rank=>take(rank));second=['V','D','R'].map(rank=>take(rank));end=take('2','clubs');extension=take('10');
    engine.hands[order[0]].push(...first,...second,end,take('4','diamonds'),take('6','diamonds'),extension);
    while(engine.hands[order[1]].length<14)engine.hands[order[1]].push(engine.stock.pop());startTurnStaging(engine,order[0]);engine.activePlayerId=order[1];engine.phase='draw';return engine;
  }});
  const pages=[];
  try{
    server.httpServer.listen(0,'127.0.0.1');await once(server.httpServer,'listening');const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
    for(let i=0;i<2;i++){
      const page=await chrome.page(origin,1280,820);pages.push(page);await until(()=>page.evaluate('document.querySelector("#name")?.disabled===false'),'bienvenue');await page.fill('#name',i?'Sara':'Hamza');
      if(!i)await page.click('form button[type="submit"]');else{await page.fill('#code',await pages[0].evaluate('document.querySelector(".room-code").textContent'));await page.click('.join button');}
      await until(()=>page.evaluate('!!document.querySelector(".room-code")'),'salon');
    }
    for(const page of pages){await page.click('.ready-toggle');await until(()=>page.evaluate('document.querySelector(".ready-toggle")?.getAttribute("aria-pressed")==="true"'),'préparation acquittée');}await pages[0].click('.start-button');const[actor,observer]=pages;
    await until(()=>actor.evaluate('!!document.querySelector(".own-hand button")'),'main');
    const own=()=>`.free-meld-area[data-layout-owner="${engine.order[0]}"]`;
    const ids=()=>actor.evaluate('[...document.querySelectorAll(".own-hand .hand-card-button")].map(e=>e.dataset.cardId)');
    const select=async cards=>{for(const card of cards)await actor.click(`[data-card-id="${card.id}"]`,{exposed:true});};
    const conserve=()=>{const cards=physicalCards(engine);assert.equal(cards.length,108);assert.equal(new Set(cards.map(c=>c.id)).size,108);};
    assert.deepEqual(await actor.evaluate('[...document.querySelectorAll(".own-hand .card-corner:first-child b")].slice(3,6).map(e=>e.textContent)'),['J','Q','K']);
    const beforeRemote=await ids();const remoteRevision=engine.revision;
    await actor.drag(`[data-card-id="${end.id}"]`,'.own-hand .hand-card-button:first-child',{insertion:true,targetPoint:{x:.1,y:.5},duringDrag:async()=>{
      await observer.evaluate('document.querySelector(\'[aria-label="Piocher une carte"]\').click()');
      await until(()=>engine.revision>remoteRevision,'pioche adverse pendant le geste');
      await until(()=>actor.evaluate('document.querySelector(".seat-top .card-count").textContent.includes("15 cartes")'),'diffusion adverse reçue pendant le geste');
    }});
    await until(async()=>JSON.stringify(await ids())!==JSON.stringify(beforeRemote),'rangement maintenu pendant mise à jour adverse');
    assert.equal((await ids())[0],end.id);conserve();
    await actor.click(`[data-card-id="${end.id}"]`,{exposed:true});
    assert.equal(await actor.evaluate(`document.querySelector('[data-card-id="${end.id}"]').getAttribute('aria-pressed')`),'true');
    const selectedBefore=await ids(),middle=selectedBefore[4];
    const selectedSamples=await actor.drag(`[data-card-id="${end.id}"]`,`[data-card-id="${middle}"]`,{insertion:true,targetPoint:{x:.02,y:.5},inspectPreview:async()=>{
      const shot=await actor.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL('pointer-selected-during-drag.png',artifacts),Buffer.from(shot.data,'base64'));
    }});
    assert.ok(selectedSamples.every(sample=>sample.count===1));
    const expectedMiddle=selectedBefore.filter(id=>id!==end.id);expectedMiddle.splice(expectedMiddle.indexOf(middle),0,end.id);
    assert.deepEqual(await ids(),expectedMiddle);
    assert.equal(await actor.evaluate(`document.querySelector('[data-card-id="${end.id}"]').getAttribute('aria-pressed')`),'true','glisser une carte sélectionnée ne la désélectionne pas');
    await actor.click(`[data-card-id="${end.id}"]`,{exposed:true});
    await actor.drag(`[data-card-id="${end.id}"]`,'.own-hand .hand-card-button:last-child',{insertion:true,targetPoint:{x:.95,y:.5}});
    assert.equal((await ids()).at(-1),end.id);
    const initial=await ids();const revision=engine.revision;
    await select([first[2],first[0],first[1]]);
    const multiSamples=await actor.drag(`[data-card-id="${first[1].id}"]`,'.own-hand .hand-card-button:last-child',{insertion:true,targetPoint:{x:.95,y:.5},inspectPreview:async()=>{
      const shot=await actor.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL('pointer-multiple-during-drag.png',artifacts),Buffer.from(shot.data,'base64'));
    }});
    assert.ok(multiSamples.every(sample=>sample.count===3));
    await until(async()=>JSON.stringify(await ids())!==JSON.stringify(initial),'déplacement de sélection');
    const moved=await ids();assert.deepEqual(moved.slice(-3),first.map(c=>c.id));assert.equal(engine.revision,revision);assert.equal(engine.staged.length,0);conserve();
    const stageRevision=engine.revision;
    await actor.drag(`[data-card-id="${first[0].id}"]`,own(),{targetPoint:{x:.12,y:.22}});
    await until(()=>engine.revision>stageRevision&&engine.staged.length===1,'descente par sélection glissée');
    const firstId=engine.staged[0].id;assert.deepEqual(engine.staged[0].cards.map(c=>c.id),first.map(c=>c.id));conserve();
    await until(()=>actor.evaluate('document.querySelector(".own-hand button")?.disabled===false'),'pose acquittée');
    await select(second);const secondRevision=engine.revision;
    // Scroll freely within the same personal surface; place the second combination lower down.
    await actor.evaluate(`document.querySelector('${own()}').scrollTop=120`);
    await actor.drag(`[data-card-id="${second[0].id}"]`,own(),{targetPoint:{x:.88,y:.75}});
    await until(()=>engine.revision>secondRevision&&engine.staged.length===2,'deuxième position libre');const secondId=engine.staged[1].id;
    assert.notDeepEqual(engine.groupPositions[firstId],engine.groupPositions[secondId]);
    for(const page of pages)await until(()=>page.evaluate(`!!document.querySelector('[data-group-id="${secondId}"]')`),'pose publique en direct');
    const position=engine.groupPositions[secondId];
    assert.ok(Math.abs(await observer.evaluate(`parseFloat(document.querySelector('[data-group-id="${secondId}"]').style.left)`)-position.x*100)<.001);
    await until(()=>actor.evaluate('document.querySelector(".own-hand button")?.disabled===false'),'pose acquittée');await select([end]);
    await actor.button('Défausser','.table-actions');await until(()=>engine.staged.length===0,'engagement à la défausse');assert.equal(engine.activePlayerId,engine.order[0]);assert.equal(engine.phase,'draw');
    await actor.click('[aria-label="Piocher une carte"]');await until(()=>engine.activePlayerId===engine.order[1],'passage automatique');
    await until(()=>actor.evaluate('document.querySelector(".group-move")?.disabled===false'),'poignée disponible hors tour');
    await actor.evaluate(`document.querySelector('${own()}').scrollTop=0`);
    const layoutRevision=engine.layoutRevision, gameplayRevision=engine.revision;
    await actor.drag(`[data-group-id="${firstId}"] .group-move`,own(),{targetPoint:{x:.6,y:.6}});
    await until(()=>engine.layoutRevision>layoutRevision,'déplacement du groupe engagé hors tour');assert.equal(engine.revision,gameplayRevision);assert.equal(engine.laid[engine.order[0]][0].cards.length,3);conserve();
    const expected={...engine.groupPositions[firstId]};
    await until(()=>observer.evaluate(`Math.abs(parseFloat(document.querySelector('[data-group-id="${firstId}"]').style.left)-${expected.x*100})<.001`),'position synchronisée');
    await actor.evaluate(`document.querySelector('${own()}').scrollTop=0`);
    const collageRevision=engine.revision;
    await actor.drag(`[data-card-id="${extension.id}"]`,`[data-group-id="${firstId}"] .laid-card:last-child`);
    await until(()=>engine.revision>collageRevision,'extension de Suite par geste natif sur une carte engagée');
    await until(()=>observer.evaluate(`document.querySelectorAll('[data-group-id="${firstId}"] .laid-card').length===4`),'extension publique');
    assert.deepEqual(engine.collages[0].group.cards.map(card=>card.rank),['7','8','9','10']);conserve();
    await actor.button('Annuler','.undo-actions');await until(()=>engine.collages.length===0,'annulation de l’extension');conserve();
    await actor.cdp('Page.reload');await until(()=>actor.evaluate(`!!document.querySelector('[data-group-id="${firstId}"]')`),'reconnexion avec positions');
    assert.ok(Math.abs(await actor.evaluate(`parseFloat(document.querySelector('[data-group-id="${firstId}"]').style.left)`)-expected.x*100)<.001);
    for(const[width,height]of[[1440,900],[1280,820]]){
      await actor.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await actor.evaluate('document.documentElement.scrollWidth<=innerWidth && document.querySelector(".table-actions").getBoundingClientRect().bottom<=innerHeight'),true);
      const screenshot=await actor.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`free-table-${width}.png`,artifacts),Buffer.from(screenshot.data,'base64'));
    }
    assert.equal(await observer.evaluate('document.querySelectorAll(".opponent-hand .card-face").length'),0);
    console.log('PASS navigateur : rangement pendant mise à jour adverse, sélection multiple par souris, poses libres, extension de Suite par drag natif, groupes engagés déplacés, synchronisation et reconnexion');
  }finally{await Promise.all(pages.map(page=>page.close()));await new Promise(resolve=>server.io.close(resolve));}
}
