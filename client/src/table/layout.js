// Presentation only. The array is ordered clockwise by the server during a match.
export function arrangeSeats(players, playerId, mode) {
  let ordered = players;
  if (mode === 'teams') {
    const a = players.filter((p) => p.team === 'A');
    const b = players.filter((p) => p.team === 'B');
    if (a.length === 2 && b.length === 2) ordered = [a[0], b[0], a[1], b[1]];
  }
  const index = ordered.findIndex((player) => player.id === playerId);
  if (index < 0) return {};
  const ring = [...ordered.slice(index), ...ordered.slice(0, index)];
  if (ring.length === 2) return { bottom: ring[0], top: ring[1] };
  if (ring.length === 3) return { bottom: ring[0], left: ring[1], right: ring[2] };
  return { bottom: ring[0], left: ring[1], top: ring[2], right: ring[3] };
}
