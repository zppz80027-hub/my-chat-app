import React, { useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { SocketProvider, useSocket } from './context/SocketContext';
import { ChatProvider, useChat } from './context/ChatContext';
import { CallProvider } from './context/CallContext';
import AuthPage from './pages/AuthPage';
import ContactsPage from './pages/ContactsPage';
import ProfilePage from './pages/ProfilePage';
import ChatView from './pages/ChatView';
import ConversationList from './components/ConversationList';
import NewChatModal from './components/NewChatModal';
import CallOverlay from './components/CallOverlay';
import Toaster from './components/Toaster';
import { EmptyState } from './components/States';

const TABS = [
  { id: 'chats', label: 'Chats', icon: '💬' },
  { id: 'contacts', label: 'Contacts', icon: '👥' },
  { id: 'profile', label: 'Profile', icon: '👤' },
];

function Header() {
  const { connected } = useSocket();
  return (
    <div className="flex items-center justify-between border-b border-ink-700 bg-ink-900 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-mint-400 text-xl">
          💬
        </span>
        <span className="text-lg font-bold text-gray-100">Cloude</span>
      </div>
      <span
        className={`flex items-center gap-1.5 text-xs ${connected ? 'text-green-400' : 'text-gray-500'}`}
        title={connected ? 'Connected' : 'Connecting…'}
      >
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-400' : 'bg-gray-500 animate-pulse'}`} />
        {connected ? 'Online' : 'Connecting…'}
      </span>
    </div>
  );
}

function BottomNav({ tab, setTab, unreadTotal }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-700 bg-ink-900 md:hidden">
      <div className="grid grid-cols-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
              tab === t.id ? 'text-mint-400' : 'text-gray-500'
            }`}
          >
            <span className="text-2xl">{t.icon}</span>
            {t.label}
            {t.id === 'chats' && unreadTotal > 0 && (
              <span className="absolute right-1/2 top-1 flex h-5 min-w-[20px] translate-x-6 items-center justify-center rounded-full bg-mint-400 px-1 text-[11px] font-bold text-ink-950">
                {unreadTotal > 99 ? '99+' : unreadTotal}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

function TabContent({ tab, activeId, onSelectChat, onOpenChat }) {
  if (tab === 'contacts') return <ContactsPage onOpenChat={onOpenChat} />;
  if (tab === 'profile') return <ProfilePage />;
  return <ConversationList activeId={activeId} onSelect={onSelectChat} />;
}

function Shell() {
  const { user, loading } = useAuth();
  const { activeId, setActiveId, unreadTotal, conversations } = useChat();
  const [tab, setTab] = useState('chats');
  const [showNewChat, setShowNewChat] = useState(false);

  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Cloude app` : 'Cloude app';
  }, [unreadTotal]);

  // App khul te hi sabse recent chat seedha khul jaye (sirf ek baar).
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpened.current && !activeId && conversations.length > 0) {
      autoOpened.current = true;
      setActiveId(conversations[0].id);
    }
  }, [activeId, conversations, setActiveId]);

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-ink-950">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl bg-mint-400 text-4xl">
            💬
          </div>
          <div className="text-sm text-gray-500">Loading…</div>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  const openChat = (id) => {
    if (id) setActiveId(id);
  };

  const desktopChat = activeId ? (
    <ChatView convId={activeId} />
  ) : (
    <div className="hidden h-full items-center justify-center bg-ink-950 md:flex">
      <EmptyState
        icon="💬"
        title="Cloude Web"
        body="Select a conversation to start messaging. Your chats stay in sync in real time."
      />
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-ink-950 md:flex-row">
      {/* Sidebar (desktop) / main column (mobile) */}
      <div className="flex h-full w-full flex-col md:w-[380px] md:shrink-0 md:border-r md:border-ink-700">
        <Header />
        {/* Desktop tab switcher */}
        <div className="hidden gap-1 border-b border-ink-700 bg-ink-900 px-3 py-2 md:flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex-1 rounded-lg py-2 text-sm font-semibold ${
                tab === t.id ? 'bg-ink-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.icon} {t.label}
              {t.id === 'chats' && unreadTotal > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-mint-400 px-1 text-[11px] font-bold text-ink-950">
                  {unreadTotal > 99 ? '99+' : unreadTotal}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          <TabContent tab={tab} activeId={activeId} onSelectChat={openChat} onOpenChat={openChat} />
        </div>
      </div>

      {/* Desktop chat pane */}
      <div className="hidden min-h-0 flex-1 md:block">{desktopChat}</div>

      {/* Mobile bottom nav */}
      <BottomNav tab={tab} setTab={setTab} unreadTotal={unreadTotal} />

      {/* Mobile chat overlay */}
      {activeId && (
        <div className="fixed inset-0 z-50 bg-ink-950 md:hidden">
          <ChatView convId={activeId} onBack={() => setActiveId(null)} isOverlay />
        </div>
      )}

      {/* New chat FAB */}
      {tab === 'chats' && !activeId && (
        <button
          onClick={() => setShowNewChat(true)}
          className="fixed bottom-24 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-mint-400 text-3xl text-ink-950 shadow-xl hover:bg-mint-600 md:bottom-8"
          aria-label="New chat"
        >
          ✚
        </button>
      )}

      {showNewChat && (
        <NewChatModal onClose={() => setShowNewChat(false)} onCreated={openChat} />
      )}

      <CallOverlay />
      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <SocketProvider>
          <ChatProvider>
            <CallProvider>
              <Shell />
            </CallProvider>
          </ChatProvider>
        </SocketProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
