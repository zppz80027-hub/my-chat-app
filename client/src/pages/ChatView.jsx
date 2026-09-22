import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useChat } from '../context/ChatContext';
import { useCall } from '../context/CallContext';
import { useToasts } from '../context/ToastContext';
import { fileUrl } from '../utils/api';
import { fmtDivider, sameDay, timeAgo } from '../utils/format';
import Avatar from '../components/Avatar';
import MessageBubble from '../components/MessageBubble';
import MessageMenu from '../components/MessageMenu';
import Composer from '../components/Composer';
import TypingIndicator, { TypingDots } from '../components/TypingIndicator';
import ConversationInfo from '../components/ConversationInfo';
import SearchPanel from '../components/SearchPanel';
import { ChatSkeleton, EmptyState } from '../components/States';

const SENDER_COLORS = [
  'text-tick', 'text-amber-400', 'text-emerald-400', 'text-fuchsia-400',
  'text-orange-400', 'text-lime-400', 'text-sky-400', 'text-rose-400',
];

function colorFor(id) {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return SENDER_COLORS[h % SENDER_COLORS.length];
}

export default function ChatView({ convId, onBack, isOverlay }) {
  const { user } = useAuth();
  const { typingUsers, isOnline, lastSeen } = useSocket();
  const {
    getConversation,
    msgs,
    loadOlder,
    deleteMessage,
    toggleReaction,
    markAsRead,
  } = useChat();
  const { startCall } = useCall();
  const { push } = useToasts();

  const conv = getConversation(convId);
  const state = msgs[convId];
  const items = state?.items || [];

  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [menuMsg, setMenuMsg] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const scrollRef = useRef(null);
  const topSentinel = useRef(null);
  const nearBottomRef = useRef(true);
  const prevHeightRef = useRef(0);

  const isGroup = conv?.type === 'group';
  const members = conv?.members || [];
  const others = members.filter((m) => m.id !== user?.id);
  const peer = !isGroup ? others[0] : null;
  const otherIds = others.map((m) => m.id);
  const title = isGroup ? conv?.name : peer?.displayName || peer?.username || 'Chat';

  const typingIds = typingUsers(convId);
  const typingNames = typingIds
    .map((id) => members.find((m) => m.id === id)?.displayName)
    .filter(Boolean);

  const status = useMemo(() => {
    if (typingNames.length > 0)
      return typingNames.length === 1 ? 'typing…' : `${typingNames.length} typing…`;
    if (!isGroup && peer) {
      if (isOnline(peer.id)) return 'online';
      return timeAgo(lastSeen(peer.id));
    }
    if (isGroup) return `${members.length} members`;
    return '';
  }, [typingNames, isGroup, peer, members.length, isOnline, lastSeen]);

  // Infinite scroll upwards.
  useEffect(() => {
    const el = topSentinel.current;
    const root = scrollRef.current;
    if (!el || !root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && state && !state.loading && state.hasMore && !state.loadingMore) {
          prevHeightRef.current = root.scrollHeight;
          loadOlder(convId);
        }
      },
      { root, threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [convId, loadOlder, state]);

  // Preserve scroll position when older messages prepend.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !prevHeightRef.current) return;
    const diff = root.scrollHeight - prevHeightRef.current;
    if (diff > 0) root.scrollTop += diff;
    prevHeightRef.current = 0;
  }, [items.length]);

  const handleScroll = () => {
    const root = scrollRef.current;
    if (!root) return;
    nearBottomRef.current = root.scrollHeight - root.scrollTop - root.clientHeight < 120;
  };

  // Initial scroll to bottom + keep pinned while near bottom.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    if (state?.loading) return;
    if (nearBottomRef.current) root.scrollTop = root.scrollHeight;
  }, [items.length, state?.loading]);

  // Mark read whenever new incoming messages arrive while open.
  const lastId = items.length ? items[items.length - 1].id : null;
  useEffect(() => {
    if (lastId) markAsRead(convId);
  }, [lastId, convId, markAsRead]);

  const scrollToMessage = useCallback(
    async (id, attempts = 0) => {
      const el = document.getElementById(`msg-${id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightId(id);
        setTimeout(() => setHighlightId((h) => (h === id ? null : h)), 2200);
        return;
      }
      if (attempts < 6 && state?.hasMore) {
        await loadOlder(convId);
        setTimeout(() => scrollToMessage(id, attempts + 1), 400);
      } else {
        push({ kind: 'info', title: 'Message is not loaded yet' });
      }
    },
    [convId, loadOlder, state?.hasMore, push]
  );

  const handleJump = (m) => {
    setShowSearch(false);
    scrollToMessage(m.id);
  };

  const handleMenuAction = async (action, m, emoji) => {
    setMenuMsg(null);
    try {
      if (action === 'reply') {
        setReplyTo({ id: m.id, text: m.text || (m.kind === 'image' ? '📷 Photo' : '📎 File'), senderDisplayName: m.senderDisplayName });
      } else if (action === 'react') {
        await toggleReaction(m.id, emoji);
      } else if (action === 'copy' && m.text) {
        await navigator.clipboard.writeText(m.text);
        push({ kind: 'success', title: 'Copied to clipboard', duration: 1500 });
      } else if (action === 'edit') {
        setEditing(m);
      } else if (action === 'delete-me') {
        if (window.confirm('Delete this message for yourself?')) await deleteMessage(m.id, 'me');
      } else if (action === 'delete-everyone') {
        if (window.confirm('Delete this message for everyone?')) await deleteMessage(m.id, 'everyone');
      }
    } catch (e) {
      push({ kind: 'error', title: 'Action failed', body: e.message });
    }
  };

  // Quote click in bubble: scroll to the original message.
  const handleReplyClick = (replyToObj, jump = false) => {
    if (jump && replyToObj?.id) scrollToMessage(replyToObj.id);
  };

  const handleCall = (isVideo) => {
    if (isGroup) {
      push({ kind: 'info', title: 'Group calls are not supported yet' });
      return;
    }
    if (!peer) return;
    startCall(peer, convId, isVideo);
  };

  if (!conv) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <EmptyState icon="💬" title="Conversation not found" body="It may have been deleted." />
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col bg-ink-950 ${isOverlay ? 'animate-slide-in' : ''}`}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-900 px-2 py-2">
        {onBack && (
          <button onClick={onBack} className="rounded-full p-2 text-2xl text-gray-300 md:hidden" aria-label="Back">
            ←
          </button>
        )}
        <button onClick={() => setShowInfo(true)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left">
          <Avatar name={title} src={peer?.avatarUrl} size={42} online={!isGroup && peer ? isOnline(peer.id) : undefined} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-semibold text-gray-100">{title}</span>
            <span className="block truncate text-xs text-gray-400">
              {typingNames.length > 0 ? <span className="text-mint-400">{status}</span> : status}
            </span>
          </span>
        </button>
        <button onClick={() => setShowSearch((v) => !v)} className="rounded-full p-2 text-xl text-gray-300 hover:bg-ink-800" aria-label="Search messages" title="Search messages">
          🔍
        </button>
        {!isGroup && peer && (
          <>
            <button onClick={() => handleCall(false)} className="rounded-full p-2 text-xl text-gray-300 hover:bg-ink-800" aria-label="Voice call" title="Voice call">
              📞
            </button>
            <button onClick={() => handleCall(true)} className="rounded-full p-2 text-xl text-gray-300 hover:bg-ink-800" aria-label="Video call" title="Video call">
              📹
            </button>
          </>
        )}
        <button onClick={() => setShowInfo(true)} className="rounded-full p-2 text-xl text-gray-300 hover:bg-ink-800" aria-label="Conversation info" title="Info">
          ⓘ
        </button>
      </div>

      {showSearch && (
        <SearchPanel convId={convId} onJump={handleJump} onClose={() => setShowSearch(false)} />
      )}

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="chat-wallpaper flex-1 overflow-y-auto py-2">
        <div ref={topSentinel} />
        {state?.loadingMore && (
          <div className="flex justify-center py-2">
            <TypingDots />
          </div>
        )}
        {!state || state.loading ? (
          <ChatSkeleton />
        ) : items.length === 0 ? (
          <EmptyState
            icon="👋"
            title="No messages yet"
            body={`Say hello to ${isGroup ? 'the group' : title}! Messages you send will appear here.`}
          />
        ) : (
          items.map((m, i) => {
            const prev = items[i - 1];
            const showDivider = !prev || !sameDay(prev.createdAt, m.createdAt);
            const isOwn = m.senderId === user.id;
            const sender = members.find((x) => x.id === m.senderId);
            return (
              <React.Fragment key={m.id}>
                {showDivider && (
                  <div className="flex justify-center py-2">
                    <span className="rounded-lg bg-ink-800/90 px-3 py-1 text-xs text-gray-400 shadow">
                      {fmtDivider(m.createdAt)}
                    </span>
                  </div>
                )}
                <MessageBubble
                  message={m}
                  isOwn={isOwn}
                  myId={user.id}
                  otherIds={otherIds}
                  showSender={isGroup && !isOwn}
                  senderName={isOwn ? null : sender?.displayName || m.senderDisplayName}
                  senderAvatar={isOwn ? null : sender?.avatarUrl}
                  senderColor={colorFor(m.senderId)}
                  myName={user.displayName}
                  myAvatar={user.avatarUrl}
                  onReply={(msg, jump) => {
                    if (jump) handleReplyClick(msg, true);
                    else
                      setReplyTo({
                        id: msg.id,
                        text: msg.text || (msg.kind === 'image' ? '📷 Photo' : '📎 File'),
                        senderDisplayName: msg.senderDisplayName,
                      });
                  }}
                  onOpenMenu={setMenuMsg}
                  onToggleReaction={toggleReaction}
                  onImageClick={setLightbox}
                  highlight={highlightId === m.id}
                />
              </React.Fragment>
            );
          })
        )}
        {typingNames.length > 0 && (
          <div className="px-3 py-1">
            <TypingIndicator names={typingNames} />
          </div>
        )}
      </div>

      <Composer
        convId={convId}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
      />

      <MessageMenu
        message={menuMsg}
        isOwn={menuMsg?.senderId === user.id}
        onClose={() => setMenuMsg(null)}
        onAction={handleMenuAction}
      />

      {showInfo && (
        <ConversationInfo convId={convId} onClose={() => setShowInfo(false)} />
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-[92] flex items-center justify-center bg-black/95 p-4"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute right-4 top-4 rounded-full bg-ink-800 p-2 text-2xl" aria-label="Close">
            ✕
          </button>
          <img
            src={fileUrl(lightbox.file.url)}
            alt={lightbox.file.filename}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <a
            href={fileUrl(lightbox.file.url)}
            download={lightbox.file.filename}
            className="absolute bottom-6 rounded-xl bg-mint-400 px-5 py-2.5 font-semibold text-ink-950"
            onClick={(e) => e.stopPropagation()}
          >
            Download
          </a>
        </div>
      )}
    </div>
  );
}
