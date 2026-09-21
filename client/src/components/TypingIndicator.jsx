import React from 'react';

export function TypingDots({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce-dot rounded-full bg-gray-400"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}

/** "Aarav is typing" pill used inside the chat view. */
export default function TypingIndicator({ names }) {
  if (!names || names.length === 0) return null;
  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
      ? `${names[0]} and ${names[1]} are typing`
      : `${names[0]} and ${names.length - 1} others are typing`;
  return (
    <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-ink-800 px-4 py-2.5 shadow">
      <TypingDots />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}
