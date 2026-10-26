import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { buildDeck, createRound } from '../src/game.js';
import { validateCombination } from '../src/combinations.js';
import { startTurnStaging } from '../src/descente.js';
import { effectiveGroup } from '../src/collage.js';

function assertInvalid(response) {
  assert.equal(response.ok,false);assert.equal(response.error,'Coup invalide');
  assert.ok(Object.keys(response).every(key=>['ok','error','reason'].includes(key)));
  if(response.reason!==undefined){assert.equal(typeof response.reason,'string');assert.ok(response.reason.length>10);}
}

function roomUpdate(socket, predicate) {
  return new Promise((resolve) => {
    function listener(room) {
      if (!predicate(room)) return;
      socket.off('room:update', listener);
      resolve(room);
    }
    socket.on('room:update', listener);
  });
}

// Exercise real legal cycles when returning to a player's next mandatory discard.
async function returnToDiscard(request, players, playerId) {
  for(let step=0;step<20;step++) {
    const shared=(await request(players[0].socket,'game:state')).game;
    if(shared.activePlayerId===playerId&&shared.phase==='discard') return (await request(players.find(p=>p.playerId===playerId).socket,'game:state')).game;
    const actor=players.find(p=>p.playerId===shared.activePlayerId);
    let state=(await request(actor.socket,'game:state')).game;
    if(state.phase==='discard') state=(await request(actor.socket,'game:discard',{cardId:state.hand.at(-1).id,revision:state.revision})).game;
    const result=await request(actor.socket,'game:draw',{source:'stock',revision:state.revision});assert.equal(result.ok,true);
  }
  throw Error('Turn did not return');
}

test('2v2 special discard opening, inherited Collage and Joker recovery synchronize, undo and reconnect atomically', { timeout: 10000 }, async (t) => {
  let engine, suite, reuse, end, additions, recovery, donorId, opponentId;
  const { request, create, join, client } = await setup(t, { makeRound: (order) => {
    engine = createRound(order); donorId = order[2]; opponentId = order[1];
    Object.assign(engine, { stock: buildDeck(), hands: Object.fromEntries(order.map((id) => [id, []])), activePlayerId: order[0],
      phase: 'draw', initialDiscard: false, opened: { [order[0]]: false, [order[1]]: true, [order[2]]: true, [order[3]]: false },
      openingTotals: { [order[1]]: 80, [order[2]]: 90 }, firstOpening: { playerId: order[1], total: 80 } });
    const take = (rank, suit = 'hearts') => engine.stock.splice(engine.stock.findIndex((c) => c.rank === rank && c.suit === (rank === 'Joker' ? null : suit)), 1)[0];
    function laid(ownerId, groupId, suit, withJoker = false) {
      const cards = ['8', withJoker ? 'Joker' : '9', '10'].map((rank) => take(rank, suit));
      const result = validateCombination({ type: 'suite', cardIds: cards.map((c) => c.id), ...(withJoker ? { joker: { cardId: cards[1].id, rank: '9', suit } } : {}) }, cards);
      engine.laid[ownerId].push({ id: groupId, type: 'suite', cards: result.cards }); return cards;
    }
    laid(donorId, 'partner', 'hearts'); laid(opponentId, 'opponent', 'clubs');
    const jokerSource = laid(opponentId, 'source', 'diamonds', true);
    const hand = [take('A'), take('2'), take('7'), take('7', 'clubs'), take('9', 'diamonds'), take('4', 'spades'), take('6', 'spades'), take('2', 'clubs')];
    engine.hands[order[0]].push(...hand); end = hand.at(-1);
    const top = take('3'); engine.discard.push(top);
    suite = { type: 'suite', cardIds: [hand[0].id, hand[1].id, top.id] };
    additions = [{ ownerId: donorId, groupId: 'partner', cardIds: [hand[2].id] }, { ownerId: opponentId, groupId: 'opponent', cardIds: [hand[3].id] }];
    recovery = { ownerId: opponentId, groupId: 'source', jokerId: jokerSource[1].id, cardId: hand[4].id };
    reuse = { type: 'suite', cardIds: [hand[5].id, jokerSource[1].id, hand[6].id], joker: { cardId: jokerSource[1].id, rank: '5', suit: 'spades' } };
    for (const id of order.slice(1)) while(engine.hands[id].length<14) engine.hands[id].push(engine.stock.pop());
    engine.mustDiscard = Object.fromEntries(order.map(id=>[id,false]));
    return engine;
  } });
  const actor = await create('teams'), players = [actor];
  for (const name of ['Sara', 'Amine', 'Lina']) players.push(await join(actor.room.code, name));
  for (const [i, p] of players.entries()) {
    await request(p.socket, 'player:team', { team: i < 2 ? 'A' : 'B' }); await request(p.socket, 'player:ready', { ready: true });
  }
  await request(actor.socket, 'room:start');
  const witness = players[2]; let state = (await request(actor.socket, 'game:state')).game;
  assert.equal(state.teamOpeningEligible, true); assert.equal(state.opened[actor.playerId], false);
  assert.deepEqual(state.collageTargets, []); assert.equal(state.canRecoverJoker, false);
  assert.equal(state.order[2], donorId); assert.equal(donorId, players[1].playerId);
  const baseline = structuredClone(state.hand);
  const pickup = async (socket) => request(socket, 'game:draw', { source: 'discard', openingGroups: [suite], revision: state.revision });
  let update = gameUpdate(witness.socket,g=>g.staged.length===1);
  state=(await pickup(actor.socket)).game;let view=await update;
  assert.equal(state.opened[actor.playerId],false);assert.equal(state.openingStatus.totalLaidPoints,6);assert.equal(JSON.stringify(view).includes(end.id),false);
  state=(await request(actor.socket,'game:undo',{all:true,revision:state.revision})).game;
  assertInvalid(await request(actor.socket,'game:discard',{cardId:end.id,revision:state.revision}));
  state=(await request(actor.socket,'game:stage',{groups:[suite],revision:state.revision})).game;
  // A discard pickup reserves the decision until its final commit.
  const next=players.find(p=>p.playerId===state.activePlayerId);
  assertInvalid(await request(next.socket,'game:draw',{source:'stock',revision:state.revision}));
  state=(await request(actor.socket,'game:state')).game;
  for (const addition of additions) {
    const revision = state.revision + 1; update = gameUpdate(witness.socket, (g) => g.revision === revision);
    const result = await request(actor.socket, 'game:collage', { ...addition, revision: state.revision }); assert.equal(result.ok, true); state = result.game; await update;
  }
  state = (await request(actor.socket, 'game:joker-recover', { ...recovery, revision: state.revision })).game;
  state = (await request(actor.socket, 'game:stage', { groups: [reuse], revision: state.revision })).game;
  const offline = roomUpdate(witness.socket, room=>!room.players.find(p=>p.id===actor.playerId).connected); actor.socket.disconnect(); await offline;
  const replacement = await client(), resumed = await request(replacement, 'room:resume', { token: actor.token });
  for (const key of ['hand', 'staged', 'collages', 'recoveries', 'openingStatus', 'collageTargets']) assert.deepEqual(resumed.game[key], state[key]);
  assert.equal(resumed.game.teamOpeningEligible, true); assert.equal(resumed.game.canUndo, true); state = resumed.game;
  state = (await request(replacement, 'game:undo', { all: false, revision: state.revision })).game;
  assertInvalid(await request(replacement, 'game:discard', { cardId: end.id, revision: state.revision }));
  state = (await request(replacement, 'game:stage', { groups: [reuse], revision: state.revision })).game;
  update = gameUpdate(witness.socket, (g) => g.phase === 'round-ended');
  const result = await request(replacement, 'game:discard', { cardId: end.id, revision: state.revision }); assert.equal(result.ok, true); view = await update;
  assert.equal(view.openingInheritedFrom[actor.playerId], donorId); assert.equal(view.openingTotals[actor.playerId], 21);
  assert.equal(view.firstOpening.total, 80); assert.equal(view.laid[donorId][0].cards.length, 4); assert.equal(view.laid[opponentId][0].cards.length, 4);
  assert.equal(result.game.teamOpeningEligible, false); assert.ok(result.game.collageTargets.includes(opponentId));
  const secondConnection = await client(); const committedResume = await request(secondConnection, 'room:resume', { token: actor.token });
  assert.equal(committedResume.game.openingInheritedFrom[actor.playerId], donorId); assert.ok(committedResume.game.collageTargets.includes(opponentId));
  const physical = [...engine.stock, ...engine.discard, ...Object.values(engine.hands).flat(), ...Object.values(engine.laid).flat().flatMap((g) => g.cards)];
  assert.equal(physical.length, 108); assert.equal(new Set(physical.map((c) => c.id)).size, 108);
});

test('Joker recovery broadcasts replacements, isolates private hands, restores reconnect/undo and commits without duplication', { timeout: 10000 }, async (t) => {
  let engine, target, natural, joker, end, reuseCards;
  const { request, create, join, client } = await setup(t, { makeRound: (order) => {
    engine = createRound(order);
    Object.assign(engine, { stock: buildDeck(), hands: Object.fromEntries(order.map((id) => [id, []])),
      activePlayerId: order[0], initialDiscard: false, phase: 'discard',
      opened: Object.fromEntries(order.map((id) => [id, true])), openingTotals: { [order[0]]: 71, [order[1]]: 120 },
      firstOpening: { playerId: order[0], total: 71 } });
    const take = (rank, suit = 'hearts') => engine.stock.splice(engine.stock.findIndex((c) => c.rank === rank && c.suit === (rank === 'Joker' ? null : suit)), 1)[0];
    const cards = [take('8'), take('Joker'), take('10')]; joker = cards[1];
    const result = validateCombination({ type: 'suite', cardIds: cards.map((c) => c.id), joker: { cardId: joker.id, rank: '9', suit: 'hearts' } }, cards);
    target = { ownerId: order[1], groupId: 'joker-source', jokerId: joker.id };
    engine.laid[order[1]].push({ id: target.groupId, type: 'suite', cards: result.cards });
    natural = take('9'); end = take('2', 'spades'); reuseCards = [take('4', 'clubs'), take('6', 'clubs')];
    engine.hands[order[0]].push(natural, end, ...reuseCards);
    engine.hands[order[1]].push(take('A', 'diamonds'));
    startTurnStaging(engine, order[0]); return engine;
  } });
  const actor = await create(), witness = await join(actor.room.code);
  for (const p of [actor, witness]) await request(p.socket, 'player:ready', { ready: true });
  await request(actor.socket, 'room:start');
  let state = (await request(actor.socket, 'game:state')).game;
  const baseline = structuredClone(state.hand);
  const payload = () => ({ ...target, cardId: natural.id, revision: state.revision });
  const outsider = await client();
  for (const socket of [outsider, witness.socket]) assertInvalid(await request(socket, 'game:joker-recover', payload()));
  let update = gameUpdate(witness.socket, (g) => g.recoveries.length === 1);
  state = (await request(actor.socket, 'game:joker-recover', payload())).game;
  let view = await update;
  assert.equal(view.collages[0].group.cards[1].id, natural.id); assert.equal(view.recoveries[0].jokerId, joker.id);
  assert.equal(JSON.stringify(view).includes(end.id), false); assert.deepEqual(view.recoveredJokerIds, []);
  assertInvalid(await request(actor.socket, 'game:joker-recover', payload()));
  assertInvalid(await request(actor.socket, 'game:discard', { cardId: end.id, revision: state.revision }));
  assertInvalid(await request(actor.socket, 'game:discard', { cardId: joker.id, revision: state.revision }));
  const offline = gameUpdate(witness.socket, (g) => g.pauseReason === 'active-disconnected'); actor.socket.disconnect(); await offline;
  const replacement = await client(); const resumed = await request(replacement, 'room:resume', { token: actor.token });
  for (const key of ['hand', 'collages', 'recoveries', 'pendingRecoveredJokerIds', 'reversibleRecoveryIds']) assert.deepEqual(resumed.game[key], state[key]);
  state = resumed.game;
  const expectedRevision = state.revision + 1;
  update = gameUpdate(witness.socket, (g) => g.revision === expectedRevision && !g.recoveries.length);
  state = (await request(replacement, 'game:undo', { all: false, revision: state.revision })).game; await update;
  assert.deepEqual(state.hand, baseline);
  state = (await request(replacement, 'game:joker-recover', payload())).game;
  state = (await request(replacement, 'game:joker-reverse', { ...target, revision: state.revision })).game;
  assert.deepEqual(new Set(state.hand.map((c) => c.id)), new Set(baseline.map((c) => c.id)));
  state = (await request(replacement, 'game:joker-recover', payload())).game;
  state = (await request(replacement, 'game:stage', { revision: state.revision, groups: [{ type: 'suite', cardIds: [reuseCards[0].id, joker.id, reuseCards[1].id], joker: { cardId: joker.id, rank: '5', suit: 'clubs' } }] })).game;
  assert.deepEqual(state.pendingRecoveredJokerIds, []);
  update = gameUpdate(witness.socket, (g) => g.phase === 'round-ended' && !g.recoveries.length);
  const committed = await request(replacement, 'game:discard', { cardId: end.id, revision: state.revision });
  assert.equal(committed.ok, true); view = await update;
  assert.equal(view.laid[witness.playerId][0].cards[1].id, natural.id);
  assert.equal(view.laid[actor.playerId][0].cards[1].id, joker.id);
  const physical = [...engine.stock, ...engine.discard, ...Object.values(engine.hands).flat(), ...engine.order.flatMap((id) => engine.laid[id].flatMap((g) => effectiveGroup(engine, id, g).cards))];
  assert.equal(physical.length, 108); assert.equal(new Set(physical.map((c) => c.id)).size, 108);
});

test('public group positions authenticate ownership, survive reconnect and do not race with gameplay', {timeout:10000},async t=>{
  let engine,groupId;
  const {request,create,join,client}=await setup(t,{makeRound:order=>{
    const prepared=preparedOpeningRound(order);engine=prepared.game;
    const proposal=prepared.groups[0];const result=validateCombination(proposal,engine.hands[order[1]]);
    groupId='layout-group';engine.laid[order[1]].push({id:groupId,type:'suite',cards:result.cards});
    engine.hands[order[1]]=engine.hands[order[1]].filter(c=>!proposal.cardIds.includes(c.id));return engine;
  }});
  const host=await create(),guest=await join(host.room.code);for(const p of[host,guest])await request(p.socket,'player:ready',{ready:true});await request(host.socket,'room:start');
  let state=(await request(host.socket,'game:state')).game;
  const payload={groupId,position:{x:.7,y:.4},revision:state.revision};
  assert.equal((await request(host.socket,'game:move-group',payload)).error,'Coup invalide');
  assert.equal((await request(guest.socket,'game:move-group',{...payload,position:{x:2,y:0}})).error,'Coup invalide');
  assert.equal((await request(guest.socket,'game:move-group',{...payload,roundId:'old'})).error,'Coup invalide');
  const laidBefore=structuredClone(engine.laid),handsBefore=structuredClone(engine.hands);
  const observer=gameUpdate(host.socket,g=>g.layoutRevision===1);
  const results=await Promise.all([request(guest.socket,'game:move-group',payload),request(host.socket,'game:discard',{cardId:state.hand[0].id,revision:state.revision})]);
  assert.ok(results.every(result=>result.ok));assert.deepEqual(engine.laid,laidBefore);assert.equal(engine.revision,1);assert.equal(engine.activePlayerId,guest.playerId);
  const update=await observer;assert.deepEqual(update.groupPositions[groupId],payload.position);
  for(const card of handsBefore[guest.playerId])assert.equal(JSON.stringify(update).includes(card.id),false);
  guest.socket.disconnect();const replacement=await client();const resumed=await request(replacement,'room:resume',{token:guest.token});
  assert.deepEqual(resumed.game.groupPositions[groupId],payload.position);assert.equal(resumed.game.layoutRevision,1);
  assert.deepEqual(resumed.game.hand,handsBefore[guest.playerId]);
});

test('overlapping socket draws, simultaneous discards, exclusive top pickup and pending reconnect remain atomic', {timeout:10000},async t=>{
  let engine;const{request,create,join,client}=await setup(t,{makeRound:(...args)=>(engine=createRound(...args))});
  const host=await create(),guest=await join(host.room.code),players=[host,guest];for(const p of players)await request(p.socket,'player:ready',{ready:true});await request(host.socket,'room:start');
  let state=(await request(host.socket,'game:state')).game;const starter=players.find(p=>p.playerId===state.activePlayerId);
  state=(await request(starter.socket,'game:discard',{cardId:engine.hands[starter.playerId][0].id,revision:state.revision})).game;
  const first=players.find(p=>p.playerId===state.activePlayerId),second=players.find(p=>p!==first);
  state=(await request(first.socket,'game:draw',{source:'stock',revision:state.revision})).game;
  assert.equal(state.activePlayerId,second.playerId);assert.equal(state.mustDiscard[first.playerId],true);
  state=(await request(second.socket,'game:draw',{source:'stock',revision:state.revision})).game;
  assert.ok(players.every(p=>state.mustDiscard[p.playerId]));
  const revision=state.revision;
  const results=await Promise.all(players.map(p=>request(p.socket,'game:discard',{cardId:engine.hands[p.playerId][0].id,revision})));
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).error,'Coup invalide');
  const retry=players[results.findIndex(r=>!r.ok)];
  state=(await request(retry.socket,'game:discard',{cardId:engine.hands[retry.playerId][0].id,revision:engine.revision})).game;
  assert.equal(engine.discard.length,3);assert.ok(players.every(p=>engine.hands[p.playerId].length===14));
  const top=engine.discard.at(-1).id,cursor=players.find(p=>p.playerId===state.activePlayerId),other=players.find(p=>p!==cursor);
  const pickups=await Promise.all([cursor,cursor,other].map(p=>request(p.socket,'game:draw',{source:'discard',cardId:top,revision:state.revision})));
  assert.equal(pickups.filter(r=>r.ok).length,1);assert.equal(Object.values(engine.hands).flat().filter(c=>c.id===top).length,1);
  const disconnected=roomUpdate(other.socket,room=>!room.players.find(p=>p.id===cursor.playerId).connected);cursor.socket.disconnect();await disconnected;
  const nextDraw=await request(other.socket,'game:draw',{source:'stock',revision:engine.revision});assertInvalid(nextDraw);
  const replacement=await client(),resumed=await request(replacement,'room:resume',{token:cursor.token});
  assert.equal(resumed.playerId,cursor.playerId);assert.equal(resumed.game.canDiscard,false);assert.equal(resumed.game.canStage,true);assert.ok(resumed.game.hand.some(c=>c.id===top));
  assertInvalid(await request(replacement,'game:discard',{cardId:resumed.game.hand[0].id,revision:resumed.game.revision}));
  for(const card of engine.hands[other.playerId])assert.equal(JSON.stringify(resumed.game).includes(card.id),false);
  const physical=[...engine.stock,...engine.discard,...Object.values(engine.hands).flat()];assert.equal(physical.length,108);assert.equal(new Set(physical.map(c=>c.id)).size,108);
});

test('two clients reproduce the stale global discard refusal and personal revision fixes it without bypassing ownership',async t=>{
 const{request,create,join}=await setup(t);const host=await create(),guest=await join(host.room.code),players=[host,guest];for(const p of players)await request(p.socket,'player:ready',{ready:true});await request(host.socket,'room:start');
 let state=(await request(host.socket,'game:state')).game;const starter=players.find(p=>p.playerId===state.activePlayerId);
 state=(await request(starter.socket,'game:state')).game;
 assert.equal((await request(starter.socket,'game:discard',{revision:state.revision,cardId:state.hand[0].id})).ok,true);
 state=(await request(host.socket,'game:state')).game;const actor=players.find(p=>p.playerId===state.activePlayerId),next=players.find(p=>p!==actor);
 const before=(await request(actor.socket,'game:draw',{revision:state.revision,source:'stock'})).game;
 const remote=await request(next.socket,'game:draw',{revision:before.revision,source:'stock'});assert.equal(remote.ok,true);
 const legacy=await request(actor.socket,'game:discard',{revision:before.revision,cardId:before.hand[0].id});assert.equal(legacy.ok,false);assert.match(legacy.reason,/ont changé/);
 const legal=await request(actor.socket,'game:discard',{revision:before.revision,turnRevision:before.turnRevision,cardId:before.hand[0].id});assert.equal(legal.ok,true);assert.equal(legal.game.mustDiscard[next.playerId],true);
 const replay=await request(actor.socket,'game:discard',{revision:legal.game.revision,turnRevision:before.turnRevision,cardId:before.hand[1].id});assert.equal(replay.ok,false);assert.match(replay.reason,/d’abord piocher/);
});

async function setup(t, options) {
  const { httpServer, io } = createApp(options);
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise((resolve) => io.close(resolve));
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  async function client() {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(socket);
    socket.on('game:update', ({ game }) => { socket.testRoundId = game.roundId; });
    await once(socket, 'connect');
    return socket;
  }
  const request = (socket, event, data = {}) => socket.timeout(2000).emitWithAck(event, event.startsWith('game:') && event !== 'game:state' ? { roundId: socket.testRoundId, ...data } : data);
  async function create(mode = 'individual') {
    const socket = await client();
    const session = await request(socket, 'room:create', { name: 'Hamza', mode });
    assert.equal(session.ok, true);
    return { socket, ...session };
  }
  async function join(code, name = 'Sara') {
    const socket = await client();
    const session = await request(socket, 'room:join', { name, code });
    assert.equal(session.ok, true);
    return { socket, ...session };
  }
  const dropConnection = (socket) => io.sockets.sockets.get(socket.id).conn.close();
  return { client, request, create, join, url, dropConnection };
}

test('validates mode, names and membership; broadcasts safe snapshots; limits capacity', { timeout: 10000 }, async (t) => {
  const { client, request, create, join, url } = await setup(t);
  const outsider = await client();
  for (const payload of [null, {}, { name: ' ' }, { name: 'X', mode: 'bots' }, { name: 'X'.repeat(25), mode: 'teams' }]) {
    assert.equal((await request(outsider, 'room:create', payload)).ok, false);
  }
  for (const event of ['player:ready', 'player:team', 'room:start']) {
    assert.equal((await request(outsider, event, { ready: true, team: 'A' })).ok, false);
  }
  const host = await create();
  assert.match(host.room.code, /^[A-Z2-9]{6}$/);
  assert.notEqual(host.playerId, host.socket.id);
  assert.equal(host.room.mode, 'individual');
  assert.equal(host.room.players[0].ready, false);
  assert.equal((await request(outsider, 'room:join', { name: 'Sara', code: 'BAD' })).ok, false);
  const update = once(host.socket, 'room:update');
  const guest = await join(host.room.code.toLowerCase());
  const snapshot = (await update)[0];
  assert.equal(snapshot.players.length, 2);
  assert.equal(JSON.stringify(snapshot).includes(host.token), false);
  assert.equal('socketId' in snapshot.players[0], false);
  assert.equal('token' in snapshot.players[0], false);
  assert.equal((await request(guest.socket, 'room:create', { name: 'X', mode: 'teams' })).ok, false);
  assert.equal((await request(guest.socket, 'room:join', { name: 'X', code: host.room.code })).ok, false);
  await join(host.room.code, 'Amine');
  await join(host.room.code, 'Lina');
  assert.equal((await request(outsider, 'room:join', { name: 'Extra', code: host.room.code })).ok, false);
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
});

test('individual mode requires 2–4 connected ready players and only host may start', { timeout: 10000 }, async (t) => {
  const { request, create, join } = await setup(t);
  const host = await create();
  await request(host.socket, 'player:ready', { ready: true });
  assert.equal((await request(host.socket, 'room:start')).ok, false);
  const guest = await join(host.room.code);
  assert.equal((await request(host.socket, 'room:start')).ok, false);
  assert.equal((await request(guest.socket, 'player:ready', { ready: 'true' })).ok, false);
  assert.equal((await request(guest.socket, 'player:team', { team: 'A' })).ok, false);
  let ready = await request(guest.socket, 'player:ready', { ready: true });
  assert.equal(ready.room.canStart, true);
  assert.equal((await request(guest.socket, 'room:start')).ok, false);
  ready = await request(guest.socket, 'player:ready', { ready: false });
  assert.equal(ready.room.canStart, false);
  await request(guest.socket, 'player:ready', { ready: true });
  const update = once(guest.socket, 'room:update');
  const started = await request(host.socket, 'room:start');
  assert.equal(started.room.status, 'playing');
  assert.equal((await update)[0].status, 'playing');
  assert.equal((await request(host.socket, 'room:start')).ok, false);
  assert.equal((await request(guest.socket, 'player:ready', { ready: false })).ok, false);
});

test('team mode enforces manual 2 vs 2 allocation and clears ready when switching', { timeout: 10000 }, async (t) => {
  const { request, create, join } = await setup(t);
  const host = await create('teams');
  const players = [host];
  for (const name of ['Sara', 'Amine', 'Lina']) players.push(await join(host.room.code, name));
  for (const player of players) await request(player.socket, 'player:ready', { ready: true });
  assert.equal((await request(host.socket, 'room:start')).ok, false);
  assert.equal((await request(host.socket, 'player:team', { team: 'C' })).ok, false);
  assert.equal((await request(host.socket, 'player:team', { team: 'A' })).room.players[0].ready, false);
  await request(players[1].socket, 'player:team', { team: 'A' });
  assert.equal((await request(players[2].socket, 'player:team', { team: 'A' })).ok, false);
  await request(players[2].socket, 'player:team', { team: 'B' });
  assert.equal((await request(host.socket, 'room:start')).ok, false);
  await request(players[3].socket, 'player:team', { team: 'B' });
  for (const player of players) await request(player.socket, 'player:ready', { ready: true });
  assert.equal((await request(host.socket, 'room:start')).room.status, 'playing');
  assert.equal((await request(host.socket, 'player:team', { team: 'B' })).ok, false);
});

test('disconnect transfers host by original join order; resume preserves identity and team', { timeout: 10000 }, async (t) => {
  const { client, request, create, join } = await setup(t);
  const host = await create('teams');
  const first = await join(host.room.code, 'First');
  const second = await join(host.room.code, 'Second');
  await request(host.socket, 'player:team', { team: 'A' });
  await request(host.socket, 'player:ready', { ready: true });
  const disconnected = roomUpdate(first.socket, (room) => !room.players[0].connected);
  host.socket.disconnect();
  const room = await disconnected;
  assert.equal(room.hostId, first.playerId);
  assert.equal(room.players[0].connected, false);
  assert.equal(room.players[0].ready, false);
  assert.equal(room.canStart, false);
  assert.equal(room.players.length, 3);
  const replacement = await client();
  assert.equal((await request(replacement, 'room:resume', { token: 'invalid' })).ok, false);
  const resumed = await request(replacement, 'room:resume', { token: host.token });
  assert.equal(resumed.playerId, host.playerId);
  assert.equal(resumed.room.players[0].team, 'A');
  assert.equal(resumed.room.hostId, first.playerId);
  const transfer = roomUpdate(replacement, (room) => room.hostId === host.playerId);
  first.socket.disconnect();
  assert.equal((await transfer).hostId, host.playerId);
  const next = roomUpdate(second.socket, (room) => room.hostId === second.playerId);
  await request(replacement, 'room:leave');
  assert.equal((await next).hostId, second.playerId);
  assert.equal((await request(replacement, 'room:resume', { token: host.token })).ok, false);
});

test('a reused secret replaces the old connection without duplicating the identity', { timeout: 10000 }, async (t) => {
  const { client, request, create, join } = await setup(t);
  const host = await create();
  const guest = await join(host.room.code);
  const replacement = await client();
  const replaced = once(host.socket, 'session:replaced');
  const disconnected = once(host.socket, 'disconnect');
  const resumed = await request(replacement, 'room:resume', { token: host.token });
  await replaced;
  await disconnected;
  assert.equal(resumed.room.players.length, 2);
  assert.equal(resumed.room.players[0].id, host.playerId);
  assert.equal(resumed.room.players[0].connected, true);
  assert.equal(resumed.room.hostId, host.playerId);
  assert.equal((await request(guest.socket, 'room:resume', { token: host.token })).ok, false);
  assert.equal((await request(replacement, 'player:ready', { ready: true })).room.players[0].connected, true);
});

test('started match rejects newcomers, permits original reconnection and freezes configuration', { timeout: 10000 }, async (t) => {
  const { client, request, create, join } = await setup(t);
  const host = await create('teams');
  const players = [host];
  for (const name of ['Sara', 'Amine', 'Lina']) players.push(await join(host.room.code, name));
  for (const [index, player] of players.entries()) {
    await request(player.socket, 'player:team', { team: index < 2 ? 'A' : 'B' });
    await request(player.socket, 'player:ready', { ready: true });
  }
  assert.equal((await request(host.socket, 'room:start')).ok, true);
  const update = roomUpdate(players[1].socket, (room) => !room.players[0].connected);
  host.socket.disconnect();
  assert.equal((await update).hostId, players[1].playerId);
  const newcomer = await client();
  assert.equal((await request(newcomer, 'room:join', { name: 'New', code: host.room.code })).ok, false);
  const resumed = await request(newcomer, 'room:resume', { token: host.token });
  assert.equal(resumed.playerId, host.playerId);
  assert.equal(resumed.room.status, 'playing');
  assert.equal(resumed.room.players[0].team, 'A');
  assert.equal((await request(newcomer, 'player:team', { team: 'B' })).ok, false);
  assert.equal((await request(newcomer, 'player:ready', { ready: false })).ok, false);
  const left = await request(newcomer, 'room:leave');
  assert.equal(left.reserved, true);
  const returned = await request(newcomer, 'room:resume', { token: host.token });
  assert.equal(returned.ok, true);
  assert.equal(returned.room.status, 'lobby');
  assert.equal(returned.playerId, host.playerId);
  assert.equal((await request(newcomer, 'room:join', { name: 'New', code: host.room.code })).ok, false);
});

test('all disconnected players can resume; explicit final leave deletes a room and its token', { timeout: 10000 }, async (t) => {
  const { client, request, create } = await setup(t);
  const host = await create();
  host.socket.disconnect();
  const socket = await client();
  const resumed = await request(socket, 'room:resume', { token: host.token });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.room.hostId, host.playerId);
  await request(socket, 'room:leave');
  assert.equal((await request(socket, 'room:resume', { token: host.token })).ok, false);
  assert.equal((await request(socket, 'room:join', { name: 'New', code: host.room.code })).ok, false);
});

for (const count of [3, 4]) {
  test(`individual mode starts with ${count} ready players`, { timeout: 10000 }, async (t) => {
    const { request, create, join } = await setup(t);
    const host = await create();
    const players = [host];
    for (let i = 1; i < count; i++) players.push(await join(host.room.code, `Joueur ${i}`));
    for (const player of players) await request(player.socket, 'player:ready', { ready: true });
    assert.equal((await request(host.socket, 'room:start')).room.status, 'playing');
  });
}

test('transport interruption reconnects automatically and restores the original session', { timeout: 10000 }, async (t) => {
  const { request, create, join, dropConnection } = await setup(t);
  const host = await create();
  const guest = await join(host.room.code);
  await request(host.socket, 'player:ready', { ready: true });
  await request(guest.socket, 'player:ready', { ready: true });
  host.socket.io.reconnection(true);
  host.socket.io.reconnectionDelay(50);
  const originalSocketId = host.socket.id;
  const offline = roomUpdate(guest.socket, (room) => !room.players[0].connected);
  const reconnect = once(host.socket, 'connect');
  dropConnection(host.socket);
  assert.equal((await offline).canStart, false);
  assert.equal((await request(guest.socket, 'room:start')).ok, false);
  await reconnect;
  assert.notEqual(host.socket.id, originalSocketId);
  const resumed = await request(host.socket, 'room:resume', { token: host.token });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.playerId, host.playerId);
  assert.equal(resumed.room.players.length, 2);
  assert.equal(resumed.room.players[0].connected, true);
  assert.equal(resumed.room.players[0].ready, false);
  assert.equal(resumed.room.hostId, guest.playerId);
});

test('public chat authenticates authors, validates messages, isolates rooms and survives reconnection', { timeout: 10000 }, async (t) => {
  const { request, create, join, client } = await setup(t);
  const host = await create();
  const guest = await join(host.room.code);
  const otherRoom = await create();
  const outsider = await client();
  assert.equal((await request(outsider, 'chat:history')).ok, false);
  assert.equal((await request(outsider, 'chat:send', { text: 'Bonjour' })).ok, false);
  for (const text of ['', '  ', 'x'.repeat(301), '\u0000', 12]) {
    assert.equal((await request(host.socket, 'chat:send', { text })).ok, false);
  }
  const update = once(guest.socket, 'chat:update');
  const result = await request(host.socket, 'chat:send', { text: ' Bonjour la table ! ', name: 'Imposteur', playerId: guest.playerId });
  assert.equal(result.ok, true);
  assert.equal(result.message.text, 'Bonjour la table !');
  assert.equal(result.message.name, 'Hamza');
  assert.equal(result.message.playerId, host.playerId);
  assert.ok(result.message.id);
  assert.ok(Date.parse(result.message.sentAt));
  assert.equal(JSON.stringify(result).includes(host.token), false);
  const broadcast = (await update)[0];
  assert.equal(broadcast.code, host.room.code);
  assert.equal(broadcast.messages[0].id, result.message.id);
  assert.equal((await request(host.socket, 'chat:send', { text: 'Trop rapide' })).ok, false);
  assert.equal((await request(otherRoom.socket, 'chat:history')).messages.length, 0);
  const seenDisconnect = roomUpdate(host.socket, (room) => !room.players[1].connected);
  guest.socket.disconnect();
  await seenDisconnect;
  const replacement = await client();
  const resumed = await request(replacement, 'room:resume', { token: guest.token });
  assert.equal(resumed.room.chat[0].text, 'Bonjour la table !');
  assert.equal((await request(replacement, 'chat:history')).messages.length, 1);
  await request(host.socket, 'player:ready', { ready: true });
  await request(replacement, 'player:ready', { ready: true });
  await request(host.socket, 'room:start');
  assert.equal((await request(replacement, 'chat:send', { text: '<script>bonjour</script>' })).ok, true);
  // Text is preserved as plain text; React renders it without interpreting HTML.
  const history = await request(host.socket, 'chat:history');
  assert.equal(history.messages.length, 2);
  assert.equal(history.messages[1].text, '<script>bonjour</script>');
  await request(replacement, 'room:leave');
  assert.equal((await request(replacement, 'chat:send', { text: 'Après départ' })).ok, false);
  assert.equal((await request(replacement, 'chat:history')).ok, false);
});

test('real game validates socket identity and phases, unicasts private hands and restores a disconnected turn', { timeout: 10000 }, async (t) => {
  const { request, create, join, client } = await setup(t);
  const host = await create('teams');
  const players = [host];
  for (const name of ['Sara', 'Amine', 'Lina']) players.push(await join(host.room.code, name));
  const outsider = await client();
  for (const event of ['game:state', 'game:draw', 'game:discard']) {
    assertInvalid(await request(outsider, event, { playerId: host.playerId, source: 'stock' }));
  }
  assertInvalid(await request(host.socket, 'game:state'));
  for (const [i, player] of players.entries()) {
    await request(player.socket, 'player:team', { team: i < 2 ? 'A' : 'B' });
    await request(player.socket, 'player:ready', { ready: true });
  }
  const updates = players.map(() => []);
  players.forEach((player, i) => player.socket.on('game:update', (data) => updates[i].push(data.game)));
  const started = await request(host.socket, 'room:start');
  assert.equal('hand' in started.room.game, false);
  assert.equal('hands' in started.room.game, false);
  let states = await Promise.all(players.map(async (p) => (await request(p.socket, 'game:state')).game));
  assert.equal(new Set(states.flatMap((g) => g.hand.map((c) => c.id))).size, 57);
  assert.equal(states[0].stockCount, 51);
  const order = states[0].order;
  assert.deepEqual(order, [players[0].playerId, players[2].playerId, players[1].playerId, players[3].playerId]);
  function checkPrivacy() {
    for (const [i, state] of states.entries()) {
      const encoded = JSON.stringify(state);
      assert.equal('hands' in state, false);
      assert.equal('stock' in state, false);
      assert.equal('discard' in state, false);
      for (const [j, other] of states.entries()) {
        if (i !== j) for (const card of other.hand) assert.equal(encoded.includes(card.id), false);
      }
    }
  }
  checkPrivacy();
  const starterIndex = players.findIndex((p) => p.playerId === states[0].activePlayerId);
  const starter = players[starterIndex];
  const nonstarter = players[(starterIndex + 1) % 4];
  const revision = states[0].revision;
  assert.equal(states[starterIndex].hand.length, 15);
  for (const [socket, event, payload] of [
    [starter.socket, 'game:draw', { source: 'stock', revision }],
    [starter.socket, 'game:discard', { cardId: states[(starterIndex + 1) % 4].hand[0].id, revision }],
    [nonstarter.socket, 'game:discard', { cardId: states[starterIndex].hand[0].id, revision, playerId: starter.playerId }],
  ]) assertInvalid(await request(socket, event, payload));
  const discardedId = states[starterIndex].hand[0].id;
  const firstDiscard = await request(starter.socket, 'game:discard', { cardId: discardedId, revision });
  assert.equal(firstDiscard.game.phase, 'draw');
  assert.equal(firstDiscard.game.discardTop.id, discardedId);
  assert.equal(firstDiscard.game.activePlayerId,order[(order.indexOf(starter.playerId)+1)%4]);
  const next = players.find((p) => p.playerId === firstDiscard.game.activePlayerId);
  assertInvalid(await request(next.socket,'game:draw',{source:'discard',cardId:'stale-top',revision:1}));
  const draws = await Promise.all([0, 1].map(() => request(next.socket, 'game:draw', { source: 'stock', revision: 1 })));
  assert.equal(draws.filter((r) => r.ok).length, 1);
  assert.equal(draws.find((r) => !r.ok).error, 'Coup invalide');
  const afterDraw = draws.find((r) => r.ok).game;
  assert.equal(afterDraw.hand.length, 15);
  assert.equal(afterDraw.activePlayerId, order[(order.indexOf(next.playerId) + 1) % 4]);
  assert.equal(afterDraw.phase, 'draw');
  assert.equal(afterDraw.stockCount, 50);
  const concurrentDiscard = await request(next.socket,'game:discard',{cardId:afterDraw.hand[0].id,revision:afterDraw.revision});assert.equal(concurrentDiscard.ok,true);
  states = await Promise.all(players.map(async (p) => (await request(p.socket, 'game:state')).game));
  checkPrivacy();
  for (const [i, state] of states.entries()) {
    assert.equal(updates[i].at(-1).revision, 3);
    assert.deepEqual(updates[i].at(-1).hand, state.hand);
  }
  const activeIndex = players.findIndex((p) => p.playerId === states[0].activePlayerId);
  const active = players[activeIndex];
  const witness = players.find((p) => p !== active);
  const offline = roomUpdate(witness.socket, (room) => !room.players.find((p) => p.id === active.playerId).connected);
  active.socket.disconnect();
  await offline;
  assert.equal((await request(witness.socket, 'game:state')).game.pauseReason, 'active-disconnected');
  const replacement = await client();
  const resumed = await request(replacement, 'room:resume', { token: active.token });
  assert.equal(resumed.playerId, active.playerId);
  assert.deepEqual(resumed.game.hand, states[activeIndex].hand);
  assert.equal(resumed.game.activePlayerId, active.playerId);
  assert.equal(resumed.game.phase, 'draw');
  assert.equal(resumed.game.pauseReason, null);
  assert.equal('hand' in resumed.room.game, false);
  const resumedDraw = await request(replacement, 'game:draw', { source: 'stock', revision: resumed.game.revision });
  assert.equal(resumedDraw.ok, true);
  assert.equal(resumedDraw.game.hand.length, 15);
  const duplicate = await client();
  const takeover = await request(duplicate, 'room:resume', { token: active.token });
  assert.deepEqual(takeover.game.hand, resumedDraw.game.hand);
  assertInvalid(await request(duplicate, 'game:draw', { source: 'stock', revision: takeover.game.revision }));
});

test('socket turns reach empty stock and recycle discards while keeping the top card', { timeout: 10000 }, async (t) => {
  const { request, create, join } = await setup(t);
  const host = await create();
  const guest = await join(host.room.code);
  const players = [host, guest];
  for (const player of players) await request(player.socket, 'player:ready', { ready: true });
  await request(host.socket, 'room:start');
  let game = (await request(host.socket, 'game:state')).game;
  let active = players.find((p) => p.playerId === game.activePlayerId);
  game = (await request(active.socket, 'game:state')).game;
  game = (await request(active.socket, 'game:discard', { cardId: game.hand[0].id, revision: game.revision })).game;
  while(game.stockCount) {
    active=players.find(p=>p.playerId===game.activePlayerId);
    game=(await request(active.socket,'game:state')).game;
    if(game.phase==='discard') game=(await request(active.socket,'game:discard',{cardId:game.hand[0].id,revision:game.revision})).game;
    const drawn=await request(active.socket,'game:draw',{source:'stock',revision:game.revision});assert.equal(drawn.ok,true);game=drawn.game;
  }
  active=players.find(p=>p.playerId===game.activePlayerId);game=(await request(active.socket,'game:state')).game;
  if(game.phase==='discard') game=(await request(active.socket,'game:discard',{cardId:game.hand[0].id,revision:game.revision})).game;
  const topId = game.discardTop.id;
  const oldCount = game.discardCount;
  active = players.find((p) => p.playerId === game.activePlayerId);
  const recycled = await request(active.socket, 'game:draw', { source: 'stock', revision: game.revision });
  assert.equal(recycled.ok, true);
  assert.equal(recycled.game.discardTop.id, topId);
  assert.equal(recycled.game.discardCount, 1);
  assert.equal(recycled.game.stockCount, oldCount - 2);
  assert.equal(recycled.game.hand.some((card) => card.id === topId), false);
  assert.equal(recycled.game.stockCount + recycled.game.discardCount + Object.values(recycled.game.counts).reduce((a, b) => a + b, 0), 108);
});

function preparedOpeningRound(order) {
  const game = createRound(order);
  game.stock = buildDeck();
  game.hands = Object.fromEntries(order.map((id) => [id, []]));
  game.starterId = order[0]; game.activePlayerId = order[0];
  game.mustDiscard = Object.fromEntries(order.map(id=>[id,id===order[0]]));
  const take = (rank, suit) => game.stock.splice(game.stock.findIndex((c) => c.rank === rank && c.suit === suit), 1)[0];
  const faces = [
    { type: 'suite', cards: ['8', '9', '10'].map((rank) => take(rank, 'hearts')) },
    { type: 'tierce', cards: ['clubs', 'diamonds', 'spades'].map((suit) => take('R', suit)) },
    { type: 'suite', cards: ['4', '5', '6'].map((rank) => take(rank, 'clubs')) },
  ];
  game.hands[order[1]].push(...faces.flatMap((group) => group.cards));
  while (game.hands[order[1]].length < 14) game.hands[order[1]].push(game.stock.pop());
  while (game.hands[order[0]].length < 15) game.hands[order[0]].push(game.stock.pop());
  return { game, groups: faces.map((group) => ({ type: group.type, cardIds: group.cards.map((card) => card.id) })) };
}
function gameUpdate(socket, predicate) {
  return new Promise((resolve) => {
    function update(data) { if (predicate(data.game)) { socket.off('game:update', update); resolve(data.game); } }
    socket.on('game:update', update);
  });
}

test('Descente and undo synchronize live, preserve private cards and survive reconnection before atomic commit', { timeout: 10000 }, async (t) => {
  let groups;
  const { request, create, join, client } = await setup(t, { makeRound: (order) => {
    const prepared = preparedOpeningRound(order); groups = prepared.groups; return prepared.game;
  } });
  const host = await create(), guest = await join(host.room.code);
  for (const player of [host, guest]) await request(player.socket, 'player:ready', { ready: true });
  await request(host.socket, 'room:start');
  let hostState = (await request(host.socket, 'game:state')).game;
  assertInvalid(await request(host.socket, 'game:stage', { groups, revision: hostState.revision }));
  await request(host.socket, 'game:discard', { cardId: hostState.hand[0].id, revision: hostState.revision });
  let state = await returnToDiscard(request, [host,guest], guest.playerId);
  const baseline = structuredClone(state.hand);
  const knownIds = new Set(groups.flatMap((group) => group.cardIds));
  const privateIds = state.hand.filter((card) => !knownIds.has(card.id)).map((card) => card.id);
  const receivedEvents = [];
  host.socket.onAny((event) => receivedEvents.push(event));
  let update = gameUpdate(host.socket, (game) => game.staged.length === 1);
  state = (await request(guest.socket, 'game:stage', { groups: [groups[0]], revision: state.revision })).game;
  let observer = await update;
  assert.equal(observer.staged[0].cards.length, 3);
  assert.equal(observer.counts[guest.playerId], 12);
  for (const id of privateIds) assert.equal(JSON.stringify(observer).includes(id), false);
  assertInvalid(await request(host.socket, 'game:undo', { all: true, revision: state.revision, playerId: guest.playerId }));
  assertInvalid(await request(guest.socket, 'game:discard', { cardId: privateIds[0], revision: state.revision }));
  assertInvalid(await request(guest.socket, 'game:stage', { groups: [groups[1]], revision: state.revision - 1 }));
  const retrieveRevision = state.revision + 1;
  update = gameUpdate(host.socket, (game) => game.staged.length === 0 && game.revision === retrieveRevision);
  state = (await request(guest.socket, 'game:retrieve', { groupId: state.staged[0].id, revision: state.revision })).game;
  await update;
  state = (await request(guest.socket, 'game:stage', { groups, revision: state.revision })).game;
  const undoAllRevision = state.revision + 1;
  update = gameUpdate(host.socket, (game) => !game.staged.length && game.revision === undoAllRevision);
  state = (await request(guest.socket, 'game:undo', { all: true, revision: state.revision })).game;
  observer = await update;
  assert.deepEqual(state.hand, baseline);
  assert.equal(observer.counts[guest.playerId], 15);
  assert.equal(receivedEvents.every((event) => event === 'game:update'), true);
  state = (await request(guest.socket, 'game:stage', { groups, revision: state.revision })).game;
  assert.equal(state.openingStatus.valid, true);
  assert.equal(state.firstOpening, null);
  const offline = gameUpdate(host.socket, (game) => game.pauseReason === 'active-disconnected');
  guest.socket.disconnect(); await offline;
  const replacement = await client();
  const resumed = await request(replacement, 'room:resume', { token: guest.token });
  assert.deepEqual(resumed.game.staged, state.staged);
  assert.deepEqual(resumed.game.hand, state.hand);
  assert.equal(resumed.game.canUndo, true);
  state = resumed.game;
  assertInvalid(await request(replacement, 'game:retrieve', { groupId: state.staged[1].id, cardId: state.staged[1].cards[0].id, revision: state.revision }));
  update = gameUpdate(host.socket, (game) => game.opened[guest.playerId]);
  const committed = await request(replacement, 'game:discard', { cardId: state.hand[0].id, revision: state.revision });
  assert.equal(committed.ok, true);
  observer = await update;
  assert.equal(observer.staged.length, 0);
  assert.equal(observer.laid[guest.playerId].length, 3);
  assert.equal(observer.firstOpening.total, 72);
  assert.equal(observer.activePlayerId, guest.playerId);
  assert.equal(observer.phase, 'draw');
  assert.equal(committed.game.canUndo, false);
  for (const card of committed.game.hand) assert.equal(JSON.stringify(observer).includes(card.id), false);
});

test('conditional discard pickup permits preparation but own discard requires a complete opening', {timeout:10000},async t=>{
 let groups;const{request,create,join}=await setup(t,{makeRound:order=>{const prepared=preparedOpeningRound(order);groups=prepared.groups;return prepared.game;}});
 const host=await create(),guest=await join(host.room.code);for(const p of[host,guest])await request(p.socket,'player:ready',{ready:true});await request(host.socket,'room:start');
 let state=(await request(host.socket,'game:state')).game;await request(host.socket,'game:discard',{cardId:state.hand[0].id,revision:state.revision});state=(await request(guest.socket,'game:state')).game;
 const top=state.discardTop;state=(await request(guest.socket,'game:draw',{source:'discard',cardId:top.id,revision:state.revision})).game;
 assert.ok(state.hand.some(card=>card.id===top.id));assert.equal(state.opened[guest.playerId],false);
 state=(await request(guest.socket,'game:stage',{groups:groups.slice(0,2),revision:state.revision})).game;
 assertInvalid(await request(guest.socket,'game:discard',{cardId:top.id,revision:state.revision}));
 state=(await request(guest.socket,'game:stage',{groups:groups.slice(2),revision:state.revision})).game;
 assertInvalid(await request(guest.socket,'game:discard',{cardId:top.id,revision:state.revision}));
 state=(await request(guest.socket,'game:undo',{all:true,revision:state.revision})).game;
 state=(await request(guest.socket,'game:cancel-discard',{cardId:top.id,revision:state.revision})).game;
 state=(await request(guest.socket,'game:draw',{source:'stock',revision:state.revision})).game;
 state=(await request(guest.socket,'game:stage',{groups,revision:state.revision})).game;
 const update=gameUpdate(host.socket,g=>g.opened[guest.playerId]);state=(await request(guest.socket,'game:discard',{cardId:state.hand[0].id,revision:state.revision})).game;const observer=await update;
 assert.equal(state.opened[guest.playerId],true);assert.equal(state.firstOpening.total,72);assert.equal(state.staged.length,0);assert.equal(state.activePlayerId,host.playerId);
 for(const card of state.hand)assert.equal(JSON.stringify(observer).includes(card.id),false);
});

test('own/team/opponent Collage broadcasts only additions, survives reconnect, and commits with Descente atomically', { timeout: 10000 }, async (t) => {
  let targets, proposal, additions, endId;
  const { request, create, join, client } = await setup(t, { makeRound: (order) => {
    const game = createRound(order);
    game.stock = buildDeck(); game.hands = Object.fromEntries(order.map((id) => [id, []]));
    game.activePlayerId = order[0]; game.initialDiscard = false; game.phase = 'discard';
    game.opened = Object.fromEntries(order.map((id) => [id, true]));
    game.openingTotals = Object.fromEntries(order.map((id, i) => [id, [90, 80, 110, 100][i]]));
    game.firstOpening = { playerId: order[1], total: 80 };
    const take = (rank, suit) => game.stock.splice(game.stock.findIndex((card) => card.rank === rank && card.suit === suit), 1)[0];
    targets = [
      { ownerId: order[0], suit: 'clubs' }, { ownerId: order[2], suit: 'hearts' }, { ownerId: order[1], suit: 'spades' },
    ].map(({ ownerId, suit }, i) => {
      const cards = ['8', '9', '10'].map((rank) => take(rank, suit));
      const result = validateCombination({ type: 'suite', cardIds: cards.map((card) => card.id) }, cards);
      const group = { id: `committed-${i}`, type: 'suite', cards: result.cards };
      game.laid[ownerId].push(group); return { ownerId, groupId: group.id, baseCardId: cards[0].id, suit };
    });
    additions = targets.map((target) => take('7', target.suit));
    const proposed = ['A', '2', '3'].map((rank) => take(rank, 'diamonds'));
    proposal = { type: 'suite', cardIds: proposed.map((card) => card.id) };
    const end = take('5', 'diamonds'); endId = end.id;
    game.hands[order[0]].push(...additions, ...proposed, end);
    for (const id of order.slice(1)) for (let i = 0; i < 5; i++) game.hands[id].push(game.stock.pop());
    startTurnStaging(game, order[0]); return game;
  } });
  const host = await create('teams'); const players = [host];
  for (const name of ['Sara', 'Amine', 'Lina']) players.push(await join(host.room.code, name));
  for (const [i, player] of players.entries()) {
    await request(player.socket, 'player:team', { team: i < 2 ? 'A' : 'B' });
    await request(player.socket, 'player:ready', { ready: true });
  }
  await request(host.socket, 'room:start');
  const observer = players[1];
  let state = (await request(host.socket, 'game:state')).game;
  const baseline = structuredClone(state.hand);
  const events = []; observer.socket.onAny((event) => events.push(event));
  const collage = async (socket, i, revision) => request(socket, 'game:collage', { ...targets[i], cardIds: [additions[i].id], revision });
  assert.deepEqual(await collage(observer.socket, 0, state.revision), { ok: false, error: 'Coup invalide' });
  const outsider = await client();
  assert.deepEqual(await collage(outsider, 0, state.revision), { ok: false, error: 'Coup invalide' });
  state = (await request(host.socket, 'game:stage', { groups: [proposal], revision: state.revision })).game;
  for (let i = 0; i < 3; i++) {
    const update = gameUpdate(observer.socket, (game) => game.collages.length === i + 1);
    const result = await collage(host.socket, i, state.revision); assert.equal(result.ok, true); state = result.game;
    const view = await update;
    assert.equal(JSON.stringify(view).includes(endId), false);
    assert.equal(view.collages[i].addedCardIds[0], additions[i].id);
    assert.equal(view.laid[targets[i].ownerId].find((g) => g.id === targets[i].groupId).cards.length, 3);
  }
  assert.deepEqual(await collage(host.socket, 0, state.revision), { ok: false, error: 'Coup invalide' });
  const undoRevision = state.revision + 1;
  let update = gameUpdate(observer.socket, (game) => game.collages.length === 2 && game.revision === undoRevision);
  state = (await request(host.socket, 'game:undo', { all: false, revision: state.revision })).game; await update;
  const allRevision = state.revision + 1;
  update = gameUpdate(observer.socket, (game) => game.collages.length === 0 && game.staged.length === 0 && game.revision === allRevision);
  state = (await request(host.socket, 'game:undo', { all: true, revision: state.revision })).game; await update;
  assert.deepEqual(state.hand, baseline);
  assert.equal(events.every((event) => event === 'game:update'), true);
  state = (await request(host.socket, 'game:stage', { groups: [proposal], revision: state.revision })).game;
  for (let i = 0; i < 3; i++) state = (await collage(host.socket, i, state.revision)).game;
  assertInvalid(await request(host.socket, 'game:retrieve', { ownerId: targets[1].ownerId, groupId: targets[1].groupId, cardId: targets[1].baseCardId, revision: state.revision }));
  state = (await request(host.socket, 'game:retrieve', { ownerId: targets[1].ownerId, groupId: targets[1].groupId, cardId: additions[1].id, revision: state.revision })).game;
  assert.equal(state.collages.length, 2);
  state = (await request(host.socket, 'game:undo', { all: false, revision: state.revision })).game;
  assert.equal(state.collages.length, 3);
  const offline = gameUpdate(observer.socket, (game) => game.pauseReason === 'active-disconnected');
  host.socket.disconnect(); await offline;
  const replacement = await client(); const resumed = await request(replacement, 'room:resume', { token: host.token });
  assert.deepEqual(resumed.game.collages, state.collages); assert.deepEqual(resumed.game.staged, state.staged);
  assert.deepEqual(resumed.game.hand, state.hand); assert.equal(resumed.game.canUndo, true);
  assert.deepEqual(resumed.game.collageTargets, state.collageTargets);
  assert.equal(JSON.stringify((await request(observer.socket, 'game:state')).game).includes(endId), false);
  update = gameUpdate(observer.socket, (game) => game.collages.length === 0 && game.phase === 'round-ended');
  const committed = await request(replacement, 'game:discard', { cardId: endId, revision: resumed.game.revision });
  assert.equal(committed.ok, true); const finalView = await update;
  for (const target of targets) assert.equal(finalView.laid[target.ownerId].find((g) => g.id === target.groupId).cards.length, 4);
  assert.equal(finalView.laid[host.playerId].length, 2); assert.equal(finalView.staged.length, 0);
  assert.equal(finalView.openingTotals[host.playerId], 90); assert.equal(finalView.firstOpening.total, 80);
  assert.equal(finalView.phase, 'round-ended'); assert.equal(committed.game.canUndo, false);
});

test('same-turn Descente allows own staged Collage before opening is committed and records its final group total', { timeout: 10000 }, async (t) => {
  let groups, sevenId;
  const { request, create, join } = await setup(t, { makeRound: (order) => {
    const prepared = preparedOpeningRound(order); groups = prepared.groups;
    const game = prepared.game; const hand = game.hands[order[1]];
    const spare = hand.pop(); game.stock.push(spare);
    const i = game.stock.findIndex((card) => card.rank === '7' && card.suit === 'hearts');
    const seven = game.stock.splice(i, 1)[0]; sevenId = seven.id; hand.push(seven);
    return game;
  } });
  const host = await create(), guest = await join(host.room.code);
  for (const player of [host, guest]) await request(player.socket, 'player:ready', { ready: true });
  await request(host.socket, 'room:start');
  let state = (await request(host.socket, 'game:state')).game;
  await request(host.socket, 'game:discard', { cardId: state.hand[0].id, revision: state.revision });
  state = await returnToDiscard(request, [host,guest], guest.playerId);
  state = (await request(guest.socket, 'game:stage', { groups, revision: state.revision })).game;
  assert.equal(state.opened[guest.playerId], false); assert.equal(state.openingStatus.totalLaidPoints, 72);
  const update = gameUpdate(host.socket, (game) => game.collages.length === 1);
  state = (await request(guest.socket, 'game:collage', { ownerId: guest.playerId, groupId: state.staged[0].id, cardIds: [sevenId], revision: state.revision })).game;
  const view = await update;
  assert.equal(view.collages[0].group.cards[0].id, sevenId);
  assert.equal(state.openingStatus.totalLaidPoints, 79);
  state = (await request(guest.socket, 'game:discard', { cardId: state.hand[0].id, revision: state.revision })).game;
  assert.equal(state.opened[guest.playerId], true);
  assert.equal(state.openingTotals[guest.playerId], 79); assert.equal(state.firstOpening.total, 79);
  assert.equal(state.laid[guest.playerId][0].cards.length, 4); assert.equal(state.collages.length, 0);
});

for (const actorIndex of [0, 1]) for (const use of ['descente', 'collage']) for (const decision of ['return', 'commit']) {
 test(`two live players: player ${actorIndex + 1} tries, undoes, returns, draws or commits pickup via ${use} (${decision})`, {timeout:10000}, async t => {
  let engine, top, cards, end;
  const {request,create,join}=await setup(t,{makeRound:order=>{
   engine=createRound(order);
   Object.assign(engine,{stock:buildDeck(),hands:Object.fromEntries(order.map(id=>[id,[]])),initialDiscard:false,phase:'draw',activePlayerId:order[actorIndex],contextPlayerId:null,turns:{},mustDiscard:Object.fromEntries(order.map(id=>[id,false])),opened:Object.fromEntries(order.map(id=>[id,true])),openingTotals:Object.fromEntries(order.map(id=>[id,71]))});
   const take=rank=>engine.stock.splice(engine.stock.findIndex(c=>c.rank===rank&&c.suit==='hearts'),1)[0];
   top=take('4');cards=['2','3'].map(take);end=take('R');
   engine.hands[order[actorIndex]].push(...cards,end);
   if(use==='collage') engine.laid[order[actorIndex]].push({id:'base',type:'suite',cards:['5','6','7'].map(take)});
   for(const id of order)while(engine.hands[id].length<14)engine.hands[id].push(engine.stock.pop());
   engine.discard.push(top);return engine;
  }});
  const host=await create(),guest=await join(host.room.code),players=[host,guest];
  for(const p of players)await request(p.socket,'player:ready',{ready:true});await request(host.socket,'room:start');
  const actor=players[actorIndex],other=players[1-actorIndex];
  const state=async p=>(await request(p.socket,'game:state')).game;
  async function move(event,data={}) {const g=await state(actor);const result=await request(actor.socket,event,{revision:g.revision,...data});assert.equal(result.ok,true,JSON.stringify(result));return result.game;}
  async function blocked() {const g=await state(other);assert.equal(g.canDraw,false);const before=structuredClone(engine);assertInvalid(await request(other.socket,'game:draw',{source:'stock',revision:g.revision}));assert.deepEqual(engine,before);}
  async function stage() {return use==='descente'?move('game:stage',{groups:[{type:'suite',cardIds:[...cards.map(c=>c.id),top.id]}]}):move('game:collage',{ownerId:actor.playerId,groupId:'base',cardIds:[top.id]});}
  await move('game:draw',{source:'discard',cardId:top.id});await blocked();
  let g=await state(actor);assertInvalid(await request(actor.socket,'game:discard',{cardId:end.id,revision:g.revision}));
  assertInvalid(await request(actor.socket,'game:discard',{cardId:top.id,revision:g.revision}));
  await stage();await blocked();await move('game:undo',{all:false});await blocked();
  g=await state(actor);assert.equal(g.canCancelDiscard,true);
  assertInvalid(await request(actor.socket,'game:cancel-discard',{cardId:end.id,revision:g.revision}));
  if (decision === 'return') {
   const beforeHand=engine.hands[actor.playerId].filter(c=>c.id!==top.id);
   g=await move('game:cancel-discard',{cardId:top.id});
   assert.deepEqual(g.hand,beforeHand);assert.equal(g.discardTop.id,top.id);
   assert.equal(g.mustDiscard[actor.playerId],false);assert.equal(g.canDraw,true);assert.equal(g.canTakeDiscard,false);
   assert.equal((await state(other)).canDraw,false);
   g=await move('game:draw',{source:'stock'});
   assert.equal(g.mustDiscard[actor.playerId],true);assert.equal(g.hand.length,beforeHand.length+1);
   assert.equal((await state(other)).canDraw,true);
   await move('game:discard',{cardId:end.id});
   assert.equal(engine.discard.at(-1).id,end.id);
   const all=[...engine.stock,...engine.discard,...Object.values(engine.hands).flat(),...Object.values(engine.laid).flat().flatMap(group=>group.cards)];
   assert.equal(all.length,108);assert.equal(new Set(all.map(c=>c.id)).size,108);
   return;
  }
  // Commit the legal use after trying and undoing it.
  await stage();await move('game:discard',{cardId:end.id});
  assert.equal(engine.discard.at(-1).id,end.id);assert.equal((await state(other)).canDraw,true);
  assert.ok(Object.values(engine.laid).flat().some(group=>group.cards.some(c=>c.id===top.id)));
  // The other player can try that new discard, then return exactly it and draw stock.
  let remote=await state(other);
  remote=(await request(other.socket,'game:draw',{source:'discard',cardId:end.id,revision:remote.revision})).game;
  assert.ok(remote);assert.equal((await state(actor)).canDraw,false);
  const stale=remote.revision;
  remote=(await request(other.socket,'game:cancel-discard',{cardId:end.id,revision:remote.revision})).game;
  assert.ok(remote);assert.equal(remote.canDraw,true);assert.equal(remote.mustDiscard[other.playerId],false);assert.equal(remote.discardTop.id,end.id);
  assertInvalid(await request(other.socket,'game:cancel-discard',{cardId:end.id,revision:stale}));
  assertInvalid(await request(other.socket,'game:draw',{source:'discard',revision:remote.revision}));
  remote=(await request(other.socket,'game:draw',{source:'stock',revision:remote.revision})).game;
  assert.ok(remote);assert.equal(remote.mustDiscard[other.playerId],true);
  const all=[...engine.stock,...engine.discard,...Object.values(engine.hands).flat(),...Object.values(engine.laid).flat().flatMap(g=>g.cards)];
  assert.equal(all.length,108);assert.equal(new Set(all.map(c=>c.id)).size,108);
 });
}
