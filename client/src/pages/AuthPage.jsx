// AuthPage naam nahi puchta — app khul te hi "chat" naam se khud join ho jata hai.
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function AuthPage() {
  const { join } = useAuth();
  const [error, setError] = useState('');
  const tried = useRef(false);

  const doJoin = async () => {
    setError('');
    try {
      await join('chat');
    } catch (err) {
      setError(err.message || 'Shuru nahi ho paya. Dobara try karo.');
    }
  };

  useEffect(() => {
    if (!tried.current) {
      tried.current = true;
      doJoin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-full items-center justify-center bg-ink-950 px-6 py-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl bg-mint-400 text-4xl">
          💬
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-100">Cloude</h1>
          <p className="mt-1 text-sm text-gray-400">Fast, private messaging</p>
        </div>
        {error ? (
          <>
            <div className="rounded-xl border border-red-900 bg-red-950 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
            <button
              type="button"
              onClick={doJoin}
              className="rounded-xl bg-mint-400 px-6 py-3 text-base font-semibold text-ink-950 hover:bg-mint-600"
            >
              Dobara try karo
            </button>
          </>
        ) : (
          <div className="text-sm text-gray-500">Shuru ho raha hai…</div>
        )}
      </div>
    </div>
  );
}
