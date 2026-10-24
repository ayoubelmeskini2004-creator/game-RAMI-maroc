import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

export async function until(test, description, timeout = 8000) {
  const end = Date.now() + timeout;
  do { if (await test()) return; await new Promise((r) => setTimeout(r, 40)); } while (Date.now() < end);
  throw new Error(`Délai dépassé : ${description}`);
}

export async function browser() {
  const executable = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  await access(executable).catch(() => { throw new Error('Chrome introuvable : définissez CHROME_PATH avec le chemin absolu de Chrome.'); });
  const profile = await mkdtemp(join(tmpdir(), 'rami-audit-'));
  const chrome = spawn(executable,
    [...(process.env.RAMI_BROWSER_HEADED==='1'?[]:['--headless=new']), '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
  let port;
  await until(async () => { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port; } catch { return false; } }, 'démarrage de Chrome');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl); await once(ws, 'open');
  let id = 0; const requests = new Map(), errors = [];
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const pending = requests.get(message.id); requests.delete(message.id); message.error ? pending.reject(message.error) : pending.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  });
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id; requests.set(requestId, { resolve, reject }); ws.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return {
    errors,
    async page(url, width = 1440, height = 900) {
      const { browserContextId } = await command('Target.createBrowserContext');
      const { targetId } = await command('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
      const cdp = (method, params) => command(method, params, sessionId);
      await cdp('Runtime.enable'); await cdp('Page.enable');
      await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const evaluate = async (expression) => {
        const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      await cdp('Page.navigate', { url });
      return {
        cdp, evaluate,
        async fill(selector, value, select = false) {
          await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Champ absent');Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event(${select ? "'change'" : "'input'"},{bubbles:true}));})()`);
        },
        async click(selector, { exposed = false } = {}) {
          await cdp('Page.bringToFront');
          await until(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`), `commande disponible : ${selector}`);
          await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw new Error('Commande absente ou désactivée : '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect(),next=e.nextElementSibling?.getBoundingClientRect();const width=${exposed}?Math.min(r.width,next?Math.max(1,next.left-r.left):r.width):r.width;const x=r.left+width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);if(!hit||!e.contains(hit))throw new Error('Commande masquée : '+${JSON.stringify(selector)});return{x,y};})()`);
          await cdp('Input.dispatchMouseEvent', { type:'mouseMoved', ...point });
          await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons:1, clickCount: 1 });
          await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons:0, clickCount: 1 });
        },
        async button(text, scope = '') {
          await until(() => evaluate(`[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].some(b=>b.textContent.trim()===${JSON.stringify(text)})`), `bouton rendu : ${text}`);
          const selector = await evaluate(`(()=>{const all=[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})];const e=all.find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('Bouton absent : '+${JSON.stringify(text)});e.dataset.auditClick='true';return '[data-audit-click="true"]';})()`);
          try { await this.click(selector); } finally { await evaluate(`document.querySelector(${JSON.stringify(selector)})?.removeAttribute('data-audit-click')`); }
        },
        async drag(fromSelector, toSelector, { insertion = false, targetPoint = {x:0.5,y:0.5}, duringDrag, inspectPreview } = {}) {
          await cdp('Page.bringToFront');
          await until(()=>evaluate(`(()=>{const from=document.querySelector(${JSON.stringify(fromSelector)});return !!from?.dataset.pointerDrag&&!from.disabled&&!!document.querySelector(${JSON.stringify(toSelector)});})()`),'source et destination de glissé disponibles');
          const points = await evaluate(`(()=>{const from=document.querySelector(${JSON.stringify(fromSelector)}),to=document.querySelector(${JSON.stringify(toSelector)});to.scrollIntoView({block:'nearest',inline:'nearest'});const f=from.getBoundingClientRect(),t=to.getBoundingClientRect();return{from:{x:f.left+8,y:f.top+10},to:{x:t.left+t.width*${targetPoint.x},y:t.top+t.height*${targetPoint.y}}};})()`);
          await evaluate(`window.__auditPointerEvents=[];window.__auditPointerAbort?.abort();window.__auditPointerAbort=new AbortController();for(const type of ['pointerdown','pointermove','pointerup','dragstart','gotpointercapture','lostpointercapture','blur'])window.addEventListener(type,event=>window.__auditPointerEvents.push({type,buttons:event.buttons,trusted:event.isTrusted,target:event.target?.className}),{capture:true,signal:window.__auditPointerAbort.signal});`);
          const samples=[];
          try {
            await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.from });
            await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.from, button: 'left', buttons: 1, clickCount: 1 });
            for (let step = 1; step <= 5; step++) {
              const point={x:points.from.x+(points.to.x-points.from.x)*step/5,y:points.from.y+(points.to.y-points.from.y)*step/5};
              await cdp('Input.dispatchMouseEvent', { type:'mouseMoved',...point,button:'left',buttons:1 });
              try{await until(()=>evaluate(`(()=>{const r=document.querySelector('.pointer-card-preview')?.getBoundingClientRect();return r&&Math.abs(r.left-${point.x+12})<2&&Math.abs(r.top-${point.y+12})<2;})()`),'aperçu fidèle suit le pointeur pendant l’appui');}
              catch(error){console.error('Diagnostic pointeur',step,points,await evaluate('window.__auditPointerEvents'));throw error;}
              samples.push(await evaluate(`(()=>{const p=document.querySelector('.pointer-card-preview'),r=p.getBoundingClientRect();return{x:r.left,y:r.top,count:Number(p.dataset.cardCount)};})()`));
              if(step===2&&duringDrag)await duringDrag();
              if(step===3&&inspectPreview)await inspectPreview();
            }
            if(insertion)await until(()=>evaluate('!!document.querySelector(".own-hand .insert-before, .own-hand.insert-at-end")'),'repère d’insertion visible avant relâchement');
          } finally {
            await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.to, button: 'left', clickCount: 1 });
          }
          await until(()=>evaluate('!document.querySelector(".pointer-card-preview")'),'aperçu retiré après relâchement');
          if(!await evaluate('window.__auditPointerEvents.some(e=>e.type==="pointerdown"&&e.buttons===1&&e.trusted)&&window.__auditPointerEvents.filter(e=>e.type==="pointermove"&&e.buttons===1&&e.trusted).length>=5&&window.__auditPointerEvents.some(e=>e.type==="pointerup"&&e.trusted)&&!window.__auditPointerEvents.some(e=>e.type==="dragstart")'))throw new Error('Le geste doit être un véritable maintien du bouton gauche, sans dragstart HTML');
          return samples;
        },
        async close() { await command('Target.disposeBrowserContext', { browserContextId }); },
      };
    },
    async close() {
      await command('Browser.close').catch(() => {}); ws.close(); chrome.kill();
      // profile comes directly from mkdtemp under the OS temporary directory.
      await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    },
  };
}
