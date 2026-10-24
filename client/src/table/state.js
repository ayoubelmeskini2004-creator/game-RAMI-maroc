/** Broadcasts, acknowledgements and resync responses must follow the same ordering rule. */
export function acceptGame(current, next) {
  if (!current || next.round > current.round) return next;
  if (next.roundId !== current.roundId || next.round !== current.round) return current;
  const gameplay = next.revision >= current.revision ? next : current;
  const layout = (next.layoutRevision ?? 0) >= (current.layoutRevision ?? 0) ? next : current;
  return gameplay === layout || (gameplay.layoutRevision ?? 0) === (layout.layoutRevision ?? 0) ? gameplay : { ...gameplay, groupPositions: layout.groupPositions, layoutRevision: layout.layoutRevision };
}
