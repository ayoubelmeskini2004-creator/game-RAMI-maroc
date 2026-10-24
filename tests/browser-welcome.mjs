import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir,writeFile } from 'node:fs/promises';
import { createApp } from '../server/src/app.js';
import { browser,until } from './browser-support.mjs';

const chrome=await browser(),server=createApp(),pages=[];
const artifacts=new URL('../.audit-artifacts/',import.meta.url);
try{
 await mkdir(artifacts,{recursive:true});server.httpServer.listen(0,'127.0.0.1');await once(server.httpServer,'listening');
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 const page=await chrome.page(origin,1920,1080);pages.push(page);
 await until(()=>page.evaluate('document.querySelector("#name")?.disabled===false'),'accueil connecté');
 await page.evaluate('document.fonts.ready');
 assert.equal(await page.evaluate(`new Promise(resolve=>{const url=getComputedStyle(document.querySelector('.welcome-screen')).backgroundImage.split('url("')[1]?.split('")')[0];if(!url||!url.startsWith(location.origin)){resolve(false);return;}const image=new Image();image.onload=()=>resolve(image.naturalWidth>1000);image.onerror=()=>resolve(false);image.src=url;})`),true);
 for(const[width,height]of[[1920,1080],[1440,900],[1280,820],[390,740]]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const layout=await page.evaluate(`(()=>{const main=document.querySelector('.welcome-screen'),panel=document.querySelector('.panel').getBoundingClientRect(),join=document.querySelector('.join').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth,center:panel.left+panel.width/2,bottom:join.bottom,cover:getComputedStyle(main).backgroundSize,translucent:getComputedStyle(document.querySelector('.panel')).backgroundColor}})()`);
  assert.equal(layout.overflow,false);assert.ok(Math.abs(layout.center-await page.evaluate('document.documentElement.clientWidth/2'))<2);assert.match(layout.cover,/cover/);
  if(width>=1280)assert.ok(layout.bottom<=height,`formulaire accessible à ${width}×${height}: ${layout.bottom}`);
  const shot=await page.cdp('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`welcome-${width}.png`,artifacts),Buffer.from(shot.data,'base64'));
 }
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await page.evaluate('document.querySelector("#name").focus()');
 assert.equal(await page.evaluate('document.activeElement.id'),'name');
 await page.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await page.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 assert.equal(await page.evaluate('document.activeElement.name'),'mode');
 for(const mode of['individual','teams']){
  const host=await chrome.page(origin,1440,900),guest=await chrome.page(origin,1280,820);pages.push(host,guest);
  for(const p of[host,guest])await until(()=>p.evaluate('document.querySelector("#name")?.disabled===false'),'formulaire disponible');
  await host.fill('#name','Hamza');if(mode==='teams')await host.click('input[value="teams"]');
  await host.click('form button[type="submit"]');await until(()=>host.evaluate('!!document.querySelector(".room-code")'),'salon créé');
  const code=await host.evaluate('document.querySelector(".room-code").textContent');
  await guest.fill('#name','Sara');await guest.fill('#code',code);await guest.click('.join button');
  await until(()=>guest.evaluate('!!document.querySelector(".room-code")'),'salon rejoint');
  assert.equal(await guest.evaluate('document.querySelector(".room-code").textContent'),code);
  await until(()=>host.evaluate('document.querySelectorAll(".player-info").length===2'),'deux joueurs synchronisés');
  assert.equal(await host.evaluate('!!document.querySelector(".welcome-screen")'),false);
  assert.equal(await host.evaluate('!!document.querySelector(".team-picker")'),mode==='teams');
  console.log(`PASS accueil : création et connexion au salon ${mode}, deux clients`);
 }
 assert.deepEqual(chrome.errors,[]);console.log('PASS accueil : photographie locale, trois bureaux, petit écran défilable, clavier et captures');
}finally{await Promise.all(pages.map(page=>page.close()));await chrome.close();await new Promise(resolve=>server.io.close(resolve));}
