import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound, buildDeck, drawCard, discardCard, privateGame } from '../src/game.js';
import { stageGroups, startTurnStaging, undoStaging, recoverJoker } from '../src/descente.js';
import { actOnTurn } from '../src/turns.js';
import { validateCombination } from '../src/combinations.js';
import { physicalCards } from '../test-support/match-scenarios.js';
const invalid=(game,action)=>{const before=structuredClone(game);assert.throws(action,{message:'Coup invalide'});assert.deepEqual(game,before);};
function fixture(){
  const game=createRound(['a','b']);Object.assign(game,{stock:buildDeck(),hands:{a:[],b:[]},activePlayerId:'a',phase:'draw',initialDiscard:false,mustDiscard:{a:false,b:false}});
  const take=(rank,suit='hearts')=>game.stock.splice(game.stock.findIndex(c=>c.rank===rank&&c.suit===(rank==='Joker'?null:suit)),1)[0];
  const hand=(rank,suit)=>{const card=take(rank,suit);game.hands.a.push(card);return card;};
  const proposal=(ranks,suits='hearts',type='suite')=>({type,cardIds:ranks.map((rank,i)=>hand(rank,Array.isArray(suits)?suits[i]:suits).id)});
  const core=()=>[proposal(['8','9','10']),proposal(['R','R','R'],['clubs','diamonds','spades'],'tierce'),proposal(['4','5','6'],'clubs')];
  game.hands.b.push(take('2','spades'));const end=hand('2','diamonds');
  const stage=groups=>stageGroups(game,'a',{groups,revision:game.revision});
  const draw=(source='stock',openingGroups)=>drawCard(game,'a',{source,openingGroups,revision:game.revision});
  return{game,take,hand,proposal,core,end,stage,draw};
}
for(const count of [2,3,4])test(`draw-pass cycle with ${count} players conserves 108 cards and prevents double drawing`,()=>{
  const order=['a','b','c','d'].slice(0,count);const game=createRound(order);const starter=game.starterId;
  discardCard(game,starter,{cardId:game.hands[starter][0].id,revision:0});
  for(let turn=0;turn<count*5;turn++){
    const actor=game.activePlayerId;
    if(game.phase==='discard') {invalid(game,()=>drawCard(game,actor,{source:'stock',revision:game.revision}));discardCard(game,actor,{cardId:game.hands[actor][0].id,revision:game.revision});}
    const revision=game.revision;
    drawCard(game,actor,{source:'stock',revision});
    assert.equal(game.activePlayerId,order[(order.indexOf(actor)+1)%count]);
    invalid(game,()=>drawCard(game,actor,{source:'stock',revision}));
    assert.equal(physicalCards(game).length,108);assert.equal(new Set(physicalCards(game).map(c=>c.id)).size,108);
    assert.equal(privateGame(game,actor).mustDiscard[actor],true);
  }
  const next=createRound(order,game);assert.equal(next.starterId,order[(order.indexOf(starter)+1)%count]);
  assert.deepEqual(next.mustDiscard,Object.fromEntries(order.map(id=>[id,id===next.starterId])));
});

test('drawing opens a personal preparation while the following player can draw immediately',()=>{
 const f=fixture(),groups=f.core();f.draw();f.stage(groups);
 assert.equal(f.game.opened.a,false);assert.equal(f.game.activePlayerId,'b');
 drawCard(f.game,'b',{source:'stock',revision:f.game.revision});assert.equal(f.game.mustDiscard.a,true);assert.equal(f.game.mustDiscard.b,true);
 discardCard(f.game,'a',{cardId:f.end.id,revision:f.game.revision});assert.equal(f.game.opened.a,true);assert.equal(f.game.openingTotals.a,72);assert.equal(f.game.mustDiscard.b,true);
});
test('incomplete opening blocks only its own discard; next player can draw and undo remains available',()=>{
 const f=fixture(),groups=f.core();f.draw();f.stage([groups[0]]);
 invalid(f.game,()=>discardCard(f.game,'a',{cardId:f.end.id,revision:f.game.revision}));
 drawCard(f.game,'b',{source:'stock',revision:f.game.revision});
 actOnTurn(f.game,'a',{revision:f.game.revision,all:true},undoStaging);
 discardCard(f.game,'a',{cardId:f.end.id,revision:f.game.revision});assert.equal(f.game.opened.a,false);
});
test('no staging before draw; discard clears only the actor obligation and preserves the draw cursor',()=>{
 const f=fixture(),groups=f.core();invalid(f.game,()=>f.stage(groups));f.draw();const cursor=f.game.activePlayerId;
 discardCard(f.game,'a',{cardId:f.end.id,revision:f.game.revision});assert.equal(f.game.activePlayerId,cursor);assert.equal(f.game.mustDiscard.a,false);
 invalid(f.game,()=>f.stage(groups));
});
test('unopened discard pickup allows in-hand preparation, while its opening stays mandatory',()=>{
 const f=fixture(),groups=f.core();const top=f.take('3','clubs');groups[2].cardIds.unshift(top.id);f.game.discard.push(top);f.draw('discard');
 assert.ok(f.game.hands.a.some(c=>c.id===top.id));assert.equal(f.game.opened.a,false);
 invalid(f.game,()=>discardCard(f.game,'a',{cardId:f.end.id,revision:f.game.revision}));
 f.stage(groups);discardCard(f.game,'a',{cardId:f.end.id,revision:f.game.revision});assert.equal(f.game.opened.a,true);
});
test('recovered Joker must be reused before own discard, even after the following player draws',()=>{
 const f=fixture();f.game.opened.a=true;f.game.openingTotals.a=71;
 const cards=[f.take('8'),f.take('Joker'),f.take('10')];const result=validateCombination({type:'suite',cardIds:cards.map(c=>c.id),joker:{cardId:cards[1].id,rank:'9',suit:'hearts'}},cards);
 f.game.laid.b.push({id:'source',type:'suite',cards:result.cards});const natural=f.hand('9'),four=f.hand('4','clubs'),six=f.hand('6','clubs');f.draw();
 actOnTurn(f.game,'a',{ownerId:'b',groupId:'source',jokerId:cards[1].id,cardId:natural.id,revision:f.game.revision},recoverJoker);
 drawCard(f.game,'b',{source:'stock',revision:f.game.revision});
 invalid(f.game,()=>discardCard(f.game,'a',{cardId:f.end.id,revision:f.game.revision}));
 actOnTurn(f.game,'a',{groups:[{type:'suite',cardIds:[four.id,cards[1].id,six.id],joker:{cardId:cards[1].id,rank:'5',suit:'clubs'}}],revision:f.game.revision},stageGroups);
 discardCard(f.game,'a',{cardId:f.end.id,revision:f.game.revision});assert.equal(f.game.laid.a[0].cards[1].id,cards[1].id);
 const physical=physicalCards(f.game);assert.equal(physical.length,108);assert.equal(new Set(physical.map(c=>c.id)).size,108);
});
