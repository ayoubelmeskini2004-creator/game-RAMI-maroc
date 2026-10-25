import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound,buildDeck,drawCard,discardCard,privateGame } from '../src/game.js';
import { stageGroups,retrieveStaged,undoStaging,startTurnStaging,stageCollage } from '../src/descente.js';
import { actOnTurn } from '../src/turns.js';
import { cancelPickup } from '../src/pickup-return.js';
import { physicalCards } from '../test-support/match-scenarios.js';
function fixture(){
 const g=createRound(['a','b']);Object.assign(g,{stock:buildDeck(),hands:{a:[],b:[]},initialDiscard:false,activePlayerId:'a',phase:'discard',mustDiscard:{a:true,b:false},opened:{a:true,b:false},openingTotals:{a:100},firstOpening:{playerId:'a',total:100}});
 const take=(rank,suit='hearts')=>{const index=g.stock.findIndex(c=>c.rank===rank&&c.suit===(rank==='Joker'?null:suit));assert.ok(index>=0);return g.stock.splice(index,1)[0];};
 const begin=()=>{while(g.hands.a.length<14)g.hands.a.push(g.stock.pop());while(g.hands.b.length<14)g.hands.b.push(g.stock.pop());startTurnStaging(g,'a');};
 const act=(operation,payload)=>actOnTurn(g,'a',{revision:g.revision,...payload},operation);
 return {g,take,begin,act};
}
function conserve(g){const cards=physicalCards(g);assert.equal(cards.length,108);assert.equal(new Set(cards.map(card=>card.id)).size,108);}
test('atomic mouse retrieval handles arbitrary counts, separate groups, partial runs and Carré to Tierce',()=>{
 const {g,take,begin,act}=fixture();const run=['4','5','6','7','8','9'].map(r=>take(r,'spades'));const square=['hearts','clubs','diamonds','spades'].map(s=>take('D',s));g.hands.a.push(...run,...square);begin();
 act(stageGroups,{groups:[{type:'suite',cardIds:run.map(c=>c.id)},{type:'carre',cardIds:square.map(c=>c.id)}]});
 const [r,s]=g.staged,revision=g.revision,history=g.turnUndo.length;
 act(retrieveStaged,{selections:[{ownerId:'a',groupId:r.id,cardIds:run.slice(0,3).map(c=>c.id)},{ownerId:'a',groupId:s.id,cardIds:[square[0].id]}]});
 assert.equal(g.revision,revision+1);assert.equal(g.turnUndo.length,history+1);assert.equal(g.staged[0].cards.length,3);assert.equal(g.staged[1].type,'tierce');conserve(g);
 act(undoStaging,{all:false});assert.equal(g.staged[0].cards.length,6);assert.equal(g.staged[1].cards.length,4);conserve(g);
});
test('a single mouse retrieval dissolves an incomplete provisional group without leaving invalid cards',()=>{
 for(const type of ['suite','tierce','carre']){
  const {g,take,begin,act}=fixture();const cards=type==='suite'?['A','2','3'].map(r=>take(r,'clubs')):(type==='carre'?['clubs','diamonds','hearts','spades']:['clubs','diamonds','hearts']).map(s=>take('R',s));g.hands.a.push(...cards);begin();
  act(stageGroups,{groups:[{type,cardIds:cards.map(c=>c.id)}]});const id=g.staged[0].id;
  act(retrieveStaged,{selections:[{ownerId:'a',groupId:id,cardIds:type==='carre'?cards.slice(0,2).map(c=>c.id):[cards[0].id]}]});
  assert.equal(g.staged.length,0);for(const card of cards)assert.ok(g.hands.a.some(c=>c.id===card.id));conserve(g);
 }
});
test('invalid batches, foreign or committed cards and stale versions fail atomically',()=>{
 const {g,take,begin,act}=fixture();const cards=['8','9','10'].map(r=>take(r,'diamonds'));g.hands.a.push(...cards);begin();act(stageGroups,{groups:[{type:'suite',cardIds:cards.map(c=>c.id)}]});const groupId=g.staged[0].id;
 const valid={ownerId:'a',groupId,cardIds:cards.map(c=>c.id)};
 for(const selections of [[valid,{ownerId:'b',groupId:'foreign',cardIds:['missing']}],[{...valid,cardIds:[cards[0].id,cards[0].id]}],[{...valid,ownerId:'b'}],[valid,valid],[]]){
  const before=structuredClone(g);assert.throws(()=>act(retrieveStaged,{selections}));assert.deepEqual(g,before);
 }
 const before=structuredClone(g);assert.throws(()=>actOnTurn(g,'a',{revision:g.revision-1,selections:[valid]},retrieveStaged));assert.deepEqual(g,before);conserve(g);
 g.turns.b={staged:[],collages:[{groupId}],recoveries:[],turnUndo:[],turnBaseHand:[],discardTakenCardId:null};
 const locked=structuredClone(g);assert.throws(()=>act(retrieveStaged,{selections:[valid]}));assert.deepEqual(g,locked);delete g.turns.b;
 discardCard(g,'a',{revision:g.revision,cardId:g.hands.a[0].id});drawCard(g,'a',{revision:g.revision,source:'stock'});
 const committed=structuredClone(g);assert.throws(()=>act(retrieveStaged,{selections:[valid]}));assert.deepEqual(g,committed);conserve(g);
});
test('all 108 physical pickups, including duplicates and Jokers, return then allow an immediate stock draw',()=>{
 for(let index=0;index<108;index++){
  const {g,begin}=fixture();const top=g.stock.splice(index,1)[0];g.discard.push(top);begin();g.turns={};g.contextPlayerId=null;g.mustDiscard.a=false;g.phase='draw';
  const baseline=g.hands.a.map(c=>c.id).sort();drawCard(g,'a',{revision:g.revision,source:'discard',cardId:top.id});
  cancelPickup(g,'a',{revision:g.revision,cardId:top.id});assert.equal(g.discard.at(-1).id,top.id);assert.deepEqual(g.hands.a.map(c=>c.id).sort(),baseline);assert.equal(privateGame(g,'a').canDraw,true);
  drawCard(g,'a',{revision:g.revision,source:'stock'});assert.equal(g.mustDiscard.a,true);conserve(g);
 }
});
test('retrieving a used pickup and all other poses permits its exact return despite retained undo history',()=>{
 const {g,take,begin,act}=fixture();const cards=['8','9'].map(r=>take(r,'diamonds')),top=take('10','diamonds');g.hands.a.push(...cards);g.discard.push(top);begin();g.turns={};g.contextPlayerId=null;g.mustDiscard.a=false;g.phase='draw';
 drawCard(g,'a',{revision:g.revision,source:'discard',cardId:top.id});act(stageGroups,{groups:[{type:'suite',cardIds:[...cards.map(c=>c.id),top.id]}]});
 assert.equal(privateGame(g,'a').canCancelDiscard,false);act(retrieveStaged,{selections:[{ownerId:'a',groupId:g.staged[0].id,cardIds:[top.id]}]});
 assert.ok(g.turnUndo.length>0);assert.equal(privateGame(g,'a').canCancelDiscard,true);cancelPickup(g,'a',{revision:g.revision,cardId:top.id});assert.equal(privateGame(g,'a').canDraw,true);conserve(g);
});

test('removing an interior provisional Collage returns its additions while preserving the committed base',()=>{
 const {g,take,begin,act}=fixture();const base=['5','6','7'].map(r=>take(r,'hearts')),added=['8','9','10'].map(r=>take(r,'hearts'));
 g.laid.a=[{id:'committed',type:'suite',cards:base}];g.hands.a.push(...added);begin();
 act(stageCollage,{ownerId:'a',groupId:'committed',cardIds:added.map(c=>c.id)});
 act(retrieveStaged,{selections:[{ownerId:'a',groupId:'committed',cardIds:[added[1].id]}]});
 assert.deepEqual(g.laid.a[0].cards,base);assert.equal(g.collages.length,0);for(const card of added)assert.ok(g.hands.a.some(c=>c.id===card.id));conserve(g);
});
