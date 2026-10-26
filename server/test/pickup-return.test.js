import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound,buildDeck,drawCard,discardCard,privateGame } from '../src/game.js';
import { cancelPickup } from '../src/pickup-return.js';
import { actOnTurn,ownRevision } from '../src/turns.js';
import { stageGroups,undoStaging,retrieveStaged } from '../src/descente.js';
import { physicalCards } from '../test-support/match-scenarios.js';
function setup(){const g=createRound(['a','b']);const starter=g.starterId;discardCard(g,starter,{cardId:g.hands[starter][0].id,revision:0});return{g,actor:g.activePlayerId,other:starter};}
const payload=(g,id,extra={})=>({revision:g.revision,turnRevision:ownRevision(g,id),...extra});
function invalid(g,fn,pattern){const before=structuredClone(g);assert.throws(fn,error=>error.message==='Coup invalide'&&pattern.test(error.publicReason));assert.deepEqual(g,before);}
test('legal personal discard survives the following player draw but stale personal actions do not',()=>{
 const{g,actor,other}=setup();drawCard(g,actor,{revision:g.revision,source:'stock'});const stale=payload(g,actor,{cardId:g.hands[actor][0].id});
 drawCard(g,other,{revision:g.revision,source:'stock'});
 invalid(g,()=>discardCard(g,actor,{revision:stale.revision,cardId:stale.cardId}),/ont changé/);
 discardCard(g,actor,stale);assert.equal(g.mustDiscard[actor],false);assert.equal(g.mustDiscard[other],true);
 invalid(g,()=>discardCard(g,actor,stale),/d’abord piocher/);
});
test('returning the exact pickup restores the pile and draw right without consuming a normal discard',()=>{
 const{g,actor}=setup(),before=structuredClone(g),top=g.discard.at(-1).id;
 drawCard(g,actor,{revision:g.revision,source:'discard',cardId:top});assert.equal(privateGame(g,actor).canCancelDiscard,true);
 invalid(g,()=>cancelPickup(g,actor,payload(g,actor,{cardId:g.hands[actor][0].id})),/exactement/);
 cancelPickup(g,actor,payload(g,actor,{cardId:top}));
 assert.deepEqual(g.hands,before.hands);assert.deepEqual(g.discard,before.discard);assert.equal(g.activePlayerId,actor);assert.deepEqual(g.mustDiscard,before.mustDiscard);assert.equal(privateGame(g,actor).canDraw,true);
 invalid(g,()=>discardCard(g,actor,payload(g,actor,{cardId:g.hands[actor][0].id})),/d’abord piocher/);
 drawCard(g,actor,{revision:g.revision,source:'stock'});invalid(g,()=>cancelPickup(g,actor,payload(g,actor,{cardId:top})),/aucune prise/);
 const cards=physicalCards(g);assert.equal(cards.length,108);assert.equal(new Set(cards.map(c=>c.id)).size,108);
});
test('a pending pickup blocks the following draw and preserves its exact return',()=>{
 const{g,actor,other}=setup(),top=g.discard.at(-1).id;
 drawCard(g,actor,{revision:g.revision,source:'discard',cardId:top});
 assert.equal(privateGame(g,other).canDraw,false);
 invalid(g,()=>drawCard(g,other,{revision:g.revision,source:'stock'}),/prise de Défausse/);
 assert.equal(privateGame(g,actor).canCancelDiscard,true);
 cancelPickup(g,actor,payload(g,actor,{cardId:top}));
 const before=structuredClone(g);
 assert.throws(()=>drawCard(g,actor,{revision:g.revision,source:'discard'}),{message:'Coup invalide'});assert.deepEqual(g,before);
 drawCard(g,actor,{revision:g.revision,source:'stock'});
 assert.equal(privateGame(g,other).canDraw,true);
});
test('a return cannot masquerade as a different physical copy or survive a repeated request',()=>{
 const{g,actor}=setup();const top=g.discard.at(-1);const copy=[...g.stock,...Object.values(g.hands).flat()].find(card=>card.id!==top.id&&card.rank===top.rank&&card.suit===top.suit);
 drawCard(g,actor,{revision:g.revision,source:'discard',cardId:top.id});
 if(copy)invalid(g,()=>cancelPickup(g,actor,payload(g,actor,{cardId:copy.id})),/exactement/);
 const request=payload(g,actor,{cardId:top.id});cancelPickup(g,actor,request);invalid(g,()=>cancelPickup(g,actor,request),/aucune prise/);
});
test('a pickup used in Descente or Collage can return after its reversible use is undone',()=>{
 for(const collage of[false,true]){
  const g=createRound(['a','b']);Object.assign(g,{stock:buildDeck(),hands:{a:[],b:[]},initialDiscard:false,activePlayerId:'a',phase:'draw',contextPlayerId:null,mustDiscard:{a:false,b:false},turns:{}});
  const take=(rank,suit='hearts')=>g.stock.splice(g.stock.findIndex(c=>c.rank===rank&&c.suit===suit),1)[0];
  const cards=['2','3'].map(rank=>take(rank));g.hands.a.push(...cards);
  let top=take('4');
  if(collage){g.opened.a=true;g.openingTotals.a=71;g.laid.a.push({id:'suite',type:'suite',cards:[take('5'),take('6'),take('7')]});}
  while(g.hands.a.length<14)g.hands.a.push(g.stock.pop());while(g.hands.b.length<14)g.hands.b.push(g.stock.pop());g.discard.push(top);
  drawCard(g,'a',{revision:g.revision,source:'discard',...(collage?{target:{ownerId:'a',groupId:'suite'}}:{})});
  if(!collage)actOnTurn(g,'a',{revision:g.revision,groups:[{type:'suite',cardIds:[...cards.map(c=>c.id),top.id]}]},stageGroups);
  assert.equal(privateGame(g,'a').canCancelDiscard,false);invalid(g,()=>cancelPickup(g,'a',payload(g,'a',{cardId:top.id})),/action de jeu|Récupérez/);
  actOnTurn(g,'a',{revision:g.revision,all:true},undoStaging);
  assert.equal(privateGame(g,'a').canCancelDiscard,true);
  cancelPickup(g,'a',payload(g,'a',{cardId:top.id}));
  assert.equal(g.discard.at(-1).id,top.id);
  assert.equal(privateGame(g,'a').canDraw,true);
  const physical=physicalCards(g);assert.equal(new Set(physical.map(c=>c.id)).size,108);
 }
});
test('undoing an unrelated reversible pose permits return if the picked card was never used',()=>{
 const g=createRound(['a','b']);Object.assign(g,{stock:buildDeck(),hands:{a:[],b:[]},initialDiscard:false,activePlayerId:'a',phase:'draw',contextPlayerId:null,mustDiscard:{a:false,b:false},turns:{}});
 const take=rank=>g.stock.splice(g.stock.findIndex(c=>c.rank===rank&&c.suit==='hearts'),1)[0];const cards=['2','3','4'].map(take),top=take('9');g.hands.a.push(...cards);
 for(const id of g.order)while(g.hands[id].length<14)g.hands[id].push(g.stock.pop());g.discard.push(top);
 drawCard(g,'a',{revision:g.revision,source:'discard'});actOnTurn(g,'a',{revision:g.revision,groups:[{type:'suite',cardIds:cards.map(c=>c.id)}]},stageGroups);
 assert.equal(privateGame(g,'a').canCancelDiscard,false);actOnTurn(g,'a',{revision:g.revision,all:true},undoStaging);
 assert.equal(privateGame(g,'a').canCancelDiscard,true);cancelPickup(g,'a',payload(g,'a',{cardId:top.id}));assert.equal(g.discard.at(-1).id,top.id);assert.equal(g.hands.a.length,14);
});

for (const count of [2,3,4]) test(`${count} players: a pending pickup reserves piles without blocking reversible preparations`,()=>{
 const g=createRound(['a','b','c','d'].slice(0,count));
 discardCard(g,g.starterId,{cardId:g.hands[g.starterId][0].id,revision:g.revision});
 // Start a stock preparation before the next player takes the discard.
 const preparing=g.activePlayerId;
 drawCard(g,preparing,{source:'stock',revision:g.revision});
 const actor=g.activePlayerId,top=g.discard.at(-1).id;
 drawCard(g,actor,{source:'discard',cardId:top,revision:g.revision});
 assert.equal(privateGame(g,actor).pickupDecisionPlayerId,actor);
 invalid(g,()=>discardCard(g,preparing,payload(g,preparing,{cardId:g.hands[preparing][0].id})),/décision/);
 for(const id of g.order){
  assert.equal(privateGame(g,id).canDraw,false);
  invalid(g,()=>drawCard(g,id,{source:'stock',revision:g.revision}),/prise de Défausse/);
 }
 cancelPickup(g,actor,payload(g,actor,{cardId:top}));
 assert.equal(privateGame(g,actor).pickupDecisionPlayerId,null);
 assert.equal(privateGame(g,actor).canTakeDiscard,false);
 drawCard(g,actor,{source:'stock',revision:g.revision});
 assert.equal(privateGame(g,actor).canTakeDiscard,true);
 assert.equal(g.mustDiscard[preparing],true);
 const all=physicalCards(g);assert.equal(all.length,108);assert.equal(new Set(all.map(c=>c.id)).size,108);
});
