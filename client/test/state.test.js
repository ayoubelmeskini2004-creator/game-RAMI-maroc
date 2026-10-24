import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptGame } from '../src/table/state.js';

test('late acknowledgements and resyncs cannot replace a newer round or a replayed deal', () => {
  const current = { round: 2, roundId: 'new', revision: 0 };
  assert.equal(acceptGame(current, { round: 1, roundId: 'old', revision: 99 }), current);
  assert.equal(acceptGame(current, { round: 2, roundId: 'cancelled', revision: 99 }), current);
  assert.equal(acceptGame(current, { round: 2, roundId: 'new', revision: -1 }), current);
  const fresh = { round: 3, roundId: 'next', revision: 0 };
  assert.equal(acceptGame(current, fresh), fresh);
  const update = { ...current, revision: 1 }; assert.equal(acceptGame(current, update), update);
});
