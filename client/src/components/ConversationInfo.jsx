import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useChat } from '../context/ChatContext';
import { useToasts } from '../context/ToastContext';
import Avatar from './Avatar';
import { WALLPAPER_PRESETS, currentWallpaperId } from '../lib/wallpaper';

export default function ConversationInfo({ convId, onClose }) {
  const { user } = useAuth();
  const { isOnline } = useSocket();
  const { getConversation, updateConversation, removeConversation, refreshConversations } = useChat();
  const { push } = useToasts();
  const conv = getConversation(convId);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [wpSaving, setWpSaving] = useState(false);
  const wpFileRef = useRef(null);

  useEffect(() => {
    setEditingName(false);
    setAdding(false);
    setSearch('');
    setResults([]);
    setConfirmLeave(false);
  }, [convId]);

  // ---- Shared wallpaper (jo lagao, sab ko dikhega) ----
  const applyWallpaper = async (preset) => {
    setWpSaving(true);
    try {
      const res = await api.patch(`/api/conversations/${convId}/wallpaper`, { preset });
      updateConversation(convId, { wallpaper: res?.wallpaper || null });
    } catch (e) {
      push({ kind: 'error', title: 'Wallpaper nahi badla', body: e.message });
    } finally {
      setWpSaving(false);
    }
  };
  const uploadWallpaper = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      push({ kind: 'error', title: 'Please choose an image file.' });
      return;
    }
    setWpSaving(true);
    try {
      const form = new FormData();
      form.append('wallpaper', f);
      const res = await api.post(`/api/conversations/${convId}/wallpaper`, form);
      updateConversation(convId, { wallpaper: res?.wallpaper || null });
      push({ kind: 'success', title: 'Wallpaper badal gaya — sab ko dikhega' });
    } catch (e) {
      push({ kind: 'error', title: 'Wallpaper upload failed', body: e.message });
    } finally {
      setWpSaving(false);
    }
  };

  if (!conv) return null;
  const isGroup = conv.type === 'group';
  const activeWp = currentWallpaperId(conv.wallpaper);
  const members = conv.members || [];
  const peer = !isGroup ? members.find((m) => m.id !== user.id) : null;
  const title = isGroup ? conv.name : peer?.displayName || peer?.username || 'Chat';

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name) {
      setEditingName(false);
      return;
    }
    try {
      await api.patch(`/api/conversations/${convId}`, { name });
      updateConversation(convId, { name });
      setEditingName(false);
      push({ kind: 'success', title: 'Group renamed' });
    } catch (e) {
      push({ kind: 'error', title: 'Rename failed', body: e.message });
    }
  };

  const doSearch = async (q) => {
    setSearch(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    try {
      const list = await api.get(`/api/users/search?q=${encodeURIComponent(q.trim())}`);
      const memberIds = new Set(members.map((m) => m.id));
      setResults((Array.isArray(list) ? list : []).filter((u) => u.id !== user.id && !memberIds.has(u.id)));
    } catch {
      /* ignore */
    }
  };

  const addMember = async (userId) => {
    try {
      await api.post(`/api/conversations/${convId}/members`, { userId });
      push({ kind: 'success', title: 'Member added' });
      refreshConversations();
    } catch (e) {
      push({ kind: 'error', title: 'Could not add member', body: e.message });
    }
  };

  const removeMember = async (userId, displayName) => {
    if (!window.confirm(`Remove ${displayName} from the group?`)) return;
    try {
      await api.del(`/api/conversations/${convId}/members/${userId}`);
      refreshConversations();
    } catch (e) {
      push({ kind: 'error', title: 'Could not remove member', body: e.message });
    }
  };

  const leaveOrDelete = async () => {
    try {
      if (isGroup) {
        await api.del(`/api/conversations/${convId}/members/${user.id}`);
        push({ kind: 'info', title: 'You left the group' });
      } else {
        await api.del(`/api/conversations/${convId}`);
      }
      removeConversation(convId);
      onClose();
    } catch (e) {
      push({ kind: 'error', title: 'Operation failed', body: e.message });
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative flex h-full w-full max-w-sm animate-slide-in flex-col bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-ink-700 px-4 py-3">
          <button onClick={onClose} className="p-1 text-2xl text-gray-300" aria-label="Close">
            ✕
          </button>
          <span className="text-base font-semibold">Contact info</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col items-center gap-2 bg-ink-850 px-4 py-6">
            <Avatar name={title} src={peer?.avatarUrl} size={96} />
            {editingName ? (
              <div className="flex w-full items-center gap-2">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="flex-1 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm"
                  autoFocus
                />
                <button onClick={saveName} className="rounded-lg bg-mint-400 px-3 py-2 text-sm font-semibold text-ink-950">
                  Save
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xl font-semibold text-gray-100">{title}</span>
                {isGroup && (
                  <button
                    onClick={() => {
                      setNameDraft(conv.name || '');
                      setEditingName(true);
                    }}
                    className="text-gray-400 hover:text-gray-200"
                    aria-label="Rename group"
                  >
                    ✏️
                  </button>
                )}
              </div>
            )}
            {!isGroup && peer && (
              <div className="text-sm text-gray-400">
                @{peer.username}
                {peer.about ? ` · ${peer.about}` : ''}
              </div>
            )}
            {isGroup && (
              <div className="text-sm text-gray-400">{members.length} members</div>
            )}
          </div>

          {/* Wallpaper — jo lagao ge, sab ko dikhega */}
          <div className="border-t border-ink-700 px-4 py-3">
            <div className="mb-1 text-sm font-semibold text-gray-300">🖼️ Wallpaper</div>
            <div className="mb-2 text-xs text-gray-500">Jo wallpaper lagao ge, wo sab ko dikhega</div>
            <div className="grid grid-cols-4 gap-2">
              {WALLPAPER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyWallpaper(p.id)}
                  disabled={wpSaving}
                  className="flex flex-col items-center gap-1"
                >
                  <span
                    style={p.style}
                    className={`block h-14 w-full rounded-lg border-2 ${activeWp === p.id ? 'border-mint-400' : 'border-transparent'}`}
                  />
                  <span className="text-[10px] text-gray-400">{p.name}</span>
                </button>
              ))}
              <button onClick={() => wpFileRef.current?.click()} disabled={wpSaving} className="flex flex-col items-center gap-1">
                <span className={`flex h-14 w-full items-center justify-center rounded-lg border-2 bg-ink-800 text-2xl ${activeWp === 'upload' ? 'border-mint-400' : 'border-transparent'}`}>
                  📤
                </span>
                <span className="text-[10px] text-gray-400">Upload</span>
              </button>
            </div>
            <input ref={wpFileRef} type="file" accept="image/*" className="hidden" onChange={uploadWallpaper} />
            {wpSaving && <div className="mt-2 text-xs text-gray-500">Badal raha hai…</div>}
          </div>

          <div className="px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-300">
                {isGroup ? 'Members' : 'Details'}
              </span>
              {isGroup && (
                <button
                  onClick={() => setAdding((v) => !v)}
                  className="text-sm font-semibold text-mint-400"
                >
                  {adding ? 'Done' : '+ Add'}
                </button>
              )}
            </div>

            {adding && (
              <div className="mb-3">
                <input
                  value={search}
                  onChange={(e) => doSearch(e.target.value)}
                  placeholder="Search users…"
                  className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm"
                />
                {results.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => addMember(u.id)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 hover:bg-ink-800"
                  >
                    <Avatar name={u.displayName} src={u.avatarUrl} size={36} />
                    <span className="flex-1 text-left text-sm text-gray-200">
                      {u.displayName}
                      <span className="block text-xs text-gray-500">@{u.username}</span>
                    </span>
                    <span className="text-mint-400">＋</span>
                  </button>
                ))}
              </div>
            )}

            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-2">
                <Avatar
                  name={m.displayName}
                  src={m.avatarUrl}
                  size={44}
                  online={isGroup ? isOnline(m.id) : undefined}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] text-gray-100">
                    {m.displayName}
                    {m.id === user.id && <span className="text-gray-500"> (you)</span>}
                  </div>
                  <div className="truncate text-xs text-gray-500">@{m.username}</div>
                </div>
                {isGroup && m.id !== user.id && (
                  <button
                    onClick={() => removeMember(m.id, m.displayName)}
                    className="rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-ink-800"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-ink-700 p-4">
          {!confirmLeave ? (
            <button
              onClick={() => setConfirmLeave(true)}
              className="w-full rounded-xl bg-ink-800 py-3 text-[15px] font-semibold text-red-400 hover:bg-ink-700"
            >
              {isGroup ? 'Leave group' : 'Delete conversation'}
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmLeave(false)}
                className="flex-1 rounded-xl bg-ink-800 py-3 text-[15px] font-semibold text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={leaveOrDelete}
                className="flex-1 rounded-xl bg-red-600 py-3 text-[15px] font-semibold text-white"
              >
                Confirm
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
