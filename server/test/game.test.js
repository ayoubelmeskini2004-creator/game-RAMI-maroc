import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, secureShuffle, seatingOrder, createRound, drawCard, discardCard, publicGame, privateGame } from '../src/game.js';

const ids = ['alice', 'bob', 'chloe', 'david'];
const allCards = (game) => [...game.stock, ...game.discard, ...Object.values(game.hands).flat()];
function conserve(game) {
  const cards = allCards(game);
  assert.equal(cards.length, 108);
  assert.equal(new Set(cards.map((card) => card.id)).size, 108);
}
function invalidWithoutMutation(game, operation) {
  const before = structuredClone(game);
  assert.throws(operation, { message: 'Coup invalide' });
  assert.deepEqual(game, before);
}
function discard(game) {
  const id = game.activePlayerId;
  discardCard(game, id, { cardId: game.hands[id][0].id, revision: game.revision });
}

test('108 physical cards: two copies of every standard face and exactly four Jokers', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map((card) => card.id)).size, 108);
  assert.equal(deck.filter((card) => card.rank === 'Joker').length, 4);
  for (const suit of ['hearts', 'diamonds', 'clubs', 'spades']) {
    assert.equal(deck.filter((card) => card.suit === suit).length, 26);
    for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R']) {
      assert.equal(deck.filter((card) => card.suit === suit && card.rank === rank).length, 2);
    }
  }
  assert.equal(deck.filter((card) => card.rank === 'Joker').every((card) => card.suit === null), true);
});

test('secure shuffle preserves all physical cards and leaves the source array intact', () => {
  const deck = buildDeck();
  const original = [...deck];
  const shuffled = secureShuffle(deck);
  assert.notEqual(shuffled, deck);
  assert.deepEqual(deck, original);
  assert.deepEqual(shuffled.map((card) => card.id).sort(), deck.map((card) => card.id).sort());
});

for (const count of [2, 3, 4]) {
  test(`deals 15 to random starter and 14 to others with ${count} players`, () => {
    const order = ids.slice(0, count);
    const game = createRound(order);
    assert.ok(order.includes(game.starterId));
    assert.equal(game.activePlayerId, game.starterId);
    assert.equal(game.phase, 'discard');
    assert.equal(game.initialDiscard, true);
    assert.equal(game.round, 1);
    assert.equal(game.discard.length, 0);
    assert.equal(game.stock.length, 108 - 14 * count - 1);
    for (const id of order) assert.equal(game.hands[id].length, id === game.starterId ? 15 : 14);
    conserve(game);
  });
}

test('next-round starter rotates clockwise, and each round uses a fresh deck', () => {
  let game = createRound(ids);
  for (let n = 0; n < 8; n++) {
    const previous = game;
    game = createRound(ids, previous);
    assert.equal(game.starterId, ids[(ids.indexOf(previous.starterId) + 1) % 4]);
    assert.equal(game.round, previous.round + 1);
    const previousIds = new Set(allCards(previous).map((card) => card.id));
    assert.equal(allCards(game).some((card) => previousIds.has(card.id)), false);
    conserve(game);
  }
});

test('team order alternates teams and puts teammates opposite', () => {
  const players = ids.map((id, i) => ({ id, team: i < 2 ? 'A' : 'B' }));
  assert.deepEqual(seatingOrder(players, 'teams'), ['alice', 'chloe', 'bob', 'david']);
  assert.deepEqual(seatingOrder(players, 'individual'), ids);
});

test('initial discard passes clockwise; drawings overlap but previous discards remain required', () => {
  const game = createRound(ids), starter = game.starterId;
  invalidWithoutMutation(game, () => drawCard(game, starter, {source:'stock',revision:0}));
  discard(game); assert.equal(game.activePlayerId,ids[(ids.indexOf(starter)+1)%4]); assert.equal(game.phase,'draw');
  assert.equal(game.initialDiscard,false); assert.equal(game.hands[starter].length,14);
  for(let n=0;n<16;n++) {
    const active=game.activePlayerId;
    if(game.phase==='discard') { invalidWithoutMutation(game,()=>drawCard(game,active,{source:'stock',revision:game.revision})); discard(game); assert.equal(game.activePlayerId,active); }
    const count=game.hands[active].length, stock=game.stock.length;
    invalidWithoutMutation(game,()=>discardCard(game,active,{cardId:game.hands[active][0].id,revision:game.revision}));
    drawCard(game,active,{source:'stock',revision:game.revision});
    assert.equal(game.stock.length,stock-1); assert.equal(game.hands[active].length,count+1);
    assert.equal(game.activePlayerId,ids[(ids.indexOf(active)+1)%4]);
    assert.equal(game.mustDiscard[active],true);
    invalidWithoutMutation(game,()=>drawCard(game,active,{source:'stock',revision:game.revision})); conserve(game);
  }
});

test('rejects impersonation, foreign/invalid card IDs, stale revisions and malformed payloads atomically', () => {
  const game = createRound(ids);
  const active = game.activePlayerId;
  const other = ids.find((id) => id !== active);
  for (const payload of [null, {}, { cardId: 42, revision: 0 }, { cardId: 'invented', revision: 0 }, { cardId: game.hands[other][0].id, revision: 0 }, { cardId: game.hands[active][0].id, revision: -1 }]) {
    invalidWithoutMutation(game, () => discardCard(game, active, payload));
  }
  invalidWithoutMutation(game, () => discardCard(game, other, { cardId: game.hands[other][0].id, revision: 0 }));
  invalidWithoutMutation(game, () => discardCard(game, 'intruder', { cardId: game.hands[active][0].id, revision: 0 }));
  discard(game);
  for (const payload of [null, {}, { source: 'fake', revision: 1 }, { source: 'stock', revision: 0 }]) {
    invalidWithoutMutation(game, () => drawCard(game, game.activePlayerId, payload));
  }
});

test('unopened players cannot take discard; an internal opened flag only permits the very top card', () => {
  const game = createRound(ids);
  discard(game);
  for (let i = 0; i < 8; i++) {
    if (game.phase === 'discard') discard(game);
    drawCard(game, game.activePlayerId, { source: 'stock', revision: game.revision });
  }
  if (game.phase === 'discard') discard(game);
  const active = game.activePlayerId;
  const unopened = structuredClone(game);
  drawCard(game, active, { source: 'discard', revision: game.revision, opened: true });
  assert.equal(game.opened[active],false);
  invalidWithoutMutation(game,()=>discardCard(game,active,{cardId:game.hands[active][0].id,revision:game.revision}));
  Object.assign(game,unopened);
  assert.equal(Object.values(game.opened).every((opened) => !opened), true);
  // This isolated draw test sets the flag internally; socket clients must use a validated opening.
  game.opened[active] = true;
  const top = game.discard.at(-1);
  const older = game.discard.slice(0, -1);
  drawCard(game, active, { source: 'discard', revision: game.revision, cardId: top.id });
  assert.equal(game.hands[active].at(-1).id, top.id);
  assert.deepEqual(game.discard, older);
  assert.notEqual(game.activePlayerId, active);
  conserve(game);
});

test('empty stock recycles only buried discards, preserves the top and all 108 cards', () => {
  const game = createRound(ids);
  discard(game);
  while (game.stock.length) {
    if (game.phase === 'discard') discard(game);
    drawCard(game, game.activePlayerId, { source: 'stock', revision: game.revision });
    conserve(game);
  }
  if (game.phase === 'discard') discard(game);
  const top = game.discard.at(-1);
  const buried = new Set(game.discard.slice(0, -1).map((card) => card.id));
  const active = game.activePlayerId;
  drawCard(game, active, { source: 'stock', revision: game.revision });
  assert.deepEqual(game.discard, [top]);
  assert.ok(buried.has(game.hands[active].at(-1).id));
  assert.equal(game.stock.length, buried.size - 1);
  assert.equal(game.stock.some((card) => card.id === top.id), false);
  conserve(game);
});

test('empty stock with no recyclable discards rejects drawing without corrupting state', () => {
  const game = createRound(ids);
  discard(game);
  game.hands[ids[0]].push(...game.stock.splice(0));
  invalidWithoutMutation(game, () => drawCard(game, game.activePlayerId, { source: 'stock', revision: game.revision }));
  game.hands[ids[0]].push(...game.discard.splice(0));
  invalidWithoutMutation(game, () => drawCard(game, game.activePlayerId, { source: 'stock', revision: game.revision }));
  conserve(game);
});

test('public/private projections never include stock order, buried discard cards or another hand', () => {
  const game = createRound(ids);
  discard(game);
  drawCard(game, game.activePlayerId, { source: 'stock', revision: game.revision });
  if (game.phase === 'discard') discard(game);
  const publicState = publicGame(game);
  assert.equal('hand' in publicState, false);
  assert.equal('hands' in publicState, false);
  assert.equal('stock' in publicState, false);
  assert.equal('discard' in publicState, false);
  for (const id of ids) {
    const view = privateGame(game, id);
    assert.deepEqual(view.hand, game.hands[id]);
    const encoded = JSON.stringify(view);
    for (const other of ids.filter((p) => p !== id)) {
      for (const card of game.hands[other]) assert.equal(encoded.includes(card.id), false);
    }
    for (const card of game.stock) assert.equal(encoded.includes(card.id), false);
    for (const card of game.discard.slice(0, -1)) assert.equal(encoded.includes(card.id), false);
    assert.equal(view.discardTop.id, game.discard.at(-1).id);
  }
  assert.throws(() => privateGame(game, 'intruder'), { message: 'Coup invalide' });
  const view = privateGame(game, ids[0]);
  view.hand[0].rank = 'modified';
  assert.notEqual(game.hands[ids[0]][0].rank, 'modified');
});
