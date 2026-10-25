import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createApp } from '../server/src/app.js';
import { createRound, buildDeck, privateGame } from '../server/src/game.js';
import { browser, until } from './browser-support.mjs';
// Visual fixtures exercise presentation and real Socket.IO updates, not game legality.
// Run after npm run build, with CHROME_PATH set for this machine.
const phase='after';
const output=new URL('../.audit-artifacts/descente/',import.meta.url);
await mkdir(output,{recursive:true});
const chrome=await browser();const report=[];
try{for(const [mode,count] of [['individual',2],['individual',3],['individual',4],['teams',4]]){
 let engine;
 const server=createApp({makeRound:(order,previous)=>{engine=createRound(order,previous);return engine;}});
 let snapshot;const sockets=new Map();server.io.on('connection',socket=>socket.onAnyOutgoing((event,payload)=>{if(event==='room:update')snapshot=payload;if(event==='game:update')sockets.set(payload.game.viewerId,socket.id);}));
 server.httpServer.listen(0,'127.0.0.1');await once(server.httpServer,'listening');const origin=`http://127.0.0.1:${server.httpServer.address().port}`;const pages=[];
 try{
 for(let i=0;i<count;i++){
  const page=await chrome.page(origin,1440,900);pages.push(page);
  await until(()=>page.evaluate('document.querySelector("#name")?.disabled===false'),'accueil');await page.fill('#name',['Hamza','Sara','Amine','Lina'][i]);
  if(!i){if(mode==='teams')await page.click('input[value="teams"]');await page.click('form button[type="submit"]');}
  else{const code=await pages[0].evaluate('document.querySelector(".room-code").textContent');await page.fill('#code',code);await page.click('.join button');}
  await until(()=>page.evaluate('!!document.querySelector(".room-code")'),'salon');
  if(mode==='teams'){const selector=`.team-picker button:nth-of-type(${i<2?1:2})`;await page.click(selector);await until(()=>page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed')==='true'`),'équipe');}
 }
 for(const page of pages){await page.click('.ready-toggle');await until(()=>page.evaluate('document.querySelector(".ready-toggle")?.getAttribute("aria-pressed")==="true"'),'prêt');}
 await until(()=>pages[0].evaluate('document.querySelector(".start-button")?.disabled===false'),'démarrer');await pages[0].click('.start-button');await until(()=>pages[0].evaluate('!!document.querySelector(".felt-table")'),'table');
 const room=snapshot;
 async function publish(){for(const player of room.players)server.io.to(sockets.get(player.id)).emit('game:update',{code:room.code,game:{...privateGame(engine,player.id),match:room.match}});}
 for(const state of ['empty','filled']){
 if(state==='filled'){
 // Presentation fixture only: populate public melds, including a long run and coincident stored positions.
 for(const [ownerIndex,id] of engine.order.entries()){
 if(ownerIndex===0)continue;
 const deck=buildDeck();let n=0;const take=(rank,suit)=>{const i=deck.findIndex(c=>c.rank===rank&&c.suit===suit);return deck.splice(i,1)[0];};
 engine.laid[id]=[
 {type:'suite',cards:['A','2','3','4','5','6','7','8','9','10','V','D','R'].map(r=>take(r,'hearts'))},
 {type:'tierce',cards:['clubs','diamonds','spades'].map(s=>take('R',s))},
 {type:'carre',cards:['clubs','diamonds','spades','hearts'].map(s=>take('8',s))},
 ...Array.from({length:5},(_,i)=>({type:'suite',cards:['2','3','4'].map(rank=>({id:`visual-${id}-${i}-${rank}`,rank,suit:i%2?'clubs':'spades'}))}))
 ].map(g=>({...g,id:`visual-group-${ownerIndex}-${n++}`}));
 for(const g of engine.laid[id])engine.groupPositions[g.id]={x:0.5,y:0.5};
 }
 engine.revision++;await publish();await until(()=>pages[0].evaluate('document.querySelectorAll(".laid-group").length>0'),'poses reçues');
 }
 for(const [width,height] of [[1920,1080],[1440,900],[1280,820]]){
 const page=pages[0];await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await new Promise(r=>setTimeout(r,180));
 const metrics=await page.evaluate(`(()=>{const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};return{piles:box(document.querySelector('.table-center')),own:box(document.querySelector('.seat-bottom')),ownDescent:box(document.querySelector('.seat-bottom .free-meld-area')),topDescent:document.querySelector('.seat-top .free-meld-area')?box(document.querySelector('.seat-top .free-meld-area')):null,ownParts:[...document.querySelectorAll('.felt-table>.turn-status,.seat-bottom>.seat-identity,.seat-bottom>.free-meld-area,.seat-bottom>.own-hand')].map(box),seats:[...document.querySelectorAll('.table-seat:not(.seat-bottom)')].map(e=>({box:box(e),area:box(e.querySelector('.free-meld-area')),groups:[...e.querySelectorAll('.laid-group')].map(box),cards:[...e.querySelectorAll('.laid-card')].map(box)})),viewport:[innerWidth,innerHeight],document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight]}})()`);
 report.push({phase,mode,count,state,width,height,...metrics});
 {
 const overlap=(a,b)=>a.x<b.right-.5&&a.right>b.x+.5&&a.y<b.bottom-.5&&a.bottom>b.y+.5;
 assert.deepEqual(metrics.document,[width,height]);
 if(metrics.topDescent){assert.ok(Math.abs(metrics.topDescent.w-metrics.ownDescent.w)<1,'descentes haute et personnelle de même largeur');assert.ok(metrics.topDescent.h>=metrics.ownDescent.h+20,'hauteur utile équivalente malgré le titre');}
 for(const seat of metrics.seats){assert.ok(!overlap(seat.area,metrics.piles),'zone et piles disjointes');for(const part of metrics.ownParts)assert.ok(!overlap(seat.area,part),'zone et éléments personnels disjoints');for(let i=0;i<seat.groups.length;i++)for(let j=0;j<i;j++)assert.ok(!overlap(seat.groups[i],seat.groups[j]),'groupes distincts');for(const c of seat.cards)assert.ok(c.w>=35,'cartes lisibles');for(let i=0;i<seat.cards.length;i++)for(let j=0;j<i;j++)assert.ok(!overlap(seat.cards[i],seat.cards[j]),'cartes sans chevauchement');}
 for(let i=0;i<metrics.seats.length;i++)for(let j=0;j<i;j++)assert.ok(!overlap(metrics.seats[i].box,metrics.seats[j].box),'sièges disjoints');
 }
 const shot=await page.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`${phase}-${mode}-${count}-${state}-${width}.png`,output),Buffer.from(shot.data,'base64'));
 if(state==='filled'){
  await page.evaluate(`for(const scroller of document.querySelectorAll('.remote-meld-scroll')){const first=scroller.querySelector('.laid-group');scroller.scrollTop=first.offsetTop+first.offsetHeight+10;}`);
  const groupsShot=await page.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`${phase}-${mode}-${count}-groups-${width}.png`,output),Buffer.from(groupsShot.data,'base64'));
  await page.evaluate(`for(const scroller of document.querySelectorAll('.remote-meld-scroll'))scroller.scrollTop=scroller.querySelector('.laid-group').offsetTop;`);
 }

 }
 }
 // Repeated real-time updates must preserve the reader's scroll position and stored layout.
 {
 const page=pages[0];const scrollSelector='.seat-top .remote-meld-scroll, .seat-left .remote-meld-scroll';
 await page.evaluate(`document.querySelector(${JSON.stringify(scrollSelector)}).scrollTop=90`);
 const scroll=await page.evaluate(`document.querySelector(${JSON.stringify(scrollSelector)}).scrollTop`);const stored=structuredClone(engine.groupPositions);
 engine.revision++;await publish();await new Promise(r=>setTimeout(r,120));
 assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(scrollSelector)}).scrollTop`),scroll);assert.deepEqual(engine.groupPositions,stored);
 for(const page of pages){
  assert.equal(await page.evaluate(`(()=>{for(const scroller of document.querySelectorAll('.remote-meld-scroll')){const groups=[...scroller.querySelectorAll('.laid-group')];if(scroller.parentElement.dataset.layoutOwner===${JSON.stringify(engine.order[0])}){if(groups.length!==0)return false;continue;}if(groups.length!==8)return false;const last=groups.at(-1);scroller.scrollTop=last.offsetTop;const a=last.getBoundingClientRect(),b=scroller.getBoundingClientRect();if(a.top>=b.bottom||a.bottom<=b.top)return false;}return true;})()`),true,'tous les groupes restent accessibles');
 }

 }
 console.log(`${phase}: ${mode}/${count}, vide et rempli, 3 résolutions OK`);
 }finally{for(const p of pages)await p.close();await new Promise(r=>server.io.close(r));}
}assert.deepEqual(chrome.errors,[],'aucune exception navigateur');}finally{await chrome.close();await writeFile(new URL(`${phase}-report.json`,output),JSON.stringify(report,null,2));}
