import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticOrder, moveCard, orderedHand, reconcileOrder, readOrder, replaceVisibleOrder, validHandDrag } from '../src/table/hand-order.js';
const card = (id, rank = '2', suit = 'hearts') => ({ id, rank, suit });
test('manual moves preserve every physical card and selection objects without mutation', () => {
  const cards = ['a','b','c','d'].map((id) => Object.freeze(card(id))); const order = Object.freeze(['a','b','c','d']);
  assert.deepEqual(moveCard(order, cards, 'd', 'b'), ['a','d','b','c']);
  assert.deepEqual(moveCard(order, cards, 'a'), ['b','c','d','a']);
  assert.deepEqual(moveCard(order, cards, 'a', 'a'), order);
  assert.deepEqual(moveCard(order, cards, 'unknown', 'a'), order);
  assert.equal(orderedHand(order, cards)[0], cards[0]);
});
test('draws append; staging, undo and recovery retain remembered slots', () => {
  const cards = ['a','b','c'].map((id) => card(id));
  let order = moveCard([], cards, 'c', 'a');
  const staged = [cards[0], cards[1], card('draw')];
  order = reconcileOrder(order, staged);
  assert.deepEqual(orderedHand(order, staged).map((c) => c.id), ['a','b','draw']);
  order = moveCard(order, staged, 'b', 'a');
  assert.deepEqual(orderedHand(order, [...cards, card('draw')]).map((c) => c.id), ['c','b','a','draw']);
  assert.deepEqual(replaceVisibleOrder(order, staged, ['a','b','draw']), ['c','a','b','draw']);
  assert.deepEqual(orderedHand(order, [...staged,card('recovered','Joker',null)]).map((c) => c.id), ['b','a','draw','recovered']);
});
test('automatic sorting groups distinct suits before natural runs and preserves two-deck duplicates', () => {
  const cards = [card('j2','Joker',null),card('h3','3'),card('c9','9','clubs'),card('h2','2'),card('d9','9','diamonds'),card('h9','9'),card('s9','9','spades'),card('h1','A'),card('h9b','9'),card('c9b','9','clubs'),card('d9b','9','diamonds'),card('j1','Joker',null)];
  const before = JSON.stringify(cards); const ids = automaticOrder(cards);
  assert.deepEqual(ids, ['c9','d9','h9','s9','c9b','d9b','h9b','h1','h2','h3','j1','j2']);
  assert.deepEqual(automaticOrder([...cards].reverse()), ids);
  assert.equal(new Set(ids).size, cards.length); assert.equal(JSON.stringify(cards), before);
});
test('Suites include high Ace and two distinct end Aces, never K-A-2', () => {
  assert.deepEqual(automaticOrder([card('a','A'),card('r','R'),card('d','D')]), ['d','r','a']);
  const cards = ['A','2','3','4','5','6','7','8','9','10','V','D','R','A'].map((rank,i)=>card(String(i),rank));
  const sorted = automaticOrder(cards); assert.equal(sorted.length,14);
  assert.deepEqual(sorted.map((id)=>cards.find((c)=>c.id===id).rank),cards.map((c)=>c.rank));
  assert.deepEqual(automaticOrder([card('r','R'),card('a','A'),card('2','2')]), ['a','2','r']);
});
test('reconnection reads only IDs; corrupt or unavailable storage falls back safely', () => {
  const storage = { getItem: () => '["b","a","b"]' };
  assert.deepEqual(orderedHand(readOrder(storage,'key'),[card('a'),card('b')]).map((c)=>c.id),['b','a']);
  assert.deepEqual(readOrder({getItem:()=>'{broken'},'key'),[]);
  assert.deepEqual(readOrder({getItem:()=>{throw Error();}},'key'),[]);
  assert.deepEqual(reconcileOrder([null,12,'a','a'],[card('b')]),['a','b']);
});
test('foreign, stale, wrong-player and no-longer-owned drags cannot reorder', () => {
  const game = {roundId:'round',revision:4,hand:[card('joker','Joker',null)]};
  const data = {cardId:'joker',playerId:'me',roundId:'round',revision:4};
  assert.equal(validHandDrag(data,'joker',game,'me'),true);
  for (const changed of [{playerId:'other'},{roundId:'old'},{revision:3},{cardId:'missing'}]) assert.equal(validHandDrag({...data,...changed},'joker',game,'me'),false);
  assert.equal(validHandDrag(data,null,game,'me'),false);
  assert.deepEqual(replaceVisibleOrder(['joker'],game.hand,['foreign']),['joker']);
});
