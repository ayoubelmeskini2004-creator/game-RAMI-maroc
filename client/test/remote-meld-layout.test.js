import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteMeldLayout } from '../src/table/remote-meld-layout.js';
const group=(id,x,y,width=130,height=70)=>({id,position:{x,y},width,height});
test('spectator layout keeps distinct stored anchors without mutating them',()=>{
  const groups=[group('a',0,0),group('b',1,1)];
  const before=structuredClone(groups);
  assert.deepEqual(remoteMeldLayout(groups,330).positions,{a:{left:0,top:0},b:{left:200,top:170}});
  assert.deepEqual(groups,before);
});
test('coincident and growing melds stay separated and extend the scroll surface',()=>{
  const groups=Array.from({length:8},(_,i)=>group(String(i),.5,.5,200,i===0?150:70));
  const layout=remoteMeldLayout(groups,240);
  for(let i=1;i<groups.length;i++)assert.ok(layout.positions[i].top>=layout.positions[i-1].top+groups[i-1].height+10);
  assert.ok(layout.height>700);
  assert.deepEqual(remoteMeldLayout(groups,240),layout);
});
test('empty and resized views retain a usable canvas and fit long wrapped groups',()=>{
  assert.deepEqual(remoteMeldLayout([],220),{positions:{},height:240});
  const layout=remoteMeldLayout([group('long',1,0,208,220),group('next',1,0,150,70)],208);
  assert.equal(layout.positions.long.left,0);
  assert.equal(layout.positions.next.top,230);
  assert.equal(layout.height,310);
});
