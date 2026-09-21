import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-400">{label}</span>
      <input
        {...props}
        className="w-full rounded-xl border border-ink-700 bg-ink-800 px-4 py-3 text-[15px] text-gray-100 placeholder-gray-600"
      />
    </label>
  );
}

export default function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const validate = () => {
    if (!username.trim()) return 'Enter a username.';
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username.trim()))
      return 'Username must be 3–30 characters (letters, numbers, _ . -).';
    if (password.length < 6) return 'Password must be at least 6 characters.';
    if (mode === 'register' && !displayName.trim()) return 'Enter a display name.';
    return '';
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(username.trim(), password);
      else await register(username.trim(), password, displayName.trim());
    } catch (err) {
      setError(err.message || 'Authentication failed. Try again.');
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
          <h1 className="text-3xl font-bold text-gray-100">Ping</h1>
          <p className="mt-1 text-sm text-gray-400">Fast, private messaging</p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-ink-800 p-1">
          {['login', 'register'].map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError('');
              }}
              className={`rounded-lg py-2 text-sm font-semibold capitalize ${
                mode === m ? 'bg-ink-700 text-gray-100' : 'text-gray-400'
              }`}
            >
              {m === 'login' ? 'Log in' : 'Sign up'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. aarav_99"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
          />
          {mode === 'register' && (
            <Field
              label="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Aarav Sharma"
              autoComplete="name"
            />
          )}
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
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
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
