import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound,buildDeck,drawCard,discardCard,privateGame } from '../src/game.js';
import { cancelPickup } from '../src/pickup-return.js';
import { actOnTurn,ownRevision } from '../src/turns.js';
import { stageGroups,undoStaging } from '../src/descente.js';
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
test('a following draw or changed pile makes return impossible and preserves all current rights',()=>{
 for(const action of['draw','discard']){
  const{g,actor,other}=setup(),top=g.discard.at(-1).id;drawCard(g,actor,{revision:g.revision,source:'discard',cardId:top});
  drawCard(g,other,{revision:g.revision,source:'stock'});
  if(action==='discard')discardCard(g,other,payload(g,other,{cardId:g.hands[other][0].id}));
  assert.equal(privateGame(g,actor).canCancelDiscard,false);invalid(g,()=>cancelPickup(g,actor,payload(g,actor,{cardId:top})),/action de jeu/);
 }
});
test('a return cannot masquerade as a different physical copy or survive a repeated request',()=>{
 const{g,actor}=setup();const top=g.discard.at(-1);const copy=[...g.stock,...Object.values(g.hands).flat()].find(card=>card.id!==top.id&&card.rank===top.rank&&card.suit===top.suit);
 drawCard(g,actor,{revision:g.revision,source:'discard',cardId:top.id});
 if(copy)invalid(g,()=>cancelPickup(g,actor,payload(g,actor,{cardId:copy.id})),/exactement/);
 const request=payload(g,actor,{cardId:top.id});cancelPickup(g,actor,request);invalid(g,()=>cancelPickup(g,actor,request),/aucune prise/);
});
test('using a pickup in Descente or Collage blocks return even after undoing that use',()=>{
 for(const collage of[false,true]){
  const g=createRound(['a','b']);Object.assign(g,{stock:buildDeck(),hands:{a:[],b:[]},initialDiscard:false,activePlayerId:'a',phase:'draw',contextPlayerId:null,mustDiscard:{a:false,b:false},turns:{}});
  const take=(rank,suit='hearts')=>g.stock.splice(g.stock.findIndex(c=>c.rank===rank&&c.suit===suit),1)[0];
  const cards=['2','3'].map(rank=>take(rank));g.hands.a.push(...cards);
  let top=take('4');
  if(collage){g.opened.a=true;g.openingTotals.a=71;g.laid.a.push({id:'suite',type:'suite',cards:[take('5'),take('6'),take('7')]});}
  while(g.hands.a.length<14)g.hands.a.push(g.stock.pop());while(g.hands.b.length<14)g.hands.b.push(g.stock.pop());g.discard.push(top);
  drawCard(g,'a',{revision:g.revision,source:'discard',...(collage?{target:{ownerId:'a',groupId:'suite'}}:{})});
  if(!collage)actOnTurn(g,'a',{revision:g.revision,groups:[{type:'suite',cardIds:[...cards.map(c=>c.id),top.id]}]},stageGroups);
  assert.equal(privateGame(g,'a').canCancelDiscard,false);invalid(g,()=>cancelPickup(g,'a',payload(g,'a',{cardId:top.id})),/action de jeu|déjà été utilisée/);
  actOnTurn(g,'a',{revision:g.revision,all:true},undoStaging);
  invalid(g,()=>cancelPickup(g,'a',payload(g,'a',{cardId:top.id})),/déjà été utilisée/);
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
