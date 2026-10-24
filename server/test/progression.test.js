import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { createRound, buildDeck } from '../src/game.js';
import { startTurnStaging } from '../src/descente.js';

function clock() {
  let time = 100000, serial = 0; const jobs = new Map();
  return { now: () => time, schedule: (fn, delay) => { const id = ++serial; jobs.set(id, { fn, due: time + delay }); return id; }, unschedule: (id) => jobs.delete(id),
    advance: (ms) => { time += ms; for (const [id, job] of [...jobs]) if (job.due <= time) { jobs.delete(id); job.fn(); } }, jobs };
}
function finishable(order, previous) {
  if (previous) return createRound(order, previous);
  const game = createRound(order); game.stock = buildDeck(); game.hands = Object.fromEntries(order.map((id) => [id, []]));
  game.starterId = order[0]; game.activePlayerId = order[0]; game.initialDiscard = false;
  game.opened[order[0]] = true; game.openingTotals[order[0]] = 90; game.firstOpening = { playerId: order[0], total: 90 };
  const j = game.stock.findIndex((c) => c.rank === 'Joker'); game.hands[order[0]].push(game.stock.splice(j, 1)[0]);
  for (const id of order.slice(1)) game.hands[id].push(game.stock.pop());
  startTurnStaging(game, order[0]); return game;
}
async function setup(t, options = {}) {
  const timer = clock(); const { httpServer, io } = createApp({ makeRound: finishable, ...timer, ...options });
  const clients = []; t.after(async () => { clients.forEach((c) => c.disconnect()); await new Promise((r) => io.close(r)); });
  httpServer.listen(0, '127.0.0.1'); await once(httpServer, 'listening');
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  const client = async () => { const c = connect(url, { transports: ['websocket'], reconnection: false }); clients.push(c); c.on('game:update', ({ game }) => { c.testRoundId = game.roundId; }); await once(c, 'connect'); return c; };
  const request = (c, event, data = {}) => c.timeout(2000).emitWithAck(event, event.startsWith('game:') && event !== 'game:state' ? { roundId: c.testRoundId, ...data } : data);
  const a = await client(), b = await client();
  const host = await request(a, 'room:create', { name: 'Hamza', mode: options.mode ?? 'individual', threshold: options.threshold ?? 500 });
  const guest = await request(b, 'room:join', { name: 'Sara', code: host.room.code });
  const ready = async (sockets = [a, b]) => { for (const c of sockets) assert.equal((await request(c, 'player:ready', { ready: true })).ok, true); };
  const finish = async (socket = a) => { const state = (await request(socket, 'game:state')).game; return request(socket, 'game:discard', { revision: state.revision, cardId: state.hand[0].id, scores: { forged: -1000 } }); };
  return { timer, client, request, host, guest, a, b, ready, finish };
}
const update = (socket, predicate) => new Promise((resolve) => { const listener = (data) => { if (predicate(data.game)) { socket.off('game:update', listener); resolve(data.game); } }; socket.on('game:update', listener); });
function conserve(game) {
  assert.equal(game.stockCount + game.discardCount + Object.values(game.counts).reduce((a, b) => a + b, 0) + Object.values(game.laid).flat().reduce((n, g) => n + g.cards.length, 0), 108);
}

test('only host can set a synchronized positive lobby threshold, and changes clear readiness', { timeout: 10000 }, async (t) => {
  const { request, a, b, ready } = await setup(t); await ready();
  for (const threshold of [0, -1, 2.5, '100', null, 1000000001]) assert.equal((await request(a, 'room:threshold', { threshold })).ok, false);
  assert.equal((await request(b, 'room:threshold', { threshold: 100 })).ok, false);
  const result = await request(a, 'room:threshold', { threshold: 200 });
  assert.equal(result.room.threshold, 200); assert.equal(result.room.players.every((p) => !p.ready), true);
  await ready(); await request(a, 'room:start'); assert.equal((await request(a, 'room:threshold', { threshold: 300 })).ok, false);
  assert.equal((await request(b, 'game:state')).game.match.threshold, 200);
});

test('final discard scores once, synchronizes a 15-second deadline, resumes countdown and auto-deals clockwise without Ready', { timeout: 10000 }, async (t) => {
  const { timer, request, a, b, host, client, ready, finish } = await setup(t); await ready(); await request(a, 'room:start');
  let broadcast = update(b, (g) => g.phase === 'round-ended');
  const ended = await finish(); assert.equal(ended.ok, true); const witness = await broadcast;
  assert.equal(witness.match.history.length, 1); assert.equal(witness.match.history[0].penalties[host.playerId], 0);
  assert.equal(witness.match.nextRoundAt, timer.now() + 15000); assert.equal(timer.jobs.size, 1); conserve(witness);
  assert.equal((await request(a, 'game:discard', { revision: ended.game.revision, cardId: 'x' })).error, 'Coup invalide');
  timer.advance(7000); a.disconnect(); const replacement = await client(); const resumed = await request(replacement, 'room:resume', { token: host.token });
  assert.equal(resumed.game.match.nextRoundAt - resumed.game.match.serverNow, 8000); assert.equal(resumed.game.match.history.length, 1);
  timer.advance(7999); assert.equal((await request(b, 'game:state')).game.round, 1);
  broadcast = update(b, (g) => g.round === 2); timer.advance(1); const next = await broadcast;
  assert.equal(next.starterId, next.order[1]); assert.equal(next.counts[next.starterId], 15);
  assert.equal(next.counts[next.order[0]], 14); assert.equal(next.initialDiscard, true); assert.equal(next.discardCount, 0); conserve(next);
  assert.equal(next.match.history.length, 1); assert.equal(next.match.nextRoundAt, null);
  const mine = (await request(replacement, 'game:state')).game;
  for (const c of mine.hand) assert.equal(JSON.stringify(next).includes(c.id), false);
});

test('threshold ends match with lowest score, without scheduling or allowing another round', { timeout: 10000 }, async (t) => {
  const { timer, request, a, b, host, ready, finish } = await setup(t, { threshold: 100 }); await ready(); await request(a, 'room:start');
  const result = await finish(); assert.equal(result.ok, true); assert.equal(result.game.match.finished, true);
  assert.equal(result.game.match.winner, host.playerId); assert.equal(result.game.match.nextRoundAt, null); assert.equal(timer.jobs.size, 0);
  timer.advance(60000); assert.equal((await request(b, 'game:state')).game.round, 1);
  assert.equal((await request(a, 'room:start')).ok, false); assert.equal((await request(a, 'game:draw', { source: 'stock', revision: result.game.revision })).error, 'Coup invalide');
});

test('explicit departure cancels an active round, preserves history, transfers host and requires the original reserved identity', { timeout: 10000 }, async (t) => {
  const { timer, request, a, b, host, guest, client, ready, finish } = await setup(t); await ready(); await request(a, 'room:start'); await finish();
  let broadcast = update(b, (g) => g.round === 2); timer.advance(15000); const next = await broadcast;
  const departedRoom = once(b, 'room:update'); const left = await request(a, 'room:leave'); const [lobby] = await departedRoom;
  assert.equal(left.reserved, true); assert.equal(lobby.status, 'lobby'); assert.equal(lobby.game, null); assert.equal(lobby.hostId, guest.playerId);
  assert.equal(lobby.match.history.length, 1); assert.equal(lobby.players.find((p) => p.id === host.playerId).departed, true);
  assert.equal(lobby.players.every((p) => !p.ready), true); assert.equal((await request(b, 'room:start')).ok, false);
  const newcomer = await client(); assert.equal((await request(newcomer, 'room:join', { name: 'Remplaçant', code: lobby.code })).ok, false);
  const resumed = await request(newcomer, 'room:resume', { token: host.token }); assert.equal(resumed.playerId, host.playerId);
  assert.equal(resumed.room.players.length, 2); assert.equal(resumed.room.players[0].departed, false);
  await ready([b, newcomer]); const restarted = await request(b, 'room:start'); assert.equal(restarted.ok, true);
  const fresh = (await request(newcomer, 'game:state')).game; assert.equal(fresh.round, 2); assert.equal(fresh.starterId, next.starterId);
  assert.deepEqual(fresh.match.history, lobby.match.history); conserve(fresh);
});

test('departure during the scoreboard cancels the timer, keeps completed results and all departed players can return', { timeout: 10000 }, async (t) => {
  const { timer, request, a, b, host, guest, client, ready, finish } = await setup(t); await ready(); await request(a, 'room:start'); const completed = await finish();
  await request(a, 'room:leave'); assert.equal(timer.jobs.size, 0); await request(b, 'room:leave'); timer.advance(30000);
  const first = await client(), second = await client(); const resumed = await request(first, 'room:resume', { token: host.token });
  assert.equal(resumed.ok, true); assert.equal(resumed.room.hostId, host.playerId); assert.equal(resumed.room.match.history.length, 1);
  assert.deepEqual(resumed.room.match.totals, completed.game.match.totals);
  assert.equal((await request(second, 'room:resume', { token: guest.token })).ok, true);
  await ready([first, second]); await request(first, 'room:start'); const game = (await request(first, 'game:state')).game;
  assert.equal(game.round, 2); assert.equal(game.match.history.length, 1); conserve(game);
});

test('cancelling the first attempt records no penalties and replays its original starter and round number', { timeout: 10000 }, async (t) => {
  const { request, a, b, host, client, ready } = await setup(t, { makeRound: createRound });
  await ready(); await request(a, 'room:start'); const original = (await request(a, 'game:state')).game;
  await request(a, 'room:leave'); const socket = await client(); const resumed = await request(socket, 'room:resume', { token: host.token });
  assert.deepEqual(resumed.room.match.history, []); assert.deepEqual(Object.values(resumed.room.match.totals), [0, 0]);
  await ready([b, socket]); assert.equal((await request(b, 'room:start')).ok, true);
  const replay = (await request(socket, 'game:state')).game; assert.equal(replay.round, 1); assert.equal(replay.starterId, original.starterId);
  assert.equal(replay.counts[replay.starterId], 15); conserve(replay);
});

test('replayed deals reject old/missing round IDs and simultaneous duplicate draws mutate only once', { timeout: 10000 }, async (t) => {
  const { request, a, b, host, guest, client, ready } = await setup(t, { makeRound: createRound });
  await ready(); await request(a, 'room:start');
  let state = (await request(a, 'game:state')).game;
  const players = new Map([[host.playerId, a], [guest.playerId, b]]);
  const starter = players.get(state.starterId);
  let initial = (await request(starter, 'game:state')).game;
  state = (await request(starter, 'game:discard', { revision: initial.revision, cardId: initial.hand[0].id })).game;
  const stale = { roundId: state.roundId, revision: state.revision, source: 'stock' };
  const activeId = state.activePlayerId;
  await request(a, 'room:leave'); const returned = await client(); await request(returned, 'room:resume', { token: host.token }); players.set(host.playerId, returned);
  await ready([b, returned]); await request(b, 'room:start');
  initial = (await request(players.get(state.starterId), 'game:state')).game;
  state = (await request(players.get(state.starterId), 'game:discard', { revision: initial.revision, cardId: initial.hand[0].id })).game;
  assert.equal(state.activePlayerId, activeId); assert.equal(state.revision, stale.revision); assert.notEqual(state.roundId, stale.roundId);
  const actor = players.get(activeId), before = (await request(actor, 'game:state')).game;
  assert.equal((await request(actor, 'game:draw', stale)).error, 'Coup invalide');
  assert.equal((await request(actor, 'game:draw', { ...stale, roundId: undefined })).error, 'Coup invalide');
  assert.deepEqual((await request(actor, 'game:state')).game.hand, before.hand);
  const payload = { ...stale, roundId: state.roundId };
  const results = await Promise.all([request(actor, 'game:draw', payload), request(actor, 'game:draw', payload)]);
  assert.equal(results.filter((r) => r.ok).length, 1); assert.equal(results.filter((r) => r.error === 'Coup invalide').length, 1);
  const final = (await request(actor, 'game:state')).game;
  assert.equal(final.stockCount, before.stockCount - 1); assert.equal(final.hand.length, before.hand.length + 1); conserve(final);
});

test('2v2 team victory sums both teammates and threshold uses team cumulative penalties', { timeout: 10000 }, async (t) => {
  const { timer, request, a, b, host, client, ready, finish } = await setup(t, { mode: 'teams', threshold: 200 });
  const c = await client(), d = await client(); await request(c, 'room:join', { name: 'Amine', code: host.room.code }); await request(d, 'room:join', { name: 'Lina', code: host.room.code });
  for (const [i, socket] of [a, b, c, d].entries()) await request(socket, 'player:team', { team: i < 2 ? 'A' : 'B' });
  await ready([a, b, c, d]); await request(a, 'room:start'); const result = await finish();
  assert.equal(result.game.match.finished, true); assert.equal(result.game.match.winner, 'A');
  assert.deepEqual(result.game.match.history[0].teamPenalties, { A: 100, B: 200 }); assert.equal(result.game.roundResult.winnerTeam, 'A');
  assert.equal(timer.jobs.size, 0); conserve(result.game);
});

test('lowest-total tie at the threshold automatically deals an extra round and only ends when broken', { timeout: 10000 }, async (t) => {
  const { timer, request, a, b, host, client, ready, finish } = await setup(t, { threshold: 100, makeRound: (order, previous) => {
    const game = createRound(order, previous); game.stock = buildDeck(); game.hands = Object.fromEntries(order.map((id) => [id, []]));
    game.activePlayerId = order[0]; game.initialDiscard = false; game.opened[order[0]] = true; game.opened[order[1]] = true;
    game.openingTotals[order[0]] = 90; game.openingTotals[order[1]] = 80;
    game.hands[order[0]].push(game.stock.pop()); if (previous) game.hands[order[1]].push(game.stock.pop());
    game.hands[order[2]].push(game.stock.pop()); startTurnStaging(game, order[0]); return game;
  } });
  const third = await client(); await request(third, 'room:join', { name: 'Lina', code: host.room.code });
  await ready([a, b, third]); await request(a, 'room:start'); const first = await finish();
  assert.equal(first.game.match.tied, true); assert.equal(first.game.match.finished, false); assert.equal(timer.jobs.size, 1);
  const broadcast = update(b, (g) => g.round === 2); timer.advance(15000); await broadcast;
  const second = await finish(); assert.equal(second.game.match.finished, true); assert.equal(second.game.match.winner, host.playerId);
  assert.equal(second.game.match.history.length, 2); assert.equal(timer.jobs.size, 0); conserve(second.game);
});
