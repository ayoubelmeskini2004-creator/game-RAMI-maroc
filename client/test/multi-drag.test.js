import test from 'node:test';
import assert from 'node:assert/strict';
import { moveCards, orderedHand, validHandDrag } from '../src/table/hand-order.js';
import { naturalProposal } from '../src/table/group-proposal.js';
import { cardLabel } from '../src/table/card-label.js';
import { acceptGame } from '../src/table/state.js';
test('J Q K are presentation labels; internal ranks remain V D R',()=>{
  const ranks=['V','D','R','A','Joker'];assert.deepEqual(ranks.map(cardLabel),['J','Q','K','A','Joker']);assert.deepEqual(ranks,['V','D','R','A','Joker']);
});
test('multi-card reorder preserves visual relative order, physical duplicates and absent undo anchors',()=>{
  const cards=['a','b','c','d','joker','duplicate'].map(id=>({id,rank:id==='joker'?'Joker':'2',suit:id==='joker'?null:'hearts'}));
  const order=['a','absent','b','c','d','joker','duplicate'];
  const next=moveCards(order,cards,['joker','b','c'],'a');
  assert.deepEqual(orderedHand(next,cards).map(c=>c.id),['b','c','joker','a','d','duplicate']);
  assert.equal(next[1],'absent');assert.deepEqual(order,['a','absent','b','c','d','joker','duplicate']);
  assert.deepEqual(moveCards(order,cards,['a','b'],'b'),order);
  assert.deepEqual(orderedHand(moveCards(order,cards,['a','c'],'c'),cards).map(c=>c.id),['b','a','c','d','joker','duplicate']);
  assert.deepEqual(moveCards(order,cards,['a','a'],null),order);
  assert.deepEqual(moveCards(order,cards,['b','a'],null).filter(id=>id!=='absent'),['c','d','joker','duplicate','a','b']);
});
test('multi-card payload rejects foreign IDs, duplicates and stale turns',()=>{
  const game={roundId:'r',revision:3,hand:[{id:'a'},{id:'b'}]};const data={roundId:'r',revision:3,playerId:'p',cardId:'b',cardIds:['a','b']};
  assert.equal(validHandDrag(data,'b',game,'p'),true);
  for(const cardIds of [['a','a'],['foreign','b'],[],['a']])assert.equal(validHandDrag({...data,cardIds},'b',game,'p'),false);
});
test('natural drop proposes correct sets and Ace Suites without inventing Joker substitutions',()=>{
  const cards=(ranks,suits)=>ranks.map((rank,i)=>({id:String(i),rank,suit:Array.isArray(suits)?suits[i]:suits}));
  assert.deepEqual(naturalProposal(cards(['R','A','D'],'hearts')),{type:'suite',cardIds:['2','0','1']});
  assert.equal(naturalProposal(cards(['9','9','9'],['hearts','clubs','spades'])).type,'tierce');
  assert.equal(naturalProposal(cards(['9','9','9','9'],['hearts','clubs','spades','diamonds'])).type,'carre');
  for(const input of [cards(['R','A','2'],'hearts'),cards(['9','9','9'],['hearts','hearts','clubs']),cards(['2','Joker','4'],'hearts')])assert.equal(naturalProposal(input),null);
});
test('layout and gameplay revisions merge independently across late acknowledgements',()=>{
  const state={round:1,roundId:'r',revision:5,layoutRevision:4,groupPositions:{g:{x:.2,y:.3}},phase:'draw'};
  const newerLayout={...state,revision:4,layoutRevision:5,groupPositions:{g:{x:.8,y:.6}},phase:'discard'};
  const merged=acceptGame(state,newerLayout);assert.equal(merged.phase,'draw');assert.equal(merged.revision,5);assert.equal(merged.groupPositions.g.x,.8);
  const newerGame={...state,revision:6,layoutRevision:3,phase:'discard'};
  const next=acceptGame(merged,newerGame);assert.equal(next.revision,6);assert.equal(next.layoutRevision,5);assert.equal(next.groupPositions.g.x,.8);
});
