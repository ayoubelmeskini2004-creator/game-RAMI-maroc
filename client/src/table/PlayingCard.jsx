import React from 'react';
import { cardLabel } from './card-label.js';
import { suitShapes } from './suit-shapes.js';

const suits = {
  hearts: { symbol: '♥', name: 'cœur', red: true },
  diamonds: { symbol: '♦', name: 'carreau', red: true },
  clubs: { symbol: '♣', name: 'trèfle', red: false },
  spades: { symbol: '♠', name: 'pique', red: false },
};
const pipPositions = {
  1: [[50, 50]], 2: [[50, 23], [50, 77]], 3: [[50, 23], [50, 50], [50, 77]],
  4: [[29, 23], [71, 23], [29, 77], [71, 77]],
  5: [[29, 23], [71, 23], [50, 50], [29, 77], [71, 77]],
  6: [[29, 23], [71, 23], [29, 50], [71, 50], [29, 77], [71, 77]],
  7: [[29, 23], [71, 23], [50, 36], [29, 50], [71, 50], [29, 77], [71, 77]],
  8: [[29, 23], [71, 23], [50, 36], [29, 50], [71, 50], [50, 64], [29, 77], [71, 77]],
  9: [[29, 20], [71, 20], [29, 40], [71, 40], [50, 50], [29, 60], [71, 60], [29, 80], [71, 80]],
  10: [[29, 20], [71, 20], [50, 30], [29, 40], [71, 40], [29, 60], [71, 60], [50, 70], [29, 80], [71, 80]],
};

function SuitShape({ suit, ...props }) {
  return <svg className="suit-shape" viewBox="0 0 24 24" aria-hidden="true" {...props}><path d={suitShapes[suit]} fill="currentColor" /></svg>;
}
function SuitCorner({ suit, symbol }) {
  return <span className="suit-symbol">{symbol}<SuitShape suit={suit}/></span>;
}
function Royal({ suit }) {
  return <svg className="card-royal" viewBox="0 0 80 112" aria-hidden="true">
    <rect x="2" y="2" width="76" height="108" rx="2" fill="#f4ead0" stroke="#b59a5d" />
    {[false, true].map((flipped) => <g key={String(flipped)} transform={flipped ? 'translate(80 112) rotate(180)' : undefined}>
      <path d="M13 54 Q40 28 67 54 L64 65 H16Z" fill="#294f64" />
      <path d="M32 52 L32 37 H49 L49 52" fill="#e6b98d" stroke="#6e4b36" />
      <path d="M29 24 L26 12 L36 17 L41 8 L47 17 L57 12 L53 25Z" fill="#c6a151" stroke="#78542a" />
      <path d="M31 25 Q53 22 51 38 L44 44 L33 38Z" fill="#e8c29b" stroke="#6e4b36" />
      <path d="M34 27 L34 38 L29 42 M48 27 L52 35" fill="none" stroke="#533b2c" strokeWidth="3" />
      <path d="M40 47 L49 56 L40 65 L31 56Z" fill="#b73a36" stroke="#d4b56e" />
      <SuitShape suit={suit} x="4" y="24" width="13" height="16" />
    </g>)}
  </svg>;
}

export default function PlayingCard({ rank, suit, faceDown = false }) {
  // Hidden cards receive no rank or suit; their accessible name contains no face information.
  if (faceDown) return <div className="playing-card card-back" role="img" aria-label="Carte face cachée"><div><span>✦</span><b>71</b><span>✦</span></div></div>;
  const joker = rank === 'Joker';
  const info = suits[suit];
  const label = joker ? 'Joker' : `${cardLabel(rank)} de ${info?.name}`;
  const points = pipPositions[rank === 'A' ? 1 : Number(rank)];
  return <div className={`playing-card card-face ${info?.red || joker ? 'red-suit' : 'black-suit'} ${joker ? 'joker-card' : ''}`} role="img" aria-label={label}>
    <div className="card-corner"><b>{joker ? 'J' : cardLabel(rank)}</b>{joker?<span>★</span>:<SuitCorner suit={suit} symbol={info?.symbol}/>}</div>
    {joker ? <div className="joker-art"><svg viewBox="0 0 80 100" aria-hidden="true"><path d="M15 43 Q9 5 32 28 Q44 -1 51 27 Q78 5 65 44 L55 53 H25Z" fill="#214e47" stroke="#b99a51" strokeWidth="2" /><path d="M24 44 Q40 33 57 44 L54 67 Q40 86 27 67Z" fill="#f1d6b3" stroke="#ac7d5c" /><path d="M30 56 Q40 65 50 56 M29 49 L34 49 M46 49 L51 49" fill="none" stroke="#9b3532" strokeWidth="2" /><path d="M19 77 L40 89 L61 77 L59 95 H21Z" fill="#b63e36" />{[[15, 20], [41, 12], [67, 20]].map(([cx, cy]) => <circle key={cx} cx={cx} cy={cy} r="4" fill="#c4a356" />)}</svg><span>JOKER</span></div>
      : points ? <svg className="card-pips" viewBox="0 0 100 100" aria-hidden="true">{points.map(([x, y], i) => {const size=rank==='A'?43:18;return <g key={i} transform={y>50?`rotate(180 ${x} ${y})`:undefined}><SuitShape suit={suit} x={x-size/2} y={y-size/2} width={size} height={size}/></g>;})}</svg>
        : <Royal suit={suit} />}
    <div className="card-corner corner-bottom"><b>{joker ? 'J' : cardLabel(rank)}</b>{joker?<span>★</span>:<SuitCorner suit={suit} symbol={info?.symbol}/>}</div>
  </div>;
}
