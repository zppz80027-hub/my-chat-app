import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useToasts } from '../context/ToastContext';
import Avatar from '../components/Avatar';

export default function ProfilePage() {
  const { user, updateUser, logout } = useAuth();
  const { push } = useToasts();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [about, setAbout] = useState(user?.about || '');
  const [preview, setPreview] = useState(null); // object URL
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setDisplayName(user?.displayName || '');
    setAbout(user?.about || '');
  }, [user]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pickAvatar = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      push({ kind: 'error', title: 'Please choose an image file.' });
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    setFile(f);
  };

  const uploadAvatar = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('avatar', file);
      const res = await api.post('/api/profile/avatar', form);
      const updated = res?.user || (res?.avatarUrl ? { ...user, avatarUrl: res.avatarUrl } : null);
      if (updated) updateUser(updated);
      else {
        const { user: fresh } = await api.get('/api/auth/me');
        if (fresh) updateUser(fresh);
      }
      setPreview(null);
      setFile(null);
      push({ kind: 'success', title: 'Avatar updated' });
    } catch (e) {
      push({ kind: 'error', title: 'Avatar upload failed', body: e.message });
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const name = displayName.trim();
    if (!name) {
      push({ kind: 'error', title: 'Display name cannot be empty.' });
      return;
    }
    setSaving(true);
    try {
      const res = await api.patch('/api/profile', { displayName: name, about: about.trim() });
      const updated = res?.user || { ...user, displayName: name, about: about.trim() };
      updateUser(updated);
      push({ kind: 'success', title: 'Profile saved' });
    } catch (e) {
      push({ kind: 'error', title: 'Save failed', body: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-8">
      <div className="flex flex-col items-center gap-3 bg-ink-850 px-6 py-8">
        <button onClick={() => inputRef.current?.click()} className="relative" aria-label="Change avatar">
          {preview ? (
            <img src={preview} alt="preview" className="h-24 w-24 rounded-full object-cover" />
          ) : (
            <Avatar name={user?.displayName} src={user?.avatarUrl} size={96} />
          )}
          <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-mint-400 text-lg text-ink-950">
            📷
          </span>
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={pickAvatar} />
        {preview && (
          <div className="flex gap-2">
            <button
              onClick={uploadAvatar}
              disabled={uploading}
              className="rounded-xl bg-mint-400 px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <button
              onClick={() => {
                if (preview) URL.revokeObjectURL(preview);
                setPreview(null);
                setFile(null);
              }}
              className="rounded-xl bg-ink-700 px-4 py-2 text-sm font-semibold text-gray-200"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="text-center">
          <div className="text-xl font-semibold text-gray-100">{user?.displayName}</div>
          <div className="text-sm text-gray-500">@{user?.username}</div>
        </div>
      </div>

      <div className="mx-auto flex max-w-md flex-col gap-4 px-6 py-6">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-400">Display name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            className="w-full rounded-xl border border-ink-700 bg-ink-800 px-4 py-3 text-[15px]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-400">About</span>
          <textarea
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            maxLength={140}
            rows={3}
            placeholder="A short bio…"
            className="w-full resize-none rounded-xl border border-ink-700 bg-ink-800 px-4 py-3 text-[15px]"
          />
        </label>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-mint-400 py-3 text-[15px] font-semibold text-ink-950 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={() => {
            if (window.confirm('Log out of Ping?')) logout();
          }}
          className="rounded-xl bg-ink-800 py-3 text-[15px] font-semibold text-red-400 hover:bg-ink-700"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
