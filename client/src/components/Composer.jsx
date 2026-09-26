import React, { useEffect, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { uploadFileSmart, findPendingUpload } from '../utils/api';
import { fmtSize } from '../utils/format';
import EmojiPicker from './EmojiPicker';

export default function Composer({ convId, replyTo, onCancelReply, editing, onCancelEdit }) {
  const { sendText, sendFileMessage, editMessage, startTyping, stopTyping } = useChat();
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [upload, setUpload] = useState(null); // { name, size, pct }
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const imageRef = useRef(null);
  const uploadAbort = useRef(null);

  useEffect(() => {
    if (editing) {
      setText(editing.text || '');
      inputRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // Stop typing indicator when leaving the conversation.
  useEffect(() => () => stopTyping(convId), [convId, stopTyping]);

  const handleChange = (e) => {
    setText(e.target.value);
    if (e.target.value.trim()) startTyping(convId);
    else stopTyping(convId);
  };

  const doSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || upload) return;
    setSending(true);
    stopTyping(convId);
    try {
      if (editing) {
        await editMessage(editing.id, trimmed);
        onCancelEdit();
      } else {
        await sendText(convId, trimmed, replyTo);
        onCancelReply();
      }
      setText('');
      setShowEmoji(false);
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  const pickFile = (accept, multiple = false) => {
    const input = accept === 'image/*' ? imageRef.current : fileRef.current;
    if (input) {
      input.accept = accept;
      input.multiple = multiple;
      input.click();
    }
    setShowAttach(false);
  };

  const handleFiles = async (files) => {
    const list = [...files];
    if (list.length === 0) return;
    for (const file of list) {
      if (file.size > 10 * 1024 ** 3) {
        alert(`"${file.name}" is larger than 10 GB and was skipped.`);
        continue;
      }
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      const kind = isImage ? 'image' : isVideo ? 'video' : 'file';
      const aborter = new AbortController();
      uploadAbort.current = aborter;
      const wasPending = !!findPendingUpload(file, convId);
      setUpload({ name: file.name, size: file.size, pct: 0, resumed: wasPending });
      try {
        const done = await uploadFileSmart(file, convId, (p) => {
          setUpload((u) => (u ? { ...u, pct: Math.round(p * 100) } : u));
        }, aborter.signal);
        await sendFileMessage(convId, done, kind, null, replyTo);
        onCancelReply();
      } catch (e) {
        if (e.name !== 'AbortError') alert(`Upload failed: ${e.message}`);
      } finally {
        setUpload(null);
        uploadAbort.current = null;
      }
    }
  };

  const cancelUpload = () => {
    uploadAbort.current?.abort();
  };

  const insertEmoji = (e) => {
    const el = inputRef.current;
    if (el) {
      const s = el.selectionStart ?? text.length;
      const en = el.selectionEnd ?? text.length;
      setText(text.slice(0, s) + e + text.slice(en));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(s + e.length, s + e.length);
      });
    } else {
      setText((t) => t + e);
    }
  };

  return (
    <div className="border-t border-ink-700 bg-ink-900">
      {replyTo && (
        <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2">
          <div className="min-w-0 flex-1 border-l-2 border-mint-400 pl-2">
            <div className="text-xs font-semibold text-mint-400">
              {replyTo.senderDisplayName || 'Message'}
            </div>
            <div className="truncate text-xs text-gray-400">{replyTo.text}</div>
          </div>
          <button onClick={onCancelReply} className="p-1 text-xl text-gray-400" aria-label="Cancel reply">
            ✕
          </button>
        </div>
      )}
      {editing && (
        <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-amber-400">Editing message</div>
            <div className="truncate text-xs text-gray-400">{editing.text}</div>
          </div>
          <button onClick={onCancelEdit} className="p-1 text-xl text-gray-400" aria-label="Cancel edit">
            ✕
          </button>
        </div>
      )}

      {upload && (
        <div className="border-b border-ink-700 bg-ink-850 px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-gray-300">
                {upload.resumed ? '↻ Wahi se aage' : 'Uploading'} {upload.name} ({fmtSize(upload.size)})
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full rounded-full bg-mint-400 transition-all"
                  style={{ width: `${upload.pct}%` }}
                />
              </div>
            </div>
            <span className="text-xs text-gray-400">{upload.pct}%</span>
            <button onClick={cancelUpload} className="p-1 text-lg text-gray-400" aria-label="Cancel upload">
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-1 px-2 py-2">
        <div className="relative">
          <button
            onClick={() => setShowAttach((v) => !v)}
            className="rounded-full p-2.5 text-2xl text-gray-400 hover:bg-ink-800"
            aria-label="Attach"
          >
            📎
          </button>
          {showAttach && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowAttach(false)} />
              <div className="absolute bottom-12 left-0 z-50 w-48 animate-fade-in rounded-xl border border-ink-700 bg-ink-850 p-1 shadow-xl">
                <button
                  onClick={() => pickFile('image/*', true)}
                  className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-gray-200 hover:bg-ink-700"
                >
                  🖼️ Photos
                </button>
                <button
                  onClick={() => pickFile('*/*', true)}
                  className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-gray-200 hover:bg-ink-700"
                >
                  📄 Documents
                </button>
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => setShowEmoji((v) => !v)}
          className={`rounded-full p-2.5 text-2xl hover:bg-ink-800 ${
            showEmoji ? 'text-mint-400' : 'text-gray-400'
          }`}
          aria-label="Emoji"
        >
          😊
        </button>

        <textarea
          ref={inputRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKey}
          rows={1}
          placeholder="Type a message"
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-ink-700 bg-ink-800 px-4 py-2.5 text-[15px] text-gray-100 placeholder-gray-500"
          style={{ overflowY: text.split('\n').length > 2 ? 'auto' : 'hidden' }}
        />

        <button
          onClick={doSend}
          disabled={!text.trim() || sending || !!upload}
          className={`rounded-full p-2.5 text-2xl transition ${
            text.trim() && !sending && !upload
              ? 'bg-mint-400 text-ink-950 hover:bg-mint-600'
              : 'text-gray-600'
          }`}
          aria-label="Send"
        >
          ➤
        </button>
      </div>

      {showEmoji && (
        <EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmoji(false)} />
      )}

      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
