import React, { useMemo, useRef, useState } from 'react';
import { fileUrl } from '../utils/api';
import { fmtSize, fmtTime } from '../utils/format';

// Video player jo 503 (movie abhi taiyaar ho rahi hai) par retry dikhata hai.
function ResilientVideo({ src, filename, size }) {
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  if (failed) {
    return (
      <div className="rounded-lg bg-black/40 p-3 text-center text-xs text-gray-300">
        <div className="mb-1 text-lg">⏳</div>
        <div>Movie server par taiyaar ho rahi hai…</div>
        <button
          className="mt-2 rounded-full bg-mint-500 px-3 py-1 font-medium text-black"
          onClick={() => {
            setFailed(false);
            setRetryKey((k) => k + 1);
          }}
        >
          ↻ Dobara try karo
        </button>
      </div>
    );
  }
  return (
    <video
      key={retryKey}
      src={src}
      controls
      playsInline
      preload="metadata"
      className="max-h-64 w-full bg-black"
      onError={() => setFailed(true)}
    />
  );
}

// Text me se URLs nikalo aur unhe playable/embeddable banao.
function renderRichText(text) {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
  const parts = [];
  let lastIdx = 0;
  let match;
  let key = 0;
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(
        <span key={`t-${key++}`}>{text.slice(lastIdx, match.index)}</span>
      );
    }
    const url = match[0];
    parts.push(<LinkEmbed key={`u-${key++}`} url={url} />);
    lastIdx = match.index + url.length;
  }
  if (lastIdx < text.length) {
    parts.push(<span key={`t-${key++}`}>{text.slice(lastIdx)}</span>);
  }
  return parts.length > 0 ? parts : text;
}

// URL ko dekh kar sahi player/embed dikhao.
function LinkEmbed({ url }) {
  const [expanded, setExpanded] = useState(false);
  const lower = url.toLowerCase();

  // TeraBox / terashare link → share page ko iframe me kholo.
  const isTeraBox =
    lower.includes('terasharelink.com') ||
    lower.includes('1024tera.com') ||
    lower.includes('terabox.com') ||
    lower.includes('mirrobox.com');

  // Direct video file → <video> player.
  const isDirectVideo = /\.(mp4|m4v|webm|mkv|mov|avi)(\?|#|$)/i.test(lower);

  // Google Drive share link → direct playable link banao.
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);

  if (isDirectVideo) {
    return (
      <span className="my-1 block">
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          className="max-h-64 w-full rounded-lg bg-black"
        />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-xs text-mint-400 underline"
          onClick={(e) => e.stopPropagation()}
        >
          🎬 {url.length > 50 ? url.slice(0, 50) + '...' : url}
        </a>
      </span>
    );
  }

  if (driveMatch) {
    const directUrl = `https://drive.google.com/uc?id=${driveMatch[1]}&export=download`;
    return (
      <span className="my-1 block">
        <video
          src={directUrl}
          controls
          playsInline
          preload="metadata"
          className="max-h-64 w-full rounded-lg bg-black"
        />
        <span className="block text-xs text-gray-400">📀 Google Drive video — upar play dabao</span>
      </span>
    );
  }

  if (isTeraBox) {
    // TeraBox share page ko app ke andar hi kholo.
    return (
      <span className="my-1 block">
        {!expanded ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
            className="flex w-full items-center gap-3 rounded-lg bg-black/25 p-3 text-left"
          >
            <span className="text-3xl">🎬</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-100">
                Movie — yahin dekho
              </span>
              <span className="text-xs text-mint-400">
                ▶ Tap karo, player khulega (TeraBox login lag sakta hai)
              </span>
            </span>
          </button>
        ) : (
          <span className="block">
            <iframe
              src={url}
              title="Video player"
              className="h-80 w-full rounded-lg bg-black"
              allow="autoplay; fullscreen; encrypted-media"
              allowFullScreen
            />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block py-1 text-xs text-mint-400 underline"
              onClick={(e) => e.stopPropagation()}
            >
              Browser me kholo
            </a>
          </span>
        )}
      </span>
    );
  }

  // Aam link → clickable.
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-mint-400 underline break-all"
      onClick={(e) => e.stopPropagation()}
    >
      {url}
    </a>
  );
}


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
  senderAvatar,
  senderColor,
  myName,
  myAvatar,
  onReply,
  onOpenMenu,
  onToggleReaction,
  onImageClick,
  highlight,
}) {
  const m = message;
  // Purani upload ki hui movie (kind 'file') bhi player me chale.
  const isVideoMsg =
    !!m?.file &&
    (m.kind === 'video' ||
      (m.kind === 'file' &&
        (String(m.file.mimeType || '').startsWith('video/') ||
          /\.(mp4|m4v|webm|mkv|mov|avi)$/i.test(m.file.filename || ''))));
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
      <div className={`flex max-w-[82%] flex-col md:max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
        <img
          src="/icons/cloude-mascot.webp"
          alt="Cloude"
          
          className="mb-1 h-7 w-7 rounded-full object-cover"
        />
        <div
          className={`bubble-press no-select relative rounded-2xl px-3 pb-1.5 pt-2 shadow ${
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
            {isVideoMsg && (
              <div className="mb-1 overflow-hidden rounded-lg" onClick={(e) => e.stopPropagation()}>
                <ResilientVideo src={fileUrl(m.file.url)} filename={m.file.filename} size={m.file.size} />
                <div className="truncate px-1 py-1 text-xs text-gray-400">
                  🎬 {m.file.filename} · {fmtSize(m.file.size)}
                </div>
              </div>
            )}
            {m.kind === 'file' && m.file && !isVideoMsg && (
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
                {renderRichText(m.text)}
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
    </div>
  );
}
