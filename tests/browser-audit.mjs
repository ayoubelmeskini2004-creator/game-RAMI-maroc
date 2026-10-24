import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createApp } from '../server/src/app.js';
import { matchScenario, physicalCards } from '../server/test-support/match-scenarios.js';
import { browser, until } from './browser-support.mjs';
import { interactions } from './browser-interactions.mjs';
import { freeTable } from './browser-free-table.mjs';
import { overlappingBrowser } from './browser-overlap.mjs';
import { pickupReturnBrowser } from './browser-pickup-return.mjs';

const layoutOnly = process.argv.includes('--layout-only');
const pickupOnly = process.argv.includes('--pickup-only');
const chrome = await browser(); const report = [];
const screenshots = new URL('../.audit-artifacts/', import.meta.url); await mkdir(screenshots, { recursive: true });
try {
  for (const [mode, count] of process.argv.includes('--interactions-only') || pickupOnly ? [] : layoutOnly || process.argv.includes('--teams-only') ? [['teams', 4]] : [['individual', 2], ['individual', 3], ['individual', 4], ['teams', 4]]) {
    const scenario = matchScenario(mode); let engine, job, completedAt, time = Date.now();
    const realTimer = !layoutOnly && mode === 'individual' && count === 2;
    const server = createApp({ makeRound: (...args) => { engine = scenario.makeRound(...args); return engine; },
      ...(realTimer ? {} : { now: () => time, schedule: (fn) => { job = fn; return 1; }, unschedule: () => { job = null; } }) });
    server.io.on('connection', (socket) => socket.onAnyOutgoing((event, payload) => {
      if (event === 'game:update' && payload.game.phase === 'round-ended' && payload.game.round === 1) completedAt = payload.game.match.history[0].completedAt;
    }));
    const pages = [];
    try {
      server.httpServer.listen(0, '127.0.0.1'); await once(server.httpServer, 'listening');
      const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
      for (let i = 0; i < count; i++) {
        const page = await chrome.page(origin, 1440, 900); pages.push(page);
        await until(() => page.evaluate('document.querySelector("#name")?.disabled===false'), 'écran de bienvenue');
        await page.fill('#name', ['Hamza', 'Sara', 'Amine', 'Lina'][i]);
        if (i === 0) {
          if (mode === 'teams') await page.click('input[value="teams"]');
          await page.click('form button[type="submit"]');
        } else {
          const code = await pages[0].evaluate('document.querySelector(".room-code").textContent');
          await page.fill('#code', code); await page.click('.join button');
        }
        await until(() => page.evaluate('!!document.querySelector(".room-code")'), 'salon');
        if (mode === 'teams') {
          const selector=`.team-picker button:nth-of-type(${i<2?1:2})`;
          await page.click(selector);
          await until(()=>page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed')==='true'`),'équipe sélectionnée et synchronisée');
        }
      }
      await pages[0].fill('#penalty-threshold', mode === 'teams' ? 450 : 300); await pages[0].button('Enregistrer le seuil');
      for(const page of pages){await page.click('.ready-toggle');await until(()=>page.evaluate('document.querySelector(".ready-toggle")?.getAttribute("aria-pressed")==="true"'),'préparation acquittée');}
      await until(() => pages[0].evaluate('document.querySelector(".start-button")?.disabled===false'), 'tous prêts'); await pages[0].click('.start-button');
      await until(() => engine && pages[0].evaluate('!!document.querySelector(".felt-table")'), 'table');
      const seatOrder = mode === 'teams' ? [0, 2, 1, 3] : Array.from({ length: count }, (_, i) => i);
      const byId = new Map(engine.order.map((id, i) => [id, pages[seatOrder[i]]]));
      const capture = async (width, height, suffix) => {
        const page = pages[0]; await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        const shot = await page.cdp('Page.captureScreenshot', { format: 'png' });
        await writeFile(new URL(`${mode}-${count}-${width}-${suffix}.png`, screenshots), Buffer.from(shot.data, 'base64'));
        return page.evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right}};return{viewport:[innerWidth,innerHeight],page:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],actions:rect(document.querySelector('.table-actions')),seats:[...document.querySelectorAll('.table-seat')].map(rect),chat:rect(document.querySelector('.table-chat')),hand:rect(document.querySelector('.own-hand'))}})()`);
      };
      for (const [width, height] of [[1440, 900], [1280, 820]]) {
        const layout = await capture(width, height, 'deal');
        report.push({ mode, count, layout });
        console.log(`Affichage ${mode}/${count} à ${width}×${height} : commandes jusqu’à y=${layout.actions.bottom}, page ${layout.page.join('×')}`);
        if (!layoutOnly) {
          assert.ok(layout.actions.bottom <= height + 1, 'Les commandes doivent rester dans le viewport');
          assert.ok(layout.page[0] <= width, 'Pas de débordement horizontal');
        }
      }
      if (layoutOnly) continue;
      if (mode === 'teams') {
        assert.equal(await pages[0].evaluate('document.querySelector(".seat-top strong").textContent.includes("Sara")'), true);
      }
      if (mode === 'individual' && count === 3) {
        await pages[0].fill('#chat-message', 'Bonsoir à la table !'); await pages[0].click('.chat-compose button');
        for (const page of pages) await until(() => page.evaluate('document.querySelector(".chat-messages").textContent.includes("Bonsoir à la table !")'), 'chat public synchronisé');
      }
      const conserve = () => { const cards = physicalCards(engine); assert.equal(cards.length, 108); assert.equal(new Set(cards.map((c) => c.id)).size, 108); };
      const change = async (action, label) => { const revision = engine.revision, roundId = engine.roundId; await action(); await until(() => engine.revision !== revision || engine.roundId !== roundId, label); conserve(); };
      const chooseHand = async (page, playerId, cardId) => {
        const index = engine.hands[playerId].findIndex((c) => c.id === cardId); assert.ok(index >= 0);
        await until(() => page.evaluate(`document.querySelectorAll('.own-hand .hand-card-button').length===${engine.hands[playerId].length} && document.querySelector('[data-card-id="${cardId}"]')?.disabled===false`), 'main rendue après synchronisation et acquittement');
        // The fan overlaps; invoke the card's normal click handler by physical hand index.
        await page.evaluate(`document.querySelector('[data-card-id="${cardId}"]').click()`);
      };
      const compose = async (page, playerId, groups) => {
        await page.button('Descendre', '.table-actions'); await until(() => page.evaluate('!!document.querySelector(".descente-composer")'), 'composeur');
        let available = engine.hands[playerId].map((c) => c.id);
        for (const group of groups) {
          await page.fill('.composer-fields select', group.type, true);
          for (const id of group.cardIds) await page.click(`.composer-card:nth-child(${available.indexOf(id) + 1})`);
          if (group.joker) {
            await page.fill('.composer-fields label:nth-child(2) select', group.joker.rank, true);
            await page.fill('.composer-fields label:nth-child(3) select', group.joker.suit, true);
          }
          await page.button('Ajouter au projet', '.descente-composer'); available = available.filter((id) => !group.cardIds.includes(id));
        }
        await change(() => page.button('Descendre', '.descente-composer'), 'pose serveur');
        await until(() => page.evaluate('!document.querySelector(".descente-composer")'), 'fermeture du composeur');
      };
      let previousStarter;
      for (let round = 1; round <= 2; round++) {
        const plan = scenario.plans.get(engine.roundId);
        if (previousStarter) assert.equal(engine.starterId, engine.order[(engine.order.indexOf(previousStarter) + 1) % count]); previousStarter = engine.starterId;
        let steps = 0;
        while (!engine.roundResult && steps++ < 40) {
          const actor = engine.activePlayerId, page = byId.get(actor);
          await until(() => page.evaluate(`document.querySelector('.preview-pill')?.textContent==='MANCHE ${round}'`), 'synchronisation de manche');
          if (engine.initialDiscard) {
            await chooseHand(page, actor, plan.firstDiscardId); await change(() => page.button('Défausser', '.table-actions'), 'première défausse'); continue;
          }
          if(engine.mustDiscard[actor]) {
            await chooseHand(page,actor,engine.hands[actor].at(-1).id);await change(()=>page.button('Défausser','.table-actions'),'défausse requise');
          }
          const beforeHand=new Set(engine.hands[actor].map(card=>card.id));
          await change(()=>page.click('[aria-label="Piocher une carte"]'),'pioche et droit transmis');
          const drawn=engine.hands[actor].find(card=>!beforeHand.has(card.id));
          if (actor === plan.winner && (mode !== 'teams' || engine.opened[plan.opener])) {
            await compose(page, actor, plan.groups);
            if (round === 1) {
              await change(() => page.button('Annuler', '.undo-actions'), 'annuler');
              await compose(page, actor, plan.groups);
              const groupId = engine.staged[0].id;
              await page.click(`[data-group-id="${groupId}"] .group-select`);
              await change(() => page.button('Reprendre', '.table-actions'), 'reprendre groupe');
              await change(() => page.button('Annuler', '.undo-actions'), 'annuler reprise');
              await change(() => page.button('Tout annuler', '.undo-actions'), 'tout annuler');
              await compose(page, actor, plan.groups);
            }
            if (mode === 'teams') {
              const target = engine.laid[plan.opener].find((g) => g.type === 'suite' && g.cards[0].suit === 'hearts');
              const index = engine.hands[actor].findIndex((c) => c.id === plan.collageId);
              await until(() => page.evaluate('document.querySelector(".own-hand button")?.disabled===false'), 'main acquittée avant drag');
              await change(() => page.drag(`.own-hand .hand-card-button:nth-child(${index + 1})`, `[data-group-id="${target.id}"]`), 'collage par drag natif Chrome');
            }
            await chooseHand(page, actor, mode === 'teams' ? drawn.id : plan.endId);
          } else {
            if(mode==='teams'&&actor===plan.opener&&!engine.opened[actor]) await compose(page,actor,plan.ordinary);
            await chooseHand(page,actor,drawn.id);
          }
          try { await change(() => page.button('Défausser', '.table-actions'), 'défausse'); }
          catch (error) {
            console.error('Diagnostic du tour', JSON.stringify({ actor, phase: engine.phase, hand: engine.hands[actor], ui: await page.evaluate(`({selected:[...document.querySelectorAll('.own-hand [aria-pressed=true]')].map(e=>e.textContent),buttons:[...document.querySelectorAll('.table-actions button')].map(e=>[e.textContent,e.disabled]),error:document.querySelector('.match-error')?.textContent})`) }));
            throw error;
          }
        }
        assert.ok(engine.roundResult); assert.equal(engine.roundResult.winnerId, plan.winner);
        for (const page of pages) await until(() => page.evaluate('!!document.querySelector(".round-score-overlay")'), 'tableau des scores');
        for (const page of pages) assert.equal(await page.evaluate('document.querySelector(".preview-active-seat")===null && ![...document.querySelectorAll(".card-count")].some(e=>e.textContent.includes("À son tour"))'), true, 'Aucun faux tour actif entre deux manches');
        await capture(1280, 820, `score-${round}`);
        if (round === 1) {
          if (realTimer) {
            const initialSeconds = await pages[0].evaluate('Number(document.querySelector(".score-countdown").textContent.match(/\\d+/)[0])');
            await until(() => pages[0].evaluate(`Number(document.querySelector('.score-countdown')?.textContent.match(/\\d+/)?.[0]) < ${initialSeconds}`), 'décompte visible décroissant');
            await until(() => engine.round === 2, 'compte à rebours réel de 15 secondes', 18000); assert.ok(Date.now() - completedAt >= 14900);
          } else { time += 15000; const next = job; job = null; next(); }
        } else {
          await until(() => pages[0].evaluate('document.querySelector(".score-victory")?.textContent.includes("Partie terminée")'), 'résultat final');
          await pages[0].button('Historique des manches', '.round-score-overlay');
          await until(() => pages[0].evaluate('document.querySelectorAll(".table-dialog .score-round").length===2'), 'historique des deux manches');
          await pages[0].click('[aria-label="Fermer"]');
          assert.equal(await pages[0].evaluate('document.querySelector(".score-countdown")===null'), true);
          if (count === 2) {
            await pages[0].button('Quitter le salon'); await pages[0].button('Quitter le salon', '.leave-dialog');
            await pages[0].button('Revenir à mon salon réservé');
            await until(() => pages[0].evaluate('document.querySelector(".score-victory")?.textContent.includes("Partie terminée")'), 'scores préservés après match');
            assert.equal(await pages[0].evaluate('document.querySelector(".ready-toggle")===null && document.querySelector(".start-button")===null'), true, 'Aucune invitation à relancer une partie terminée');
          }
          console.log(`PASS navigateur : ${mode} ${count} joueurs, deux manches complètes, résultat final${realTimer ? ', minuterie réelle 15 s' : ', horloge serveur de test'}`);
          report.push({ mode, count, completeMatch: true, rounds: 2, clock: realTimer ? 'real-15-seconds' : 'injected-server-clock' });
        }
      }
    } finally {
      await Promise.all(pages.map((p) => p.close())); await new Promise((r) => server.io.close(r));
    }
  }
  if (!layoutOnly && !process.argv.includes('--teams-only') && !pickupOnly) await interactions(chrome, screenshots);
  if (!layoutOnly && !process.argv.includes('--teams-only') && !pickupOnly) await freeTable(chrome, screenshots);
  if (!layoutOnly && !process.argv.includes('--teams-only') && !pickupOnly) await overlappingBrowser(chrome, screenshots);
  if (!layoutOnly && !process.argv.includes('--teams-only')) await pickupReturnBrowser(chrome, screenshots);
  assert.deepEqual(chrome.errors, []);
  await writeFile(new URL('browser-report.json', screenshots), JSON.stringify(report, null, 2));
} finally { await chrome.close(); }
