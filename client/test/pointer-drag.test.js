import test from 'node:test';
import assert from 'node:assert/strict';
import { pastDragThreshold,handInsertion } from '../src/table/pointer-drag.js';
test('a stationary click or small mouse jitter never starts a drag',()=>{
 assert.equal(pastDragThreshold({x:100,y:100},{x:100,y:100}),false);
 assert.equal(pastDragThreshold({x:100,y:100},{x:103,y:103}),false);
 assert.equal(pastDragThreshold({x:100,y:100},{x:106,y:100}),true);
 assert.equal(pastDragThreshold({x:100,y:100},{x:94,y:98}),true);
});
test('insertion uses the exposed strips of overlapped cards at start, middle and end',()=>{
 const cards=[{id:'a',left:10,right:78},{id:'b',left:40,right:108},{id:'c',left:70,right:138}];
 assert.equal(handInsertion(cards,10),'a');assert.equal(handInsertion(cards,42),'b');
 assert.equal(handInsertion(cards,80),'c');assert.equal(handInsertion(cards,137),null);
 assert.equal(handInsertion([],100),null);
});
