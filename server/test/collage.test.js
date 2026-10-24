import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, createRound, discardCard, privateGame, publicGame } from '../src/game.js';
import { validateCombination } from '../src/combinations.js';
import { stageGroups, stageCollage, retrieveStaged, undoStaging, startTurnStaging, openingStatus } from '../src/descente.js';
import { effectiveGroup, recordedCollageTotal, canCollageOn } from '../src/collage.js';

function fixture(mode = 'individual') {
  const game = createRound(['a', 'b', 'c', 'd']);
  game.stock = buildDeck(); game.hands = { a: [], b: [], c: [], d: [] };
  game.activePlayerId = 'a'; game.initialDiscard = false; game.phase = 'discard';
  game.mode = mode; game.teams = { a: 'A', b: 'B', c: 'A', d: 'B' };
  game.opened = { a: true, b: true, c: true, d: true };
  game.openingTotals = { a: 90, b: 80, c: 110, d: 100 };
  game.firstOpening = { playerId: 'b', total: 80 };
  let serial = 0;
  function take(rank, suit = 'hearts') {
    const i = game.stock.findIndex((card) => card.rank === rank && card.suit === (rank === 'Joker' ? null : suit));
    assert.ok(i >= 0, `${rank} ${suit} available`);
    return game.stock.splice(i, 1)[0];
  }
  function hand(rank, suit = 'hearts') { const card = take(rank, suit); game.hands.a.push(card); return card; }
  function proposal(type, ranks, suits = 'hearts', jokerFace) {
    const cards = ranks.map((rank, i) => take(rank, Array.isArray(suits) ? suits[i] : suits));
    const joker = cards.find((card) => card.rank === 'Joker');
    return { cards, proposal: { type, cardIds: cards.map((card) => card.id), ...(joker ? { joker: { cardId: joker.id, ...jokerFace } } : {}) } };
  }
  function laid(owner, type = 'suite', ranks = ['8', '9', '10'], suits = 'hearts', jokerFace) {
    const value = proposal(type, ranks, suits, jokerFace);
    const result = validateCombination(value.proposal, value.cards); assert.equal(result.valid, true);
    const group = { id: `group-${++serial}`, type, cards: result.cards };
    game.laid[owner].push(group); return group;
  }
  function staged(type, ranks, suits = 'hearts', jokerFace) {
    const value = proposal(type, ranks, suits, jokerFace); game.hands.a.push(...value.cards); return value.proposal;
  }
  const begin = () => startTurnStaging(game, 'a');
  const collage = (ownerId, group, cards, side) => stageCollage(game, 'a', { revision: game.revision, ownerId, groupId: group.id, cardIds: cards.map((card) => card.id), ...(side ? { side } : {}) });
  const discard = (card) => discardCard(game, 'a', { revision: game.revision, cardId: card.id });
  const stage = (groups) => stageGroups(game, 'a', { revision: game.revision, groups });
  const retrieve = (group, card) => retrieveStaged(game, 'a', { revision: game.revision, groupId: group.id, ...(card ? { cardId: card.id } : {}) });
  const undo = (all = false) => undoStaging(game, 'a', { revision: game.revision, all });
  return { game, take, hand, laid, staged, begin, collage, discard, stage, retrieve, undo };
}
function invalid(game, operation) {
  const before = structuredClone(game);
  assert.throws(operation, { message: 'Coup invalide' });
  assert.deepEqual(game, before);
}
function conserve(game) {
  const cards = [...game.stock, ...game.discard, ...Object.values(game.hands).flat(),
    ...Object.values(game.laid).flat().flatMap((group) => group.cards), ...game.staged.flatMap((group) => group.cards),
    ...game.collages.flatMap((overlay) => overlay.group.cards.filter((card) => overlay.addedCardIds.includes(card.id)))];
  assert.equal(cards.length, 108);
  assert.equal(new Set(cards.map((card) => card.id)).size, 108);
}

test('own committed Suite accepts prepend and append without changing its base until discard', () => {
  const { game, laid, hand, begin, collage, discard } = fixture();
  const base = laid('a'); const original = structuredClone(base);
  const seven = hand('7'), jack = hand('V'), end = hand('2', 'clubs'); begin();
  collage('a', base, [seven]); collage('a', base, [jack]);
  assert.deepEqual(base, original);
  assert.deepEqual(effectiveGroup(game, 'a', base).cards.map((card) => card.rank), ['7', '8', '9', '10', 'V']);
  assert.equal(game.collages[0].addedCardIds.length, 2);
  conserve(game); discard(end);
  assert.equal(game.laid.a[0].cards.length, 5);
  assert.equal(game.collages.length, 0);
  assert.equal(game.openingTotals.a, 90);
  assert.equal(game.phase, 'round-ended'); conserve(game);
});

test('unopened or incomplete-opening players cannot collage on any group', () => {
  const { game, laid, hand, staged, begin, collage, stage } = fixture();
  game.opened.a = false; delete game.openingTotals.a; game.firstOpening = null;
  const base = laid('b'); const seven = hand('7');
  const partial = staged('suite', ['4', '5', '6'], 'clubs'); hand('2', 'clubs'); begin();
  invalid(game, () => collage('b', base, [seven]));
  stage([partial]);
  invalid(game, () => collage('b', base, [seven]));
  assert.deepEqual(privateGame(game, 'a').collageTargets, []);
});

test('same-turn complete opening grants provisional Collage; own staged additions contribute only to own opening', () => {
  const { game, laid, hand, staged, begin, collage, stage, discard } = fixture();
  game.opened.a = false; delete game.openingTotals.a; game.firstOpening = null; game.openingTotals.b = 78;
  const enemy = laid('b', 'suite', ['8', '9', '10'], 'spades');
  const groups = [staged('suite', ['8', '9', '10']), staged('tierce', ['R', 'R', 'R'], ['clubs', 'diamonds', 'spades']), staged('suite', ['4', '5', '6'], 'clubs')];
  const ownSeven = hand('7'), enemySeven = hand('7', 'spades'), end = hand('2', 'clubs'); begin(); stage(groups);
  assert.equal(openingStatus(game, 'a').totalLaidPoints, 72);
  invalid(game, () => collage('b', enemy, [enemySeven]));
  collage('a', game.staged[0], [ownSeven]);
  assert.equal(openingStatus(game, 'a').totalLaidPoints, 79);
  collage('b', enemy, [enemySeven]);
  assert.equal(openingStatus(game, 'a').totalLaidPoints, 79);
  assert.equal(game.opened.a, false);
  discard(end);
  assert.equal(game.firstOpening.total, 79);
  assert.equal(game.openingTotals.a, 79);
  assert.equal(game.laid.a[0].cards.length, 4);
  assert.equal(game.laid.b[0].cards.length, 4); conserve(game);
});

test('opponent threshold uses recorded opening totals strictly, not current laid scores or forged payload totals', () => {
  for (const total of [79, 80, 81]) {
    const { game, laid, hand, begin, collage } = fixture();
    game.openingTotals.a = total;
    const base = laid('b'); const seven = hand('7'); hand('2', 'clubs'); begin();
    if (total <= 80) {
      invalid(game, () => collage('b', base, [seven]));
      invalid(game, () => stageCollage(game, 'a', { ownerId: 'b', groupId: base.id, cardIds: [seven.id], revision: game.revision, openingTotal: 10000, team: 'B', opened: true }));
    } else collage('b', base, [seven]);
    assert.equal(game.collages.length, total > 80 ? 1 : 0); conserve(game);
  }
});

test('team partners are eligible after own opening regardless of totals; the same team labels do not apply in individual mode', () => {
  for (const mode of ['teams', 'individual']) {
    const { game, laid, hand, begin, collage } = fixture(mode);
    const base = laid('c'); const seven = hand('7'); hand('2', 'clubs'); begin();
    assert.ok(game.openingTotals.a < game.openingTotals.c);
    if (mode === 'teams') collage('c', base, [seven]); else invalid(game, () => collage('c', base, [seven]));
    conserve(game);
  }
  const { game, laid, hand, begin, collage } = fixture('teams');
  const base = laid('c'); const seven = hand('7'); hand('2', 'clubs'); begin(); game.opened.a = false;
  invalid(game, () => collage('c', base, [seven]));
});

test('server-owned team-exception metadata inherits donor eligibility and rejects invalid inheritance links', () => {
  const { game, laid, hand, begin, collage } = fixture('teams');
  game.openingTotals.a = 71; game.openingInheritedFrom.a = 'c';
  const base = laid('d'); const seven = hand('7'); hand('2', 'clubs'); begin();
  assert.equal(recordedCollageTotal(game, 'a'), 110);
  collage('d', base, [seven]);
  assert.equal(game.openingTotals.a, 71);
  game.openingInheritedFrom.a = 'b';
  assert.equal(recordedCollageTotal(game, 'a'), null);
  assert.equal(canCollageOn(game, 'a', 'd'), false);
  game.openingInheritedFrom.a = 'c'; game.openingInheritedFrom.c = 'a';
  assert.equal(recordedCollageTotal(game, 'a'), null);
  game.openingInheritedFrom = {}; assert.equal(recordedCollageTotal(game, 'a'), 71);
});

test('Tierce extends to Carré; duplicate suits, fifth cards, Joker additions and gaps are rejected atomically', () => {
  const { game, laid, hand, begin, collage } = fixture();
  const base = laid('a', 'tierce', ['9', '9', '9'], ['hearts', 'clubs', 'diamonds']);
  const fourth = hand('9', 'spades'), repeated = hand('9', 'hearts'), joker = hand('Joker'); hand('2', 'clubs'); begin();
  invalid(game, () => collage('a', base, [repeated]));
  invalid(game, () => collage('a', base, [joker]));
  collage('a', base, [fourth]);
  assert.equal(effectiveGroup(game, 'a', base).type, 'carre');
  invalid(game, () => collage('a', base, [repeated]));
  conserve(game);
  const run = fixture(); const target = run.laid('a'); const gap = run.hand('6'); run.hand('2', 'clubs'); run.begin();
  invalid(run.game, () => run.collage('a', target, [gap]));
});

test('a Tierce with a fixed Joker can receive only the unused fourth suit, without replacing the Joker', () => {
  const { game, laid, hand, begin, collage, retrieve } = fixture();
  const base = laid('a', 'tierce', ['9', 'Joker', '9'], ['hearts', 'clubs', 'diamonds'], { rank: '9', suit: 'clubs' });
  const fourth = hand('9', 'spades'), duplicate = hand('9', 'clubs'); hand('2', 'clubs'); begin();
  invalid(game, () => collage('a', base, [duplicate]));
  collage('a', base, [fourth]);
  const current = effectiveGroup(game, 'a', base);
  assert.equal(current.type, 'carre');
  assert.deepEqual(current.cards.find((card) => card.rank === 'Joker').substitution, { rank: '9', suit: 'clubs' });
  invalid(game, () => retrieve(base, base.cards[1]));
  retrieve(base, fourth);
  assert.equal(game.collages.length, 0);
  assert.equal(base.type, 'tierce'); conserve(game);
});

test('same-turn eligibility requires the escalated opening threshold before any Collage, not just 71 naturals', () => {
  const { game, hand, staged, begin, stage, collage } = fixture();
  game.opened.a = false; delete game.openingTotals.a;
  const groups = [staged('suite', ['8', '9', '10']), staged('tierce', ['R', 'R', 'R'], ['clubs', 'diamonds', 'spades']), staged('suite', ['4', '5', '6'], 'clubs')];
  const seven = hand('7'); hand('2', 'clubs'); begin(); stage(groups);
  assert.equal(openingStatus(game, 'a').qualifyingNaturalPoints, 72);
  assert.equal(openingStatus(game, 'a').minimumTotal, 81);
  invalid(game, () => collage('a', game.staged[0], [seven]));
});

test('Suite end Aces respect low/high rules and two physical Aces can bound a 14-card Suite', () => {
  for (const [ranks, added, expected] of [[['2', '3', '4'], 'A', ['A', '2', '3', '4']], [['V', 'D', 'R'], 'A', ['V', 'D', 'R', 'A']]]) {
    const { game, laid, hand, begin, collage } = fixture();
    const base = laid('a', 'suite', ranks); const ace = hand(added); hand('2', 'clubs'); begin(); collage('a', base, [ace]);
    assert.deepEqual(effectiveGroup(game, 'a', base).cards.map((card) => card.rank), expected); conserve(game);
  }
  const { game, laid, hand, begin, collage } = fixture();
  const base = laid('a', 'suite', ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R']);
  const highAce = hand('A'), another = hand('2'); hand('2', 'clubs'); begin(); collage('a', base, [highAce]);
  assert.equal(effectiveGroup(game, 'a', base).cards.length, 14);
  assert.equal(effectiveGroup(game, 'a', base).cards.at(-1).points, 10);
  assert.equal(effectiveGroup(game, 'a', base).cards[0].points, 1);
  invalid(game, () => collage('a', base, [another])); conserve(game);
});

test('existing Joker assignment and base order stay fixed; no insertion, replacement or recovery is permitted', () => {
  const { game, laid, hand, begin, collage, retrieve } = fixture();
  const base = laid('a', 'suite', ['8', 'Joker', '10'], 'hearts', { rank: '9', suit: 'hearts' });
  const seven = hand('7'), nine = hand('9'), joker = hand('Joker'); hand('2', 'clubs'); begin();
  const original = structuredClone(base);
  collage('a', base, [seven]);
  assert.deepEqual(base, original);
  assert.deepEqual(effectiveGroup(game, 'a', base).cards[2].substitution, { rank: '9', suit: 'hearts' });
  invalid(game, () => collage('a', base, [nine]));
  invalid(game, () => collage('a', base, [joker]));
  invalid(game, () => retrieve(base, base.cards[1]));
  invalid(game, () => retrieve(base, base.cards[0])); conserve(game);
});

test('undo latest and undo all restore all Collage overlays and Descente snapshots exactly', () => {
  const { game, laid, hand, begin, collage, staged, stage, undo } = fixture();
  const base = laid('a'); const seven = hand('7'), jack = hand('V');
  const other = staged('suite', ['3', '4', '5'], 'spades'); hand('2', 'clubs'); begin();
  const baseline = structuredClone(game.hands.a); const original = structuredClone(game.laid);
  stage([other]); collage('a', base, [seven]);
  const snapshot = structuredClone({ hand: game.hands.a, staged: game.staged, collages: game.collages });
  collage('a', base, [jack]); undo();
  assert.deepEqual({ hand: game.hands.a, staged: game.staged, collages: game.collages }, snapshot);
  undo(true);
  assert.deepEqual(game.hands.a, baseline); assert.deepEqual(game.laid, original);
  assert.equal(game.staged.length, 0); assert.equal(game.collages.length, 0); conserve(game);
});

test('only valid endpoint additions can be retrieved; base cards never leave a committed target', () => {
  const { game, laid, hand, begin, collage, retrieve, undo } = fixture();
  const base = laid('b'); const six = hand('6'), seven = hand('7'); hand('2', 'clubs'); begin();
  collage('b', base, [six, seven], 'prepend');
  invalid(game, () => retrieve(base, seven));
  invalid(game, () => retrieve(base, base.cards[0]));
  retrieve(base, six);
  assert.equal(game.collages[0].addedCardIds.length, 1);
  retrieve(base);
  assert.equal(game.collages.length, 0);
  assert.equal(base.cards.length, 3);
  undo(); assert.equal(game.collages[0].addedCardIds[0], seven.id); conserve(game);
});

test('retrieving a fourth newly added set card restores Tierce while keeping all committed suits untouched', () => {
  const { game, laid, hand, begin, collage, retrieve } = fixture();
  const base = laid('a', 'tierce', ['9', '9', '9'], ['hearts', 'clubs', 'diamonds']);
  const fourth = hand('9', 'spades'); hand('2', 'clubs'); begin(); collage('a', base, [fourth]); retrieve(base, fourth);
  assert.equal(game.collages.length, 0); assert.equal(base.type, 'tierce'); assert.equal(base.cards.length, 3); conserve(game);
});

test('retrieval from own staged extended group preserves valid new groups and remains fully undoable', () => {
  const { game, hand, staged, begin, stage, collage, retrieve, undo } = fixture();
  const proposed = staged('suite', ['8', '9', '10']); const jack = hand('V'); hand('2', 'clubs'); begin();
  stage([proposed]); const base = game.staged[0]; collage('a', base, [jack]);
  retrieve(base, base.cards[0]);
  assert.equal(game.collages.length, 0);
  assert.deepEqual(game.staged[0].cards.map((card) => card.rank), ['9', '10', 'V']);
  undo(); assert.equal(game.collages.length, 1);
  retrieve(game.staged[0]); assert.equal(game.staged.length, 0); assert.equal(game.collages.length, 0); conserve(game);
});

test('same-turn Collage cannot convert the only mandatory pure Tierce into a Carré', () => {
  const { game, hand, staged, begin, stage, collage } = fixture();
  game.opened.a = false; delete game.openingTotals.a; game.firstOpening = null;
  const groups = [staged('suite', ['8', '9', '10']), staged('tierce', ['R', 'R', 'R'], ['clubs', 'diamonds', 'spades']), staged('suite', ['4', '5', '6'], 'clubs')];
  const fourth = hand('R'); hand('2', 'clubs'); begin(); stage(groups);
  invalid(game, () => collage('a', game.staged[1], [fourth]));
});

test('discard rechecks provisional opening threshold eligibility after retrieval and commits both action kinds atomically', () => {
  const { game, laid, hand, staged, begin, stage, collage, retrieve, discard, undo } = fixture();
  game.opened.a = false; delete game.openingTotals.a; game.firstOpening = null; game.openingTotals.b = 75;
  const enemy = laid('b', 'suite', ['8', '9', '10'], 'spades');
  const groups = [staged('suite', ['8', '9', '10']), staged('tierce', ['R', 'R', 'R'], ['clubs', 'diamonds', 'spades']), staged('suite', ['4', '5', '6'], 'clubs'), staged('suite', ['A', '2', '3'], 'diamonds')];
  const seven = hand('7', 'spades'), end = hand('2', 'clubs'); begin(); stage(groups);
  collage('b', enemy, [seven]); assert.equal(openingStatus(game, 'a').totalLaidPoints, 78);
  retrieve(game.staged[3]); assert.equal(openingStatus(game, 'a').totalLaidPoints, 72);
  assert.equal(openingStatus(game, 'a').valid, true);
  invalid(game, () => discard(end));
  assert.equal(game.laid.a.length, 0); assert.equal(game.laid.b[0].cards.length, 3);
  undo(); discard(end);
  assert.equal(game.openingTotals.a, 78); assert.equal(game.laid.a.length, 4); assert.equal(game.laid.b[0].cards.length, 4); conserve(game);
});

test('public state reveals only laid additions, never remaining hand or undo/baseline identities', () => {
  const { game, laid, hand, begin, collage, undo } = fixture();
  const base = laid('a'), added = hand('7'), secret = hand('2', 'clubs'); begin(); collage('a', base, [added]);
  for (const view of [publicGame(game), privateGame(game, 'b')]) {
    assert.equal(JSON.stringify(view).includes(added.id), true);
    assert.equal(JSON.stringify(view).includes(secret.id), false);
    assert.equal('turnBaseHand' in view, false); assert.equal('turnUndo' in view, false);
  }
  const detached = publicGame(game); detached.collages[0].group.cards[0].rank = 'A';
  assert.equal(game.collages[0].group.cards[0].rank, '7');
  undo(true); assert.equal(JSON.stringify(privateGame(game, 'b')).includes(added.id), false); conserve(game);
});

test('server rejects wrong actors, phases, revisions, IDs, malformed batches, last-card use and reordering', () => {
  const { game, laid, hand, begin, collage } = fixture();
  const base = laid('a'), seven = hand('7'), six = hand('6'); hand('2', 'clubs'); begin();
  const payload = { ownerId: 'a', groupId: base.id, cardIds: [seven.id], revision: game.revision };
  invalid(game, () => stageCollage(game, 'b', payload));
  invalid(game, () => stageCollage(game, 'a', { ...payload, revision: -1 }));
  for (const patch of [{ ownerId: 'unknown' }, { groupId: 'fake' }, { cardIds: null }, { cardIds: [] }, { cardIds: [seven.id, seven.id] }, { cardIds: ['foreign'] }, { side: 'middle' }]) {
    invalid(game, () => stageCollage(game, 'a', { ...payload, ...patch }));
  }
  invalid(game, () => collage('a', base, [seven, six], 'prepend'));
  game.phase = 'round-ended'; invalid(game, () => stageCollage(game, 'a', payload)); game.phase = 'discard';
  game.initialDiscard = true; invalid(game, () => stageCollage(game, 'a', payload)); game.initialDiscard = false;
  const single = fixture(); const own = single.laid('a'), only = single.hand('7'); single.begin(); invalid(single.game, () => single.collage('a', own, [only]));
});

test('discard rejects a corrupted overlay that rearranges committed cards without partially committing', () => {
  const { game, laid, hand, begin, collage, discard } = fixture();
  const base = laid('a'), seven = hand('7'), end = hand('2', 'clubs'); begin(); collage('a', base, [seven]);
  [game.collages[0].group.cards[1], game.collages[0].group.cards[2]] = [game.collages[0].group.cards[2], game.collages[0].group.cards[1]];
  invalid(game, () => discard(end)); assert.equal(base.cards.length, 3); assert.equal(game.phase, 'discard');
});
