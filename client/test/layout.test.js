import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeSeats } from '../src/table/layout.js';

const players = [
  { id: 'a1', team: 'A' }, { id: 'b1', team: 'B' },
  { id: 'b2', team: 'B' }, { id: 'a2', team: 'A' },
];

test('each team player sees their teammate opposite and opponents on either side', () => {
  for (const player of players) {
    const seats = arrangeSeats(players, player.id, 'teams');
    assert.equal(seats.bottom.id, player.id);
    assert.equal(seats.top.team, player.team);
    assert.notEqual(seats.left.team, player.team);
    assert.notEqual(seats.right.team, player.team);
    assert.equal(new Set(Object.values(seats).map((p) => p.id)).size, 4);
  }
  assert.deepEqual(players.map((p) => p.id), ['a1', 'b1', 'b2', 'a2']);
});

test('individual layout puts the viewer at bottom for 2, 3 and 4 players', () => {
  for (const count of [2, 3, 4]) {
    const participants = players.slice(0, count);
    for (const player of participants) {
      const seats = arrangeSeats(participants, player.id, 'individual');
      assert.equal(seats.bottom.id, player.id);
      assert.equal(Object.values(seats).filter(Boolean).length, count);
      assert.equal(new Set(Object.values(seats).filter(Boolean).map((p) => p.id)).size, count);
      if (count === 2) assert.ok(seats.top);
      if (count === 4) assert.ok(seats.top && seats.left && seats.right);
    }
  }
});

test('individual seats follow the server clockwise order from each viewpoint', () => {
  for (let i = 0; i < players.length; i++) {
    const seats = arrangeSeats(players, players[i].id, 'individual');
    assert.equal(seats.left.id, players[(i + 1) % 4].id);
    assert.equal(seats.top.id, players[(i + 2) % 4].id);
    assert.equal(seats.right.id, players[(i + 3) % 4].id);
  }
});
