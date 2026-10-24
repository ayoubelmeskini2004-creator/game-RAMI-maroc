import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { matchScenario, physicalCards } from '../test-support/match-scenarios.js';

for (const [mode, count] of [['individual', 2], ['individual', 3], ['individual', 4], ['teams', 4]]) {
  test(`complete ${mode} match with ${count} real Socket.IO clients: full deals, legal turns, two rounds, final result and privacy`, { timeout: 15000 }, async (t) => {
    const scenario = matchScenario(mode); let engine, job, time = 10000;
    const decks = new Map();
    const server = createApp({ makeRound: (...args) => { engine = scenario.makeRound(...args); decks.set(engine.roundId, physicalCards(engine)); return engine; },
      now: () => time, schedule: (fn) => { job = fn; return 1; }, unschedule: () => { job = null; } });
    const clients = [];
    t.after(async () => { clients.forEach((p) => p.socket.disconnect()); await new Promise((r) => server.io.close(r)); });
    server.httpServer.listen(0, '127.0.0.1'); await once(server.httpServer, 'listening');
    const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    const raw = (s, event, data = {}) => s.timeout(2000).emitWithAck(event, data);
    for (let i = 0; i < count; i++) {
      const socket = connect(url, { transports: ['websocket'], reconnection: false }); await once(socket, 'connect');
      const result = await raw(socket, i ? 'room:join' : 'room:create', { name: `Joueur ${i + 1}`, mode, threshold: mode === 'teams' ? 450 : 300, code: clients[0]?.room.code });
      assert.equal(result.ok, true); clients.push({ socket, ...result });
      if (mode === 'teams') await raw(socket, 'player:team', { team: i < 2 ? 'A' : 'B' });
    }
    // Validate every game broadcast, not just the final snapshot.
    for (const p of clients) p.socket.on('game:update', ({ game }) => {
      const text = JSON.stringify(game);
      for (const other of clients) assert.equal(text.includes(other.token), false);
      const publicIds = new Set([game.discardTop?.id, ...game.hand.map((c) => c.id),
        ...Object.values(game.laid).flat().flatMap((g) => g.cards.map((c) => c.id)),
        ...game.staged.flatMap((g) => g.cards.map((c) => c.id)),
        ...game.collages.flatMap((o) => o.group.cards.map((c) => c.id)),
        ...game.recoveries.flatMap((r) => [r.jokerId, r.replacementCardId])]);
      for (const card of decks.get(game.roundId)) if (!publicIds.has(card.id)) assert.equal(text.includes(card.id), false);
      assert.equal(game.turnUndo, undefined); assert.equal(game.turnBaseHand, undefined); assert.equal(game.stock, undefined);
    });
    for (const p of clients) await raw(p.socket, 'player:ready', { ready: true });
    assert.equal((await raw(clients[0].socket, 'room:start')).ok, true);
    let starter;
    const act = async (p, event, data) => {
      const response = await raw(p.socket, event, { roundId: engine.roundId, revision: engine.revision, ...data });
      assert.equal(response.ok, true, `${event}: ${response.error}`);
      const cards = physicalCards(engine); assert.equal(cards.length, 108); assert.equal(new Set(cards.map((c) => c.id)).size, 108);
      return response.game;
    };
    for (let round = 1; round <= 2; round++) {
      const plan = scenario.plans.get(engine.roundId);
      assert.equal(engine.round, round);
      if (starter) assert.equal(engine.starterId, engine.order[(engine.order.indexOf(starter) + 1) % count]); starter = engine.starterId;
      for (const id of engine.order) assert.equal(engine.hands[id].length, id === starter ? 15 : 14);
      let steps = 0;
      while (!engine.roundResult && steps++ < 40) {
        const p = clients.find((p) => p.playerId === engine.activePlayerId), opponent = clients.find((other) => other !== p);
        const before = structuredClone(engine);
        assert.equal((await raw(opponent.socket, 'game:draw', { roundId: engine.roundId, revision: engine.revision, source: 'stock' })).error, 'Coup invalide');
        assert.deepEqual(engine, before);
        if (engine.initialDiscard) {
          assert.equal((await raw(p.socket, 'game:stage', { roundId: engine.roundId, revision: engine.revision, groups: plan.groups })).error, 'Coup invalide');
          await act(p, 'game:discard', { cardId: plan.firstDiscardId }); continue;
        }
        if(engine.mustDiscard[p.playerId]) await act(p,'game:discard',{cardId:engine.hands[p.playerId].at(-1).id});
        const beforeHand=new Set(engine.hands[p.playerId].map(c=>c.id));
        await act(p,'game:draw',{source:'stock'});
        const drawn=engine.hands[p.playerId].find(c=>!beforeHand.has(c.id));
        assert.notEqual(engine.activePlayerId,p.playerId);assert.equal(engine.mustDiscard[p.playerId],true);
        if(mode==='teams'&&p.playerId===plan.opener&&!engine.opened[p.playerId]) await act(p,'game:stage',{groups:plan.ordinary});
        else if(p.playerId===plan.winner&&(mode!=='teams'||engine.opened[plan.opener])) {
          await act(p,'game:stage',{groups:plan.groups});await act(p,'game:undo',{all:true});await act(p,'game:stage',{groups:plan.groups});
          if(mode==='teams'){const target=engine.laid[plan.opener].find(g=>g.type==='suite'&&g.cards[0].suit==='hearts');await act(p,'game:collage',{ownerId:plan.opener,groupId:target.id,cardIds:[plan.collageId]});}
          await act(p,'game:discard',{cardId:mode==='teams'?drawn.id:plan.endId});continue;
        }
        await act(p,'game:discard',{cardId:drawn.id});

      }
      assert.ok(engine.roundResult); assert.equal(engine.roundResult.winnerId, plan.winner);
      const view = (await raw(clients[0].socket, 'game:state')).game;
      assert.equal(view.match.history.length, round); assert.equal(view.match.finished, round === 2);
      if (mode === 'teams') { assert.equal(view.match.history.at(-1).teamPenalties.A, engine.hands[plan.opener].length * 10); assert.equal(engine.openingInheritedFrom[plan.winner], plan.opener); }
      if (round === 1) { assert.equal(view.match.nextRoundAt, time + 15000); time += 15000; const next = job; job = null; next(); }
      else { assert.equal(job, null); assert.equal(view.match.winner, mode === 'teams' ? 'A' : plan.winner); }
    }
  });
}
