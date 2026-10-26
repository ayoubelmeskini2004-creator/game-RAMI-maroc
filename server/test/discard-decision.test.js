import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound,buildDeck,drawCard,discardCard,privateGame } from '../src/game.js';
import { stageGroups,undoStaging,startTurnStaging,openingStatus,retrieveStaged } from '../src/descente.js';
import { actOnTurn } from '../src/turns.js';
import { cancelPickup } from '../src/pickup-return.js';
import { physicalCards } from '../test-support/match-scenarios.js';
function fixture(count,index){
 const order=['a','b','c','d'].slice(0,count),actor=order[index],g=createRound(order);Object.assign(g,{stock:buildDeck(),hands:Object.fromEntries(order.map(id=>[id,[]])),initialDiscard:false,activePlayerId:actor,contextPlayerId:null,phase:'draw',turns:{},mustDiscard:Object.fromEntries(order.map(id=>[id,false])),opened:Object.fromEntries(order.map(id=>[id,true])),openingTotals:Object.fromEntries(order.map(id=>[id,100]))});
 const take=(rank,suit)=>{const i=g.stock.findIndex(c=>c.rank===rank&&c.suit===suit);assert.ok(i>=0);return g.stock.splice(i,1)[0];};
 const top=take('10','clubs'),copy=take('10','clubs'),run=[take('8','clubs'),take('9','clubs'),top];g.hands[actor].push(copy,...run.slice(0,2));const other=order[(index+1)%count],otherRun=['4','5','6'].map(rank=>take(rank,'hearts'));g.hands[other].push(...otherRun);
 for(const id of order)while(g.hands[id].length<14)g.hands[id].push(g.stock.pop());g.discard=[g.stock.pop(),top];
 return{g,order,actor,other,top,copy,run,otherRun};
}
const action=(g,id,op,payload)=>actOnTurn(g,id,{revision:g.revision,...payload},op);
function invalid(g,op){const before=structuredClone(g);assert.throws(op,{message:'Coup invalide'});assert.deepEqual(g,before);}
function conserve(g){const cards=physicalCards(g);assert.equal(cards.length,108);assert.equal(new Set(cards.map(c=>c.id)).size,108);}
for(const count of [2,3,4])for(let index=0;index<count;index++)test(`discard decision at seat ${index+1}/${count} locks all draws through reversible trials and returns the exact physical card`,()=>{
 const {g,order,actor,other,top,copy,run}=fixture(count,index),baseline=g.hands[actor].map(c=>c.id).sort(),pile=structuredClone(g.discard);drawCard(g,actor,{revision:g.revision,source:'discard',cardId:top.id});
 for(const id of order)for(const source of ['stock','discard']){invalid(g,()=>drawCard(g,id,{revision:g.revision,source}));assert.equal(privateGame(g,id).canDraw,false);}
 invalid(g,()=>discardCard(g,actor,{revision:g.revision,cardId:copy.id}));invalid(g,()=>discardCard(g,actor,{revision:g.revision,cardId:top.id}));assert.equal(privateGame(g,actor).canDiscard,false);
 action(g,actor,stageGroups,{groups:[{type:'suite',cardIds:run.map(c=>c.id)}]});assert.equal(privateGame(g,actor).canDiscard,true);invalid(g,()=>drawCard(g,other,{revision:g.revision,source:'stock'}));
 action(g,actor,undoStaging,{all:true});assert.equal(privateGame(g,actor).canCancelDiscard,true);assert.equal(privateGame(g,other).canDraw,false);
 invalid(g,()=>cancelPickup(g,actor,{revision:g.revision,cardId:copy.id}));invalid(g,()=>cancelPickup(g,actor,{revision:g.revision-1,cardId:top.id}));
 cancelPickup(g,actor,{revision:g.revision,cardId:top.id});assert.deepEqual(g.discard,pile);assert.deepEqual(g.hands[actor].map(c=>c.id).sort(),baseline);assert.equal(g.mustDiscard[actor],false);assert.equal(privateGame(g,actor).canDraw,true);
 const revision=g.revision,stock=g.stock.at(-1).id;drawCard(g,actor,{revision,source:'stock'});assert.ok(g.hands[actor].some(c=>c.id===stock));assert.equal(g.mustDiscard[actor],true);assert.equal(privateGame(g,other).canDraw,true);conserve(g);
});
for(const count of [2,3,4])for(let index=0;index<count;index++)test(`seat ${index+1}/${count} must commit the borrowed card and discard a different physical card before unlocking`,()=>{
 const {g,actor,other,top,copy,run}=fixture(count,index);drawCard(g,actor,{revision:g.revision,source:'discard',cardId:top.id});action(g,actor,stageGroups,{groups:[{type:'suite',cardIds:run.map(c=>c.id)}]});
 assert.equal(privateGame(g,other).canDraw,false);discardCard(g,actor,{revision:g.revision,cardId:copy.id});assert.ok(g.laid[actor].some(group=>group.cards.some(c=>c.id===top.id)));assert.equal(g.discard.at(-1).id,copy.id);assert.equal(privateGame(g,other).canDraw,true);assert.equal(g.pickupReturns[actor],undefined);conserve(g);
});
test('a previous overlapping preparation can stay reversible but cannot change the pile until the pickup is resolved',()=>{
 const {g,actor,other,top,otherRun}=fixture(2,0);startTurnStaging(g,other);g.activePlayerId=actor;g.phase='draw';drawCard(g,actor,{revision:g.revision,source:'discard',cardId:top.id});
 action(g,other,stageGroups,{groups:[{type:'suite',cardIds:otherRun.map(c=>c.id)}]});assert.equal(privateGame(g,actor).canCancelDiscard,true);assert.equal(privateGame(g,other).canDiscard,false);
 invalid(g,()=>discardCard(g,other,{revision:g.revision,cardId:g.hands[other][0].id}));cancelPickup(g,actor,{revision:g.revision,cardId:top.id});assert.equal(privateGame(g,other).canDiscard,true);assert.ok(privateGame(g,other).staged.length);conserve(g);
});

test('a complete 72-point opening using the identical other copy cannot satisfy the picked-card obligation',()=>{
 const g=createRound(['a','b']);Object.assign(g,{stock:buildDeck(),hands:{a:[],b:[]},initialDiscard:false,activePlayerId:'a',contextPlayerId:null,phase:'draw',mustDiscard:{a:false,b:false}});
 const take=(rank,suit)=>g.stock.splice(g.stock.findIndex(c=>c.rank===rank&&c.suit===suit),1)[0];
 const top=take('10','clubs'),copy=take('10','clubs'),run=[take('8','clubs'),take('9','clubs'),copy],kings=['clubs','diamonds','hearts'].map(suit=>take('R',suit)),extra=['4','5','6'].map(rank=>take(rank,'hearts')),end=take('2','diamonds');
 g.hands.a.push(...run,...kings,...extra,end);for(const id of g.order)while(g.hands[id].length<14)g.hands[id].push(g.stock.pop());g.discard=[top];drawCard(g,'a',{source:'discard',cardId:top.id,revision:g.revision});
 action(g,'a',stageGroups,{groups:[{type:'suite',cardIds:run.map(c=>c.id)},{type:'tierce',cardIds:kings.map(c=>c.id)},{type:'suite',cardIds:extra.map(c=>c.id)}]});
 assert.equal(openingStatus(g,'a').valid,true);assert.equal(openingStatus(g,'a').totalLaidPoints,72);invalid(g,()=>discardCard(g,'a',{cardId:end.id,revision:g.revision}));invalid(g,()=>discardCard(g,'a',{cardId:top.id,revision:g.revision}));
 action(g,'a',retrieveStaged,{groupId:g.staged[0].id});action(g,'a',stageGroups,{groups:[{type:'suite',cardIds:[run[0].id,run[1].id,top.id]}]});discardCard(g,'a',{cardId:copy.id,revision:g.revision});assert.equal(g.openingTotals.a,72);assert.ok(g.laid.a.some(group=>group.cards.some(card=>card.id===top.id)));conserve(g);
});
