import React, { useMemo, useRef } from 'react';
import { fileUrl } from '../utils/api';
import { fmtSize, fmtTime } from '../utils/format';

function Ticks({ message, otherIds }) {
  // otherIds: member ids other than me
  const deliveredTo = message.deliveredTo || [];
  const readBy = message.readBy || [];
  const read = otherIds.length > 0 && otherIds.every((id) => readBy.includes(id));
  const delivered =
    !read && (otherIds.length === 0 || otherIds.some((id) => deliveredTo.includes(id)));
  if (read)
    return (
      <span className="text-tick" title="Read">
        <svg viewBox="0 0 18 14" className="inline h-3.5 w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.5 7.5 4.5 10.5 11 3.5" />
          <path d="M7 7.5 10 10.5 16.5 3.5" />
        </svg>
      </span>
    );
  if (delivered)
    return (
      <span className="text-gray-400" title="Delivered">
        <svg viewBox="0 0 18 14" className="inline h-3.5 w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.5 7.5 4.5 10.5 11 3.5" />
          <path d="M7 7.5 10 10.5 16.5 3.5" />
        </svg>
      </span>
    );
  return (
    <span className="text-gray-400" title="Sent">
      <svg viewBox="0 0 12 14" className="inline h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 7.5 4.5 10.5 11 3.5" />
      </svg>
    </span>
  );
}

function groupReactions(reactions, myId) {
  const map = new Map();
  (reactions || []).forEach((r) => {
    if (!map.has(r.emoji)) map.set(r.emoji, { emoji: r.emoji, count: 0, mine: false });
    const g = map.get(r.emoji);
    g.count++;
    if (r.userId === myId) g.mine = true;
  });
  return [...map.values()];
}

export default function MessageBubble({
  message,
  isOwn,
  myId,
  otherIds = [],
  showSender,
  senderName,
  senderColor,
  onReply,
  onOpenMenu,
  onToggleReaction,
  onImageClick,
  highlight,
}) {
  const m = message;
  const longPressTimer = useRef(null);
  const touchStartX = useRef(null);
  const menuOpened = useRef(false);

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchStart = (e) => {
    menuOpened.current = false;
    touchStartX.current = e.touches[0].clientX;
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      menuOpened.current = true;
      onOpenMenu(m);
    }, 550);
  };

  const handleTouchEnd = (e) => {
    cancelLongPress();
    if (!menuOpened.current && touchStartX.current != null && e.changedTouches[0]) {
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      if (dx > 70 && !m.deletedForEveryone) onReply(m); // swipe right to reply
    }
    touchStartX.current = null;
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    onOpenMenu(m);
  };

  const reactions = useMemo(() => groupReactions(m.reactions, myId), [m.reactions, myId]);

  if (m.kind === 'system' || m.deletedForMe) {
    return (
      <div className="flex justify-center px-8 py-1">
        <div className="rounded-lg bg-ink-800/80 px-3 py-1.5 text-center text-xs text-gray-400">
          {m.deletedForEveryone ? 'This message was deleted' : m.text}
        </div>
      </div>
    );
  }

  const deleted = !!m.deletedForEveryone;

  return (
    <div
      className={`flex w-full px-3 py-0.5 ${isOwn ? 'justify-end' : 'justify-start'}`}
      id={`msg-${m.id}`}
    >
      <div
        className={`bubble-press no-select relative max-w-[82%] rounded-2xl px-3 pb-1.5 pt-2 shadow md:max-w-[70%] ${
          isOwn ? 'rounded-br-md bg-[#005c4b]' : 'rounded-bl-md bg-ink-800'
        } ${highlight ? 'ring-2 ring-mint-400' : ''} ${m._pending ? 'opacity-70' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={cancelLongPress}
        onContextMenu={handleContextMenu}
      >
        {!isOwn && showSender && senderName && (
          <div className={`text-[13px] font-semibold ${senderColor || 'text-tick'}`}>
            {senderName}
          </div>
        )}

        {m.replyTo && !deleted && (
          <button
            onClick={() => onReply(m.replyTo, true)}
            className={`mb-1.5 block w-full rounded-lg border-l-4 px-2 py-1 text-left ${
              isOwn ? 'border-teal-200/60 bg-black/20' : 'border-mint-400 bg-black/25'
            }`}
          >
            <div className="text-xs font-semibold text-mint-400">
              {m.replyTo.senderDisplayName || 'Message'}
            </div>
            <div className="line-clamp-2 text-xs text-gray-300">{m.replyTo.text}</div>
          </button>
        )}

        {deleted ? (
          <div className="flex items-center gap-1.5 py-1 text-sm italic text-gray-400">
            <span>🚫</span> This message was deleted
          </div>
        ) : (
          <>
            {m.kind === 'image' && m.file && (
              <button onClick={() => onImageClick(m)} className="mb-1 block overflow-hidden rounded-lg">
                <img
                  src={fileUrl(m.file.url)}
                  alt={m.file.filename || 'image'}
                  className="max-h-64 w-full object-cover"
                  loading="lazy"
                  draggable={false}
                />
              </button>
            )}
            {m.kind === 'file' && m.file && (
              <a
                href={fileUrl(m.file.url)}
                download={m.file.filename}
                className={`mb-1 flex items-center gap-3 rounded-lg p-2 ${
                  isOwn ? 'bg-black/20' : 'bg-black/25'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-3xl">📄</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-100">
                    {m.file.filename}
                  </span>
                  <span className="text-xs text-gray-400">
                    {fmtSize(m.file.size)} · tap to download
                  </span>
                </span>
              </a>
            )}
            {m.text && (
              <div className="whitespace-pre-wrap break-words text-[15px] leading-snug text-gray-100">
                {m.text}
              </div>
            )}
          </>
        )}

        {reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onToggleReaction(m.id, r.emoji)}
                className={`rounded-full border px-1.5 py-0.5 text-xs ${
                  r.mine ? 'border-mint-400 bg-mint-400/20' : 'border-ink-700 bg-black/25'
                }`}
              >
                {r.emoji} {r.count > 1 && r.count}
              </button>
            ))}
          </div>
        )}

        <div className="mt-0.5 flex items-center justify-end gap-1">
          {m.editedAt && !deleted && (
            <span className="text-[10px] italic text-gray-400">edited</span>
          )}
          <span className="text-[11px] text-gray-300/80">{fmtTime(m.createdAt)}</span>
          {isOwn && !deleted && <Ticks message={m} otherIds={otherIds} />}
        </div>
      </div>
    </div>
  );
}
