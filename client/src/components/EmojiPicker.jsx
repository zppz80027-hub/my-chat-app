import React, { useState } from 'react';
import { EMOJI_CATEGORIES } from '../utils/emojis';

export default function EmojiPicker({ onSelect, onClose }) {
  const [cat, setCat] = useState(0);
  return (
    <div className="animate-fade-in border-t border-ink-700 bg-ink-900">
      <div className="flex gap-1 overflow-x-auto px-2 pt-2">
        {EMOJI_CATEGORIES.map((c, i) => (
          <button
            key={c.name}
            onClick={() => setCat(i)}
            title={c.name}
            className={`rounded-lg px-2.5 py-1.5 text-lg ${
              i === cat ? 'bg-ink-700' : 'opacity-60 hover:opacity-100'
            }`}
          >
            {c.icon}
          </button>
        ))}
        <button
          onClick={onClose}
          className="ml-auto shrink-0 rounded-lg px-2.5 py-1.5 text-lg opacity-60 hover:opacity-100"
          title="Close"
        >
          ✕
        </button>
      </div>
      <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto p-2">
        {EMOJI_CATEGORIES[cat].emojis.map((e) => (
          <button
            key={e}
            onClick={() => onSelect(e)}
            className="rounded-lg py-1.5 text-2xl hover:bg-ink-700"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
