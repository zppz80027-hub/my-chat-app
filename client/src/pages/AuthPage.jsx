import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function AuthPage() {
  const { join } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Apna naam likho.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await join(trimmed);
    } catch (err) {
      setError(err.message || 'Join nahi ho paya. Dobara try karo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-ink-950 px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-mint-400 text-4xl">
            💬
          </div>
          <h1 className="text-3xl font-bold text-gray-100">Cloude</h1>
          <p className="mt-1 text-sm text-gray-400">Fast, private messaging</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-400">Tumhara naam</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aarav Sharma"
              autoComplete="name"
              maxLength={60}
              autoFocus
              className="w-full rounded-xl border border-ink-700 bg-ink-800 px-4 py-3 text-[15px] text-gray-100 placeholder-gray-600"
            />
          </label>
          {error && (
            <div className="rounded-xl border border-red-900 bg-red-950 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="mt-2 rounded-xl bg-mint-400 py-3.5 text-base font-semibold text-ink-950 hover:bg-mint-600 disabled:opacity-50"
          >
            {busy ? 'Please wait…' : 'Start chatting'}
          </button>
          <p className="text-center text-xs text-gray-500">
            Koi account ya password nahi chahiye — bas naam likho aur shuru karo.
          </p>
        </form>
      </div>
    </div>
  );
}
