import React, { useEffect, useRef, useState } from 'react';
import { useCall } from '../context/CallContext';
import { fmtCallDuration } from '../utils/format';
import Avatar from './Avatar';

function VideoView({ stream, muted, label }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className="h-full w-full object-cover"
      />
      {label && (
        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          {label}
        </span>
      )}
    </div>
  );
}

export default function CallOverlay() {
  const { call, acceptCall, rejectCall, endCall, toggleMute, toggleCamera } = useCall();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (call.phase !== 'active' || !call.startedAt) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - call.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [call.phase, call.startedAt]);

  if (call.phase === 'idle') return null;

  const isVideo = !!call.isVideo;
  const showRemoteVideo = call.phase === 'active' && isVideo && call.remoteStream;
  const showLocalVideo = isVideo && call.localStream && !call.videoOff;

  const statusText =
    call.phase === 'incoming'
      ? `Incoming ${isVideo ? 'video' : 'voice'} call`
      : call.phase === 'outgoing'
      ? call.ringing
        ? 'Ringing…'
        : 'Calling…'
      : fmtCallDuration(elapsed);

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-ink-950">
      {/* Remote video fills the background when active */}
      {showRemoteVideo ? (
        <div className="absolute inset-0">
          <VideoView stream={call.remoteStream} muted={false} />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-ink-850 to-ink-950" />
      )}

      <div className="relative flex flex-1 flex-col items-center justify-center gap-4 px-6">
        {!showRemoteVideo && (
          <Avatar name={call.peerName} src={call.peerAvatar} size={110} />
        )}
        <div className="text-center">
          <div className={`text-2xl font-semibold ${showRemoteVideo ? 'text-white drop-shadow' : 'text-gray-100'}`}>
            {call.peerName}
          </div>
          <div className={`mt-1 text-sm ${showRemoteVideo ? 'text-white/80' : 'text-gray-400'}`}>
            {statusText}
          </div>
        </div>
        {!isVideo && call.phase === 'active' && (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ink-700 text-3xl">
            🎙️
          </div>
        )}
      </div>

      {/* Local preview PiP */}
      {showLocalVideo && call.phase === 'active' && (
        <div className="absolute right-4 top-4 h-36 w-24 overflow-hidden rounded-xl border border-ink-700 shadow-xl">
          <VideoView stream={call.localStream} muted label="You" />
        </div>
      )}

      <div className="relative flex items-center justify-center gap-6 bg-black/30 px-6 pb-10 pt-4">
        {call.phase === 'incoming' && (
          <>
            <button
              onClick={rejectCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-3xl shadow-lg"
              aria-label="Decline"
            >
              📵
            </button>
            <button
              onClick={acceptCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-3xl shadow-lg"
              aria-label="Accept"
            >
              {isVideo ? '📹' : '📞'}
            </button>
          </>
        )}

        {call.phase === 'outgoing' && (
          <button
            onClick={endCall}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-3xl shadow-lg"
            aria-label="Cancel call"
          >
            📵
          </button>
        )}

        {call.phase === 'active' && (
          <>
            <button
              onClick={toggleMute}
              className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl shadow-lg ${
                call.muted ? 'bg-red-600' : 'bg-ink-700'
              }`}
              aria-label={call.muted ? 'Unmute' : 'Mute'}
              title={call.muted ? 'Unmute' : 'Mute'}
            >
              {call.muted ? '🔇' : '🎙️'}
            </button>
            {isVideo && (
              <button
                onClick={toggleCamera}
                className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl shadow-lg ${
                  call.videoOff ? 'bg-red-600' : 'bg-ink-700'
                }`}
                aria-label={call.videoOff ? 'Camera on' : 'Camera off'}
                title={call.videoOff ? 'Camera on' : 'Camera off'}
              >
                {call.videoOff ? '📷' : '📹'}
              </button>
            )}
            <button
              onClick={endCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-3xl shadow-lg"
              aria-label="End call"
            >
              📵
            </button>
          </>
        )}
      </div>
    </div>
  );
}
