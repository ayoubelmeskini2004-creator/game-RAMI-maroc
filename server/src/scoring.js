const check = (condition) => { if (!condition) throw new Error('Coup invalide'); };
export const validThreshold = (value) => Number.isSafeInteger(value) && value > 0 && value <= 1000000000;

/** Score only an already validated final discard. No ranks or hidden cards enter the result. */
export function roundResult(game, winnerId, wasOpened) {
  check(game.hands[winnerId].length === 0 && game.opened[winnerId]);
  const totalDescent = !wasOpened;
  const winnerTeam = game.mode === 'teams' ? game.teams[winnerId] : null;
  const penalties = Object.fromEntries(game.order.map((id) => {
    const losingSide = winnerTeam ? game.teams[id] !== winnerTeam : id !== winnerId;
    const base = id === winnerId ? 0 : game.opened[id] ? game.hands[id].length * 10 : 100;
    return [id, base * (totalDescent && losingSide ? 2 : 1)];
  }));
  return { round: game.round, starterId: game.starterId, winnerId, winnerTeam, totalDescent, penalties };
}

export function createMatch(players, mode, threshold) {
  check(validThreshold(threshold));
  return { mode, threshold, players: players.map(({ id, name, team }) => ({ id, name, team })),
    totals: Object.fromEntries(players.map((p) => [p.id, 0])), history: [], finished: false, winner: null,
    tied: false, nextRoundAt: null };
}

export function teamTotals(match, totals = match.totals) {
  return Object.fromEntries(['A', 'B'].map((team) => [team, match.players.filter((p) => p.team === team).reduce((sum, p) => sum + totals[p.id], 0)]));
}

/** Called once per completed round; all inputs come from server-owned state. */
export function recordRound(match, result, now) {
  check(!match.finished && !match.history.some((entry) => entry.round === result.round));
  const totals = Object.fromEntries(match.players.map((p) => [p.id, match.totals[p.id] + result.penalties[p.id]]));
  const teams = teamTotals(match, totals);
  const standings = match.mode === 'teams' ? teams : totals;
  const entries = Object.entries(standings), lowest = Math.min(...Object.values(standings));
  const leaders = entries.filter(([, value]) => value === lowest).map(([id]) => id);
  const thresholdReached = Object.values(standings).some((value) => value >= match.threshold);
  match.totals = totals;
  match.finished = thresholdReached && leaders.length === 1;
  match.winner = match.finished ? leaders[0] : null;
  match.tied = thresholdReached && leaders.length > 1;
  match.nextRoundAt = match.finished ? null : now + 15000;
  match.history.push({ ...structuredClone(result), completedAt: now, totals: { ...totals },
    ...(match.mode === 'teams' ? { teamPenalties: teamTotals(match, result.penalties), teamTotals: teams } : {}) });
}

export function matchView(match, now) {
  return match ? { ...structuredClone(match), teamTotals: match.mode === 'teams' ? teamTotals(match) : null, serverNow: now } : null;
}
