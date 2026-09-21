import React from 'react';

export function EmptyState({ icon, title, body, action }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-ink-800 text-4xl">
        {icon}
      </div>
      <div className="text-lg font-semibold text-gray-200">{title}</div>
      {body && <div className="max-w-xs text-sm text-gray-400">{body}</div>}
      {action}
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className={`flex ${i % 3 === 0 ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`h-12 animate-pulse rounded-2xl bg-ink-800 ${
              i % 3 === 0 ? 'w-2/5 rounded-br-md' : 'w-1/2 rounded-bl-md'
            }`}
          />
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 6 }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-12 w-12 animate-pulse rounded-full bg-ink-800" />
          <div className="flex-1">
            <div className="h-4 w-1/3 animate-pulse rounded bg-ink-800" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-ink-800" />
          </div>
        </div>
      ))}
    </div>
  );
}
