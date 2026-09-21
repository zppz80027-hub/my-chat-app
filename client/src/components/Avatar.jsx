import React from 'react';
import { fileUrl } from '../utils/api';
import { initials } from '../utils/format';

const PALETTE = [
  'bg-emerald-700', 'bg-teal-700', 'bg-cyan-700', 'bg-sky-700',
  'bg-indigo-700', 'bg-violet-700', 'bg-fuchsia-700', 'bg-rose-700',
];

function colorFor(name) {
  let h = 0;
  const s = name || '?';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Circle avatar: image if available, otherwise colored initials. */
export default function Avatar({ name, src, size = 44, online, className = '' }) {
  const px = typeof size === 'number' ? size : 44;
  const fontSize = Math.max(10, Math.round(px * 0.38));
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: px, height: px }}>
      {src ? (
        <img
          src={fileUrl(src)}
          alt={name || 'avatar'}
          className="h-full w-full rounded-full object-cover bg-ink-700"
          draggable={false}
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center rounded-full ${colorFor(
            name
          )} font-semibold text-white`}
          style={{ fontSize }}
        >
          {initials(name)}
        </div>
      )}
      {online !== undefined && (
        <span
          className={`absolute bottom-0 right-0 block rounded-full border-2 border-ink-950 ${
            online ? 'bg-green-500' : 'bg-gray-500'
          }`}
          style={{ width: Math.round(px * 0.32), height: Math.round(px * 0.32) }}
        />
      )}
    </div>
  );
}
