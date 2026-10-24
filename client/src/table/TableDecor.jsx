import React from 'react';

export default function TableDecor() {
  return <div className="table-decor" aria-hidden="true">
    <svg className="morocco-emblem" viewBox="0 0 220 300">
      <path d="M153 20 L168 37 L190 39 L199 51 L186 69 L179 91 L166 109 L162 130 L148 144 L136 163 L121 178 L109 200 L91 211 L75 236 L58 247 L36 279 L13 279 L29 253 L45 227 L54 206 L72 187 L87 165 L92 148 L108 133 L119 111 L126 88 L128 61 L138 41Z" />
      <path className="map-star" d="M135 100 L143 124 L122 109 H148 L127 124Z" />
    </svg>
    {['north-west', 'north-east', 'south-west', 'south-east'].map((corner) => <svg key={corner} className={`architecture ${corner}`} viewBox="0 0 170 110">
      <path d="M8 105 H162 M20 104 V66 H62 V104 M108 104 V66 H150 V104 M62 104 V60 Q54 36 85 19 Q116 36 108 60 V104 M70 104 V68 Q61 50 85 36 Q109 50 100 68 V104 M25 66 V25 H46 V66 M22 25 H49 M28 25 V15 H43 V25 M34 15 V8 M117 66 V25 H138 V66 M114 25 H141 M120 25 V15 H135 V25 M126 15 V8" />
      <path d="M30 45 H40 M30 53 H40 M122 45 H132 M122 53 H132 M30 104 V85 Q41 73 52 85 V104 M118 104 V85 Q129 73 140 85 V104" />
    </svg>)}
  </div>;
}
