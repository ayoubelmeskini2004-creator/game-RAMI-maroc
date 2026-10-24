// Pure validation only. Callers supply cards from the authoritative server hand;
// proposals contain physical IDs, never client-supplied card faces or point values.
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const SUITE = [...RANKS, 'A'];
const canonicalRank = (rank) => rank === 'J' ? 'V' : rank === 'Q' ? 'D' : rank === 'K' ? 'R' : rank;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const physicalId = (value) => typeof value === 'string' && value.trim().length > 0;

class ValidationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function requireValid(condition, code, message) {
  if (!condition) throw new ValidationError(code, message);
}
function cardIndex(cards) {
  requireValid(Array.isArray(cards) && cards.length <= 108, 'INVALID_CARDS', 'Liste de cartes invalide.');
  const index = new Map();
  for (const card of cards) {
    requireValid(record(card) && physicalId(card.id) && !index.has(card.id), 'INVALID_CARD_ID', 'Identifiant physique absent ou répété.');
    const rank = canonicalRank(card.rank);
    requireValid(rank === 'Joker' ? card.suit === null : RANKS.includes(rank) && SUITS.includes(card.suit), 'INVALID_CARD', 'Carte invalide.');
    index.set(card.id, { id: card.id, rank, suit: card.suit });
  }
  return index;
}
function points(rank, lowAce = false) {
  if (rank === 'A') return lowAce ? 1 : 10;
  return ['V', 'D', 'R'].includes(rank) ? 10 : Number(rank);
}

function combination(proposal, index) {
  requireValid(record(proposal) && ['suite', 'tierce', 'carre'].includes(proposal.type), 'INVALID_TYPE', 'Type de combinaison invalide.');
  const { type } = proposal;
  const cardIds = Array.isArray(proposal.cardIds) ? Array.from(proposal.cardIds) : proposal.cardIds;
  requireValid(Array.isArray(cardIds) && (type === 'suite' ? cardIds.length >= 3 && cardIds.length <= 14 : cardIds.length === (type === 'tierce' ? 3 : 4)), 'INVALID_SIZE', 'Nombre de cartes invalide pour cette combinaison.');
  requireValid(cardIds.every(physicalId) && new Set(cardIds).size === cardIds.length, 'DUPLICATE_CARD', 'Une carte physique ne peut être utilisée qu’une fois.');
  requireValid(cardIds.every((id) => index.has(id)), 'UNKNOWN_CARD', 'Une carte ne fait pas partie de la main fournie.');
  const physical = cardIds.map((id) => index.get(id));
  const jokers = physical.filter((card) => card.rank === 'Joker');
  requireValid(jokers.length <= 1, 'TOO_MANY_JOKERS', 'Une combinaison ne peut contenir qu’un Joker.');
  let substitution = null;
  if (jokers.length) {
    const assignment = proposal.joker;
    requireValid(record(assignment) && assignment.cardId === jokers[0].id
      && RANKS.includes(canonicalRank(assignment.rank)) && SUITS.includes(assignment.suit),
    'INVALID_JOKER_ASSIGNMENT', 'Précisez la carte naturelle exacte remplacée par le Joker.');
    substitution = { rank: canonicalRank(assignment.rank), suit: assignment.suit };
  } else {
    requireValid(proposal.joker === undefined, 'UNEXPECTED_JOKER_ASSIGNMENT', 'Aucun Joker à affecter dans cette combinaison.');
  }
  const effective = physical.map((card) => card.rank === 'Joker' ? substitution : card);
  let start = null;
  if (type === 'suite') {
    requireValid(effective.every((card) => card.suit === effective[0].suit), 'MIXED_SUITS', 'Une Suite doit être d’une seule couleur.');
    // Order is explicit: each valid sequence is a contiguous window of A,2,...,R,A.
    // This admits both Aces only at opposite ends and never wraps through R,A,2.
    const candidates = [];
    for (let i = 0; i <= SUITE.length - effective.length; i++) {
      if (effective.every((card, offset) => card.rank === SUITE[i + offset])) candidates.push(i);
    }
    requireValid(candidates.length === 1, 'NON_CONSECUTIVE_SUITE', 'Suite non consécutive ou affectation ambiguë.');
    [start] = candidates;
  } else {
    requireValid(effective.every((card) => card.rank === effective[0].rank), 'MIXED_RANKS', 'Les cartes doivent avoir la même valeur.');
    requireValid(new Set(effective.map((card) => card.suit)).size === effective.length, 'DUPLICATE_SUIT', 'Chaque carte doit avoir une couleur différente.');
  }
  const cards = physical.map((card, i) => ({ ...card,
    substitution: card.rank === 'Joker' ? { ...substitution } : null,
    points: points(effective[i].rank, type === 'suite' && start + i === 0) }));
  return { valid: true, errors: [], type, pure: jokers.length === 0, cards,
    naturalPoints: cards.reduce((sum, card) => sum + (card.rank === 'Joker' ? 0 : card.points), 0),
    totalPoints: cards.reduce((sum, card) => sum + card.points, 0) };
}

function errorResult(error) {
  // Unexpected programming errors must not be silently misreported as invalid proposals.
  if (!(error instanceof ValidationError)) throw error;
  return { code: error.code, message: error.message };
}

/** Validate and score one ordered group using trusted physical cards. Never mutates inputs. */
export function validateCombination(proposal, availableCards) {
  try { return combination(proposal, cardIndex(availableCards)); }
  catch (error) {
    return { valid: false, errors: [errorResult(error)], type: null, pure: false, cards: [], naturalPoints: 0, totalPoints: 0 };
  }
}

/** Validate an ordinary opening; no escalation, team rules, ownership mutation or turn effects. */
export function validateOpening(proposals, availableCards, options = {}) {
  const empty = { qualifyingNaturalPoints: 0, totalLaidPoints: 0, groups: [], mandatorySuiteIndices: [], mandatoryTierceIndices: [] };
  try {
    const index = cardIndex(availableCards);
    requireValid(record(options), 'INVALID_OPTIONS', 'Contexte d’ouverture invalide.');
    const { discardTakenCardId = null } = options;
    requireValid(discardTakenCardId === null || (physicalId(discardTakenCardId) && index.has(discardTakenCardId)), 'INVALID_DISCARD_CONTEXT', 'La carte prise à la défausse doit appartenir à la main fournie.');
    requireValid(Array.isArray(proposals) && proposals.length > 0 && proposals.length <= 36, 'INVALID_OPENING', 'Proposez au moins une combinaison.');
    const used = new Set();
    const groups = Array.from(proposals).map((proposal) => {
      const group = combination(proposal, index);
      for (const card of group.cards) {
        requireValid(!used.has(card.id), 'REUSED_CARD', 'Une carte physique ne peut figurer dans plusieurs combinaisons.');
        used.add(card.id);
      }
      return { ...group, mandatoryEligible: group.pure && !group.cards.some((card) => card.id === discardTakenCardId) };
    });
    const mandatorySuiteIndices = [], mandatoryTierceIndices = [];
    groups.forEach((group, i) => {
      if (group.mandatoryEligible && group.type === 'suite') mandatorySuiteIndices.push(i);
      if (group.mandatoryEligible && group.type === 'tierce') mandatoryTierceIndices.push(i);
    });
    // The discard restriction concerns mandatory groups. Natural cards in any valid laid
    // group still count toward 71, including the taken discard; Jokers never do.
    const qualifyingNaturalPoints = groups.reduce((sum, group) => sum + group.naturalPoints, 0);
    const totalLaidPoints = groups.reduce((sum, group) => sum + group.totalPoints, 0);
    const errors = [];
    if (!mandatorySuiteIndices.length) errors.push({ code: 'MISSING_PURE_SUITE', message: 'Une Suite pure sans la carte prise à la défausse est obligatoire.' });
    if (!mandatoryTierceIndices.length) errors.push({ code: 'MISSING_PURE_TIERCE', message: 'Une Tierce pure sans la carte prise à la défausse est obligatoire.' });
    if (qualifyingNaturalPoints < 71) errors.push({ code: 'INSUFFICIENT_NATURAL_POINTS', message: 'Il faut au moins 71 points de cartes naturelles, hors Jokers.' });
    return { valid: errors.length === 0, errors, qualifyingNaturalPoints, totalLaidPoints, groups, mandatorySuiteIndices, mandatoryTierceIndices };
  } catch (error) { return { valid: false, errors: [errorResult(error)], ...empty }; }
}
