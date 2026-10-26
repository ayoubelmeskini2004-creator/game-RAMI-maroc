import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createApp } from '../server/src/app.js';
import { createRound, buildDeck } from '../server/src/game.js';
import { startTurnStaging } from '../server/src/descente.js';
import { validateCombination } from '../server/src/combinations.js';
import { physicalCards } from '../server/test-support/match-scenarios.js';
import { until } from './browser-support.mjs';

export async function interactions(chrome, artifacts) {
  for (const discardOpening of [false, true]) {
    let engine, source, own, natural, seven, wrong, end, reuse, proposals;
    const server = createApp({ makeRound: (order) => {
      engine = createRound(order); engine.stock = buildDeck(); engine.hands = Object.fromEntries(order.map((id) => [id, []]));
      engine.activePlayerId = order[0]; engine.initialDiscard = false;
      const take = (rank, suit = 'hearts') => engine.stock.splice(engine.stock.findIndex((c) => c.rank === rank && c.suit === (rank === 'Joker' ? null : suit)), 1)[0];
      const hand = (rank, suit) => { const c = take(rank, suit); engine.hands[order[0]].push(c); return c; };
      function group(type, ranks, suits, face, ownerId) {
        const cards = ranks.map((rank, i) => take(rank, Array.isArray(suits) ? suits[i] : suits));
        const joker = cards.find((c) => c.rank === 'Joker');
        const proposal = { type, cardIds: cards.map((c) => c.id), ...(joker ? { joker: { cardId: joker.id, ...face } } : {}) };
        if (!ownerId) engine.hands[order[0]].push(...cards);
        else {
          const result = validateCombination(proposal, cards); assert.equal(result.valid, true);
          const group = { id: `group-${ownerId}-${suits}`, type, cards: result.cards }; engine.laid[ownerId].push(group); return group;
        }
        return proposal;
      }
      if (discardOpening) {
        engine.phase = 'draw'; engine.mustDiscard=Object.fromEntries(order.map(id=>[id,false])); engine.contextPlayerId=null;
        proposals = [group('suite', ['8', '9', '10'], 'hearts'), group('tierce', ['R', 'R', 'R'], ['clubs', 'diamonds', 'spades']), group('suite', ['4', '5', '6'], 'clubs')];
        const a = hand('A', 'diamonds'), two = hand('2', 'diamonds'), top = take('3', 'diamonds'); engine.discard.push(top);
        proposals.push({ type: 'suite', cardIds: [a.id, two.id, top.id] }); end = hand('2', 'spades');
        while (engine.hands[order[0]].length < 14) engine.hands[order[0]].push(engine.stock.pop());
      } else {
        engine.opened[order[0]] = true; engine.opened[order[1]] = true;
        engine.openingTotals = { [order[0]]: 71, [order[1]]: 120 }; engine.firstOpening = { playerId: order[0], total: 71 };
        own = group('suite', ['8', '9', '10'], 'clubs', null, order[0]);
        source = group('suite', ['8', 'Joker', '10'], 'hearts', { rank: '9', suit: 'hearts' }, order[1]);
        natural = hand('9'); seven = hand('7', 'clubs'); wrong = hand('3'); end = hand('2', 'spades');
        const four = hand('4', 'diamonds'), six = hand('6', 'diamonds');
        reuse = { type: 'suite', cardIds: [four.id, source.cards[1].id, six.id], joker: { cardId: source.cards[1].id, rank: '5', suit: 'diamonds' } };
        startTurnStaging(engine, order[0]);
      }
      while (engine.hands[order[1]].length < 14) engine.hands[order[1]].push(engine.stock.pop());
      return engine;
    } });
    // Deliberately delay acknowledgements after broadcasts to exercise the pending-selection race.
    server.io.on('connection', (socket) => socket.use((packet, next) => {
      if (['game:collage', 'game:joker-recover'].includes(packet[0])) { const ack = packet[2]; packet[2] = (response) => setTimeout(() => ack(response), 600); }
      next();
    }));
    const pages = [];
    try {
      server.httpServer.listen(0, '127.0.0.1'); await once(server.httpServer, 'listening');
      const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
      for (let i = 0; i < 2; i++) {
        const p = await chrome.page(origin, 1280, 820); pages.push(p);
        await until(() => p.evaluate('document.querySelector("#name")?.disabled===false'), 'bienvenue');
        await p.fill('#name', i ? 'Sara' : 'Hamza au nom très long');
        if (!i) await p.click('form button[type="submit"]');
        else { await p.fill('#code', await pages[0].evaluate('document.querySelector(".room-code").textContent')); await p.click('.join button'); }
        await until(() => p.evaluate('!!document.querySelector(".room-code")'), 'salon');
      }
      for(const p of pages){await p.click('.ready-toggle');await until(()=>p.evaluate('document.querySelector(".ready-toggle")?.getAttribute("aria-pressed")==="true"'),'préparation acquittée');} await pages[0].click('.start-button');
      const [actor, observer] = pages; await until(() => actor.evaluate('!!document.querySelector(".own-hand .hand-card-button")'), 'table');
      if (!discardOpening) {
        const handIds = () => actor.evaluate('[...document.querySelectorAll(".own-hand .hand-card-button")].map(e=>e.dataset.cardId)');
        const original = await handIds(); const revision = engine.revision;
        const otherHand = await observer.evaluate('[...document.querySelectorAll(".own-hand .hand-card-button")].map(e=>e.dataset.cardId)');
        await actor.drag('.own-hand .hand-card-button:first-child', '.own-hand .hand-card-button:last-child', { insertion: true });
        await until(async () => JSON.stringify(await handIds()) !== JSON.stringify(original), 'rangement manuel natif');
        const manual = await handIds();
        assert.equal(engine.revision, revision, 'Le rangement ne produit aucun coup serveur');
        assert.deepEqual(engine.hands[engine.order[0]].map(c=>c.id), original);
        assert.deepEqual(await observer.evaluate('[...document.querySelectorAll(".own-hand .hand-card-button")].map(e=>e.dataset.cardId)'), otherHand);
        await actor.cdp('Page.reload');
        await until(() => actor.evaluate('!!document.querySelector(".own-hand .hand-card-button")'), 'reconnexion après rangement');
        assert.deepEqual(await handIds(), manual, 'Ordre manuel restauré après reconnexion');
        await actor.button('Tri automatique');
        const { automaticOrder } = await import('../client/src/table/hand-order.js');
        await until(async () => JSON.stringify(await handIds()) === JSON.stringify(automaticOrder(engine.hands[engine.order[0]])), 'tri automatique');
        const automatic = await handIds();
        await actor.cdp('Page.reload');
        await until(() => actor.evaluate('!!document.querySelector(".own-hand .hand-card-button")'), 'reconnexion après tri');
        assert.deepEqual(await handIds(), automatic);
        assert.equal(engine.revision, revision);
        // Restore the original local order for the existing index-based gameplay scenarios.
        const key = `rami71.hand:${engine.order[0]}:${engine.roundId}`;
        await actor.evaluate(`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(JSON.stringify(original))})`);
        await actor.cdp('Page.reload');
        await until(() => actor.evaluate('!!document.querySelector(".own-hand .hand-card-button")'), 'restauration du scénario');
        console.log('PASS navigateur : rangement manuel natif, tri automatique privé et reconnexion');
      }
      const conserve = () => { const cards = physicalCards(engine); assert.equal(cards.length, 108); assert.equal(new Set(cards.map((c) => c.id)).size, 108); };
      const pick = async (id) => {
        const index = engine.hands[engine.order[0]].findIndex((c) => c.id === id); assert.ok(index >= 0);
        const selector = `.own-hand [data-card-id="${id}"]`;
        await until(() => actor.evaluate(`document.querySelectorAll('.own-hand .hand-card-button').length===${engine.hands[engine.order[0]].length} && document.querySelector(${JSON.stringify(selector)})?.disabled===false`), 'main acquittée');
        await actor.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      };
      const change = async (action, label) => { const revision = engine.revision; await action(); await until(() => engine.revision > revision, label); conserve(); };
      const compose = async (groups, fromDiscard = false) => {
        await (fromDiscard ? actor.click('[aria-label="Prendre la dernière carte de la défausse"]') : actor.button('Descendre', '.table-actions'));
        await until(() => actor.evaluate('!!document.querySelector(".descente-composer")'), 'composeur');
        let available = [...engine.hands[engine.order[0]].map((c) => c.id), ...(fromDiscard ? [engine.discard.at(-1).id] : [])];
        for (const group of groups) {
          await actor.fill('.composer-fields select', group.type, true);
          for (const id of group.cardIds) await actor.click(`.composer-card:nth-child(${available.indexOf(id) + 1})`);
          if (group.joker) {
            await actor.fill('.composer-fields label:nth-child(2) select', group.joker.rank, true);
            await actor.fill('.composer-fields label:nth-child(3) select', group.joker.suit, true);
          }
          await actor.button('Ajouter au projet', '.descente-composer'); available = available.filter((id) => !group.cardIds.includes(id));
        }
        await change(() => actor.button(fromDiscard ? 'Prendre et descendre' : 'Descendre', '.descente-composer'), 'descente acceptée');
        await until(() => actor.evaluate('!document.querySelector(".descente-composer")'), 'projet fermé');
      };
      if (discardOpening) {
        const baseline = structuredClone(engine.hands[engine.order[0]]);
        await change(()=>actor.click('[aria-label="Prendre la dernière carte de la défausse"]'),'prise en main avant ouverture');
        assert.equal(engine.opened[engine.order[0]],false);
        await compose(proposals);
        await change(()=>actor.button('Tout annuler','.undo-actions'),'annuler les poses sans rendre la prise');
        await pick(end.id);
        assert.equal(await actor.evaluate('[...document.querySelectorAll(".table-actions button")].find(b=>b.textContent==="Défausser").disabled'),true,'prise inutilisée interdit la défausse');
        await pick(end.id);await compose(proposals);await pick(end.id);await change(()=>actor.button('Défausser','.table-actions'),'ouverture engagée à sa défausse');
        assert.equal(engine.opened[engine.order[0]], true); assert.equal(engine.firstOpening.total, 78);
        assert.notEqual(engine.activePlayerId,engine.order[0]);assert.equal(engine.staged.length,0);
        console.log('PASS navigateur : prise Défausse en main, ouverture après prise, undo et engagement personnel');

        continue;
      }
      const baseline = structuredClone(engine.hands[engine.order[0]]);
      const recoveryClick = async () => { await pick(natural.id); await change(() => actor.click(`[data-group-id="${source.id}"] .joker-target`), 'récupération par clic'); };
      await pick(wrong.id); await actor.click(`[data-group-id="${source.id}"] .joker-target`);
      await until(() => actor.evaluate('document.querySelector(".match-error")?.textContent==="Coup invalide"'), 'mauvais remplacement refusé');
      assert.deepEqual(engine.hands[engine.order[0]], baseline);
      for (const [width, height] of [[1440, 900], [1280, 820]]) {
        await actor.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        assert.ok(await actor.evaluate('document.querySelector(".table-actions").getBoundingClientRect().bottom<=innerHeight'), 'commandes visibles avec Coup invalide');
        assert.ok(await actor.evaluate('document.querySelector(".turn-status").getBoundingClientRect().bottom < document.querySelector(".seat-bottom .seat-identity").getBoundingClientRect().top'), 'statut de tour lisible au-dessus de la main');
        const geometry = await actor.evaluate('({piles:document.querySelector(".table-center").getBoundingClientRect().bottom,pilesTop:document.querySelector(".table-center").getBoundingClientRect().top,topSeat:document.querySelector(".seat-top").getBoundingClientRect().bottom,statusTop:document.querySelector(".turn-status").getBoundingClientRect().top,statusBottom:document.querySelector(".turn-status").getBoundingClientRect().bottom,identity:document.querySelector(".seat-bottom .seat-identity").getBoundingClientRect().top})');
        assert.ok(geometry.piles <= geometry.statusTop, `piles et statut sans chevauchement (${width}×${height} : ${JSON.stringify(geometry)})`);
        assert.ok(geometry.topSeat <= geometry.pilesTop, `poses du joueur opposé et piles sans chevauchement (${width}×${height} : ${JSON.stringify(geometry)})`);
        const shot = await actor.cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(new URL(`error-${width}.png`, artifacts), Buffer.from(shot.data, 'base64'));
      }
      // Clear the wrong selection, then test selection+click Collage with a delayed ack.
      await pick(wrong.id); await pick(seven.id);
      await change(() => actor.button('Coller ici', `[data-group-id="${own.id}"]`), 'collage par clic');
      await until(() => actor.evaluate('[...document.querySelectorAll(".own-hand button")].every(b=>b.disabled)'), 'main verrouillée avant acquittement');
      await until(() => actor.evaluate('document.querySelector(".own-hand button")?.disabled===false'), 'acquittement reçu');
      await until(() => observer.evaluate('document.querySelectorAll(".newly-laid-card").length===1'), 'collage public en direct');
      await recoveryClick(); await change(() => actor.button('Annuler', '.undo-actions'), 'annuler uniquement récupération');
      assert.equal(engine.recoveries.length, 0); assert.equal(engine.collages.length, 1);
      await recoveryClick(); await change(() => actor.button('Tout annuler', '.undo-actions'), 'restaurer toute la main et les Jokers');
      assert.deepEqual(engine.hands[engine.order[0]], baseline); assert.equal(engine.collages.length, 0);
      await recoveryClick(); await actor.button('Rétablir le Joker', `[data-group-id="${source.id}"]`);
      await until(() => engine.recoveries.length === 0, 'inversion précise');
      await change(() => actor.button('Annuler', '.undo-actions'), 'annuler inversion');
      assert.equal(engine.recoveries.length, 1);
      await change(() => actor.button('Annuler', '.undo-actions'), 'rétablir avant glisser-déposer');
      await until(() => actor.evaluate('document.querySelector(".own-hand button")?.disabled===false'), 'main disponible');
      await change(() => actor.drag(`.own-hand [data-card-id="${natural.id}"]`, `[data-group-id="${source.id}"] .joker-target`), 'récupération par drag natif Chrome');
      await until(() => actor.evaluate('document.querySelector(".own-hand button")?.disabled===false'), 'acquittement de récupération');
      const jokerId = source.cards[1].id;
      const revisionBeforeOrder = engine.revision;
      await actor.drag(`.own-hand [data-card-id="${jokerId}"]`, '.own-hand .hand-card-button:first-child', { insertion: true });
      assert.equal(engine.revision, revisionBeforeOrder, 'Ranger un Joker ne le joue pas');
      const orderBeforeStage = await actor.evaluate('[...document.querySelectorAll(".own-hand button")].map(e=>e.dataset.cardId)');
      assert.ok(orderBeforeStage.indexOf(jokerId) < orderBeforeStage.length - 1);
      await actor.button('Descendre', '.table-actions');
      await until(() => actor.evaluate('!!document.querySelector(".descente-composer")'), 'brouillon local avant interruption');
      const beforeReconnect = structuredClone(engine);
      const connections = server.io.sockets.sockets.size;
      // The actor reloaded during the ordering test and now owns the newest socket.
      [...server.io.sockets.sockets.values()].at(-1).conn.close();
      await until(() => server.io.sockets.sockets.size === connections - 1, 'interruption du transport observée');
      await until(() => server.io.sockets.sockets.size === connections && actor.evaluate('document.querySelector(".own-hand button")?.disabled===false'), 'reconnexion automatique pendant récupération');
      assert.equal(await actor.evaluate('document.querySelector(".descente-composer")===null'), true, 'Le brouillon périmé est fermé à la reconnexion');
      assert.deepEqual(engine, beforeReconnect); conserve();
      assert.equal(await observer.evaluate('document.querySelector(".seat-bottom .seat-meta").textContent.includes("Hôte")'), true);
      assert.equal(await actor.evaluate('document.querySelector(".seat-bottom .seat-meta").textContent.includes("Hôte")'), false);
      await pick(source.cards[1].id);
      assert.equal(await actor.evaluate('[...document.querySelectorAll(".table-actions button")].find(b=>b.textContent==="Défausser").disabled'), true);
      await pick(source.cards[1].id); await compose([reuse]);
      const stagedId = engine.staged[0].id; await actor.click(`[data-group-id="${stagedId}"] .group-select`);
      await change(() => actor.button('Reprendre', '.table-actions'), 'reprendre le Joker rejoué');
      await until(async () => JSON.stringify(await actor.evaluate('[...document.querySelectorAll(".own-hand button")].map(e=>e.dataset.cardId)')) === JSON.stringify(orderBeforeStage), 'ordre manuel conservé après pose et reprise');
      await pick(end.id); await actor.button('Défausser', '.table-actions');
      await until(() => actor.evaluate('document.querySelector(".match-error")?.textContent.startsWith("Rejouez tous les Jokers")'), 'réemploi obligatoire refusé à la défausse');
      await pick(end.id); await compose([reuse]); await pick(end.id); await change(() => actor.button('Défausser', '.table-actions'), 'commit après réemploi');
      assert.equal(engine.recoveries.length, 0); assert.equal(engine.staged.length, 0); assert.equal(engine.laid[engine.order[1]][0].cards[1].id, natural.id); conserve();
      for (const p of pages) assert.equal(await p.evaluate('document.querySelectorAll(".opponent-hand .card-face").length'), 0);
      await actor.button('Quitter le salon'); await until(() => actor.evaluate('!!document.querySelector(".leave-dialog")'), 'confirmation de départ');
      assert.equal(await actor.evaluate('document.querySelector(".leave-dialog").textContent.includes("identité reste réservée")'), true);
      await actor.button('Quitter le salon', '.leave-dialog'); await until(() => observer.evaluate('document.body.textContent.includes("Manche annulée")'), 'retour commun au salon');
      await actor.button('Revenir à mon salon réservé'); await until(() => actor.evaluate('document.body.textContent.includes("Manche annulée")'), 'retour de l’identité originale');
      await actor.button('Quitter le salon'); await until(() => actor.evaluate('!!document.querySelector(".leave-dialog")'), 'confirmation depuis salon réservé');
      assert.equal(await actor.evaluate('document.querySelector(".leave-dialog").textContent.includes("identité reste réservée")'), true);
      await actor.button('Rester', '.leave-dialog');
      console.log('PASS navigateur : mauvais Joker/Coup invalide, clic et drag natif Chrome, ack retardé, undo, rétablissement, réemploi, confidentialité, reconnexion et départ réservé');
    } finally { await Promise.all(pages.map((p) => p.close())); await new Promise((r) => server.io.close(r)); }
  }
}
