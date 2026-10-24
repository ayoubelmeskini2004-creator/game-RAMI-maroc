import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, createRound, discardCard, privateGame, publicGame } from '../src/game.js';
import { validateCombination } from '../src/combinations.js';
import { startTurnStaging, recoverJoker, reverseJokerRecovery, stageGroups, stageCollage, retrieveStaged, undoStaging } from '../src/descente.js';
import { effectiveGroup } from '../src/collage.js';

function fixture(mode = 'individual') {
  const game = createRound(['a', 'b', 'c', 'd']);
  Object.assign(game, { stock: buildDeck(), hands: { a: [], b: [], c: [], d: [] }, activePlayerId: 'a', initialDiscard: false,
    mode, teams: { a: 'A', b: 'B', c: 'A', d: 'B' }, opened: { a: true, b: true, c: true, d: true },
    openingTotals: { a: 71, b: 120, c: 90, d: 100 }, firstOpening: { playerId: 'a', total: 71 } });
  let serial = 0;
  function take(rank, suit = 'hearts') {
    const i = game.stock.findIndex((card) => card.rank === rank && card.suit === (rank === 'Joker' ? null : suit));
    assert.ok(i >= 0, `available ${rank} ${suit}`); return game.stock.splice(i, 1)[0];
  }
  function hand(rank, suit) { const card = take(rank, suit); game.hands.a.push(card); return card; }
  function group(type, ranks, suits = 'hearts', face) {
    const cards = ranks.map((rank, i) => take(rank, Array.isArray(suits) ? suits[i] : suits));
    const joker = cards.find((card) => card.rank === 'Joker');
    const proposal = { type, cardIds: cards.map((card) => card.id), ...(joker ? { joker: { cardId: joker.id, ...face } } : {}) };
    return { cards, proposal };
  }
  function laid(owner, type = 'suite', ranks = ['8', 'Joker', '10'], suits = 'hearts', face = { rank: '9', suit: 'hearts' }) {
    const value = group(type, ranks, suits, face); const result = validateCombination(value.proposal, value.cards);
    assert.equal(result.valid, true); const base = { id: `g${++serial}`, type, cards: result.cards }; game.laid[owner].push(base); return base;
  }
  function proposal(type, ranks, suits, face) { const value = group(type, ranks, suits, face); game.hands.a.push(...value.cards); return value.proposal; }
  const begin = () => startTurnStaging(game, 'a');
  const recover = (ownerId, base, card, jokerId = base.cards.find((c) => c.rank === 'Joker').id) => recoverJoker(game, 'a', { revision: game.revision, ownerId, groupId: base.id, jokerId, cardId: card.id });
  const stage = (groups) => stageGroups(game, 'a', { revision: game.revision, groups });
  const discard = (card) => discardCard(game, 'a', { revision: game.revision, cardId: card.id });
  const reverse = (ownerId, base, jokerId = base.cards.find((c) => c.rank === 'Joker').id) => reverseJokerRecovery(game, 'a', { revision: game.revision, ownerId, groupId: base.id, jokerId });
  const undo = (all = false) => undoStaging(game, 'a', { revision: game.revision, all });
  const reuse = (joker, cards, type = 'suite', face = { rank: '5', suit: 'clubs' }) => stage([{ type, cardIds: [cards[0].id, joker.id, cards[1].id], joker: { cardId: joker.id, ...face } }]);
  return { game, hand, laid, proposal, begin, recover, reverse, stage, discard, undo, reuse };
}
function invalid(game, action) { const before = structuredClone(game); assert.throws(action, { message: 'Coup invalide' }); assert.deepEqual(game, before); }
function conserve(game) {
  const cards = [...game.stock, ...game.discard, ...Object.values(game.hands).flat(),
    ...game.order.flatMap((id) => game.laid[id].map((g) => effectiveGroup(game, id, g))).flatMap((g) => g.cards),
    ...game.staged.flatMap((g) => effectiveGroup(game, game.activePlayerId, g).cards)];
  assert.equal(cards.length, 108); assert.equal(new Set(cards.map((c) => c.id)).size, 108);
}

for (const [mode, owner] of [['individual', 'a'], ['teams', 'c'], ['individual', 'b'], ['teams', 'b']]) {
  test(`Joker recovery from ${owner} in ${mode} ignores opponent Collage threshold and commits exact replacement`, () => {
    const f = fixture(mode); const { game, laid, hand, begin, recover, reuse, discard } = f;
    const base = laid(owner), original = structuredClone(base), natural = hand('9'), end = hand('2', 'spades');
    const cards = [hand('4', 'clubs'), hand('6', 'clubs')]; begin(); recover(owner, base, natural);
    assert.deepEqual(base, original); assert.equal(effectiveGroup(game, owner, base).cards[1].id, natural.id);
    assert.equal(game.hands.a.at(-1).id, original.cards[1].id); conserve(game);
    const joker = game.hands.a.at(-1); invalid(game, () => discard(end)); invalid(game, () => discard(joker));
    reuse(joker, cards); conserve(game); discard(end); conserve(game);
    assert.equal(game.laid[owner][0].cards[1].id, natural.id); assert.equal(game.recoveries.length, 0);
    assert.ok(game.laid.a.some((g) => g.cards.some((c) => c.id === joker.id))); assert.equal(game.roundResult.winnerId, 'a');
  });
}

test('wrong rank, suit, physical ownership, target, assignment and stale turn are rejected atomically', () => {
  const { game, laid, hand, begin, recover } = fixture(); const base = laid('b');
  const wrongRank = hand('7'), wrongSuit = hand('9', 'spades'), correct = hand('9'); begin();
  invalid(game, () => recover('b', base, wrongRank)); invalid(game, () => recover('b', base, wrongSuit));
  invalid(game, () => recover('b', base, { id: 'foreign' })); invalid(game, () => recover('c', base, correct));
  invalid(game, () => recover('b', base, correct, base.cards[0].id));
  invalid(game, () => recoverJoker(game, 'a', { ownerId: 'b', groupId: base.id, jokerId: base.cards[1].id, cardId: correct.id, revision: game.revision + 1 }));
  game.initialDiscard = true; invalid(game, () => recover('b', base, correct)); game.initialDiscard = false;
  game.phase = 'round-ended'; invalid(game, () => recover('b', base, correct)); game.phase = 'discard';
  invalid(game, () => recoverJoker(game, 'b', { revision: game.revision }));
  base.cards[1].substitution = { rank: '7', suit: 'hearts' }; invalid(game, () => recover('b', base, wrongRank));
});

test('unopened players need a complete escalated staged opening before recovery', () => {
  const f = fixture(); const { game, laid, hand, proposal, begin, recover, stage, reuse, discard } = f;
  game.opened.a = false; delete game.openingTotals.a; game.firstOpening = null;
  const base = laid('b'), natural = hand('9');
  const suite = proposal('suite', ['8', '9', '10'], 'diamonds');
  const tierce = proposal('tierce', ['R', 'R', 'R'], ['hearts', 'diamonds', 'spades']);
  const extra = proposal('suite', ['4', '5', '6'], 'spades');
  const cards = [hand('4', 'clubs'), hand('6', 'clubs')], end = hand('2', 'clubs'); begin();
  invalid(game, () => recover('b', base, natural)); stage([suite]); invalid(game, () => recover('b', base, natural));
  stage([tierce, extra]); game.firstOpening = { playerId: 'b', total: 80 };
  invalid(game, () => recover('b', base, natural)); game.firstOpening = null;
  recover('b', base, natural); reuse(game.hands.a.find((c) => c.rank === 'Joker'), cards); discard(end);
  assert.equal(game.opened.a, true); assert.equal(game.openingTotals.a, 87); conserve(game);
});

test('multiple recovered Jokers must all be reused and cannot be discarded; original hand Joker can be discarded', () => {
  const { game, laid, hand, begin, recover, reuse, discard } = fixture();
  const first = laid('b'), second = laid('c', 'suite', ['D', 'R', 'Joker'], 'spades', { rank: 'A', suit: 'spades' });
  const nine = hand('9'), ace = hand('A', 'spades'), held = hand('Joker');
  const c1 = [hand('4', 'clubs'), hand('6', 'clubs')], c2 = [hand('7', 'diamonds'), hand('9', 'diamonds')]; begin();
  recover('b', first, nine); const j1 = game.hands.a.at(-1); recover('c', second, ace); const j2 = game.hands.a.at(-1);
  conserve(game); reuse(j1, c1); invalid(game, () => discard(held)); invalid(game, () => discard(j2));
  reuse(j2, c2, 'suite', { rank: '8', suit: 'diamonds' }); discard(held); conserve(game);
  assert.equal(game.discard.at(-1).id, held.id);
});

test('latest undo and undo-all restore hand contents, Joker slots and mixed Collage exactly', () => {
  const { game, laid, hand, begin, recover, undo } = fixture();
  const base = laid('a'), natural = hand('9'), seven = hand('7'); hand('2', 'clubs'); begin();
  const baseline = structuredClone(game.hands.a);
  stageCollage(game, 'a', { revision: game.revision, ownerId: 'a', groupId: base.id, cardIds: [seven.id] });
  recover('a', base, natural); conserve(game); undo(); conserve(game);
  assert.equal(game.recoveries.length, 0); assert.equal(game.collages[0].addedCardIds[0], seven.id);
  recover('a', base, natural); undo(true); conserve(game);
  assert.deepEqual(game.hands.a, baseline); assert.deepEqual(effectiveGroup(game, 'a', base), base); assert.equal(game.collages.length, 0);
});

test('explicit reversal preserves other additions and is itself undoable', () => {
  const { game, laid, hand, begin, recover, reverse, undo, discard } = fixture();
  const base = laid('a'), natural = hand('9'), seven = hand('7'), end = hand('2', 'clubs'); begin(); recover('a', base, natural);
  stageCollage(game, 'a', { revision: game.revision, ownerId: 'a', groupId: base.id, cardIds: [seven.id] });
  reverse('a', base); conserve(game); assert.equal(game.collages[0].group.cards[2].rank, 'Joker');
  undo(); assert.equal(game.recoveries.length, 1); reverse('a', base); discard(end); conserve(game);
  assert.equal(game.laid.a[0].cards[2].rank, 'Joker'); assert.ok(game.hands.a.some((c) => c.id === natural.id));
});

test('a reused Joker must be retrieved before reversal; retrieving it blocks final discard again', () => {
  const { game, laid, hand, begin, recover, reverse, reuse, discard } = fixture();
  const base = laid('b'), natural = hand('9'), end = hand('2', 'spades'), cards = [hand('4', 'clubs'), hand('6', 'clubs')]; begin();
  recover('b', base, natural); const joker = game.hands.a.at(-1); reuse(joker, cards);
  invalid(game, () => reverse('b', base));
  retrieveStaged(game, 'a', { revision: game.revision, groupId: game.staged[0].id }); conserve(game);
  invalid(game, () => discard(end)); reverse('b', base); discard(end); conserve(game);
});

for (const type of ['tierce', 'carre']) test(`${type} recovery preserves every committed suit and rejects taking replacement cards`, () => {
  const { game, laid, hand, begin, recover, reverse } = fixture();
  const ranks = type === 'tierce' ? ['R', 'Joker', 'R'] : ['R', 'Joker', 'R', 'R'];
  const base = laid('b', type, ranks, ['hearts', null, 'clubs', 'spades'], { rank: 'R', suit: 'diamonds' });
  const natural = hand('R', 'diamonds'); begin(); recover('b', base, natural); conserve(game);
  assert.deepEqual(effectiveGroup(game, 'b', base).cards.map((c) => c.suit), type === 'tierce' ? ['hearts', 'diamonds', 'clubs'] : ['hearts', 'diamonds', 'clubs', 'spades']);
  invalid(game, () => retrieveStaged(game, 'a', { revision: game.revision, ownerId: 'b', groupId: base.id, cardId: natural.id }));
  reverse('b', base); conserve(game);
});

test('recovery does not grant normal opponent Collage rights, even on the same affected group', () => {
  const { game, laid, hand, begin, recover } = fixture(); const base = laid('b'), natural = hand('9'), seven = hand('7'); begin(); recover('b', base, natural);
  invalid(game, () => stageCollage(game, 'a', { revision: game.revision, ownerId: 'b', groupId: base.id, cardIds: [seven.id] })); conserve(game);
});

test('own staged source remains valid and cannot be retrieved until its replacement is reversed', () => {
  const { game, hand, proposal, begin, stage, recover, reverse } = fixture();
  const p = proposal('suite', ['8', 'Joker', '10'], 'hearts', { rank: '9', suit: 'hearts' });
  const natural = hand('9'); hand('2', 'clubs'); begin(); stage([p]); const base = game.staged[0]; recover('a', base, natural); conserve(game);
  invalid(game, () => retrieveStaged(game, 'a', { revision: game.revision, groupId: base.id })); reverse('a', base);
  retrieveStaged(game, 'a', { revision: game.revision, groupId: base.id }); conserve(game);
});

test('public recovery state exposes only already-public replacements; private flags and unrelated hands stay isolated', () => {
  const { game, laid, hand, begin, recover } = fixture(); const base = laid('b'), natural = hand('9'), secret = hand('2', 'spades'); begin(); recover('b', base, natural);
  const publicState = publicGame(game), mine = privateGame(game, 'a'), theirs = privateGame(game, 'b');
  assert.equal(JSON.stringify(publicState).includes(secret.id), false); assert.equal(JSON.stringify(theirs).includes(secret.id), false);
  assert.equal(publicState.hand, undefined); assert.deepEqual(theirs.recoveredJokerIds, []);
  assert.deepEqual(mine.pendingRecoveredJokerIds, [base.cards[1].id]); assert.deepEqual(mine.reversibleRecoveryIds, [base.cards[1].id]); conserve(game);
});

test('final discard revalidates every affected group and the recovery ledger before any commit', () => {
  const { game, laid, hand, begin, recover, reuse, discard } = fixture();
  const base = laid('b'), natural = hand('9'), end = hand('2', 'spades'), cards = [hand('4', 'clubs'), hand('6', 'clubs')];
  begin(); recover('b', base, natural); reuse(game.hands.a.at(-1), cards);
  const valid = structuredClone(game.collages[0]);
  game.collages[0].group.cards.reverse(); invalid(game, () => discard(end));
  game.collages[0] = valid;
  const record = structuredClone(game.recoveries[0]);
  game.recoveries[0].natural.suit = 'spades'; invalid(game, () => discard(end));
  game.recoveries[0] = record; discard(end); conserve(game);
});

test('recovering from own new group and reusing that physical Joker commits both groups without loss', () => {
  const { game, hand, proposal, begin, stage, recover, reuse, discard } = fixture();
  const p = proposal('suite', ['8', 'Joker', '10'], 'hearts', { rank: '9', suit: 'hearts' });
  const natural = hand('9'), end = hand('2', 'spades'), cards = [hand('4', 'clubs'), hand('6', 'clubs')];
  begin(); stage([p]); const source = game.staged[0], joker = source.cards[1];
  recover('a', source, natural); reuse(joker, cards); conserve(game); discard(end); conserve(game);
  assert.equal(game.laid.a[0].cards[1].id, natural.id); assert.equal(game.laid.a[1].cards[1].id, joker.id);
});

test('undo-all after multiple recoveries and reuse restores every original source slot and hand', () => {
  const { game, laid, hand, begin, recover, reuse, undo } = fixture('teams');
  const a = laid('b'), b = laid('c', 'suite', ['2', 'Joker', '4'], 'diamonds', { rank: '3', suit: 'diamonds' });
  const nine = hand('9'), three = hand('3', 'diamonds'), cards = [hand('4', 'clubs'), hand('6', 'clubs')]; hand('2', 'spades'); begin();
  const baseline = structuredClone(game.hands.a);
  recover('b', a, nine); reuse(game.hands.a.at(-1), cards); recover('c', b, three); conserve(game);
  undo(true); conserve(game); assert.deepEqual(game.hands.a, baseline);
  assert.deepEqual(effectiveGroup(game, 'b', a), a); assert.deepEqual(effectiveGroup(game, 'c', b), b);
});
