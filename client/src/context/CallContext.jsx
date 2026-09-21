import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useSocket } from './SocketContext';
import { useToasts } from './ToastContext';
import { playDialtone, playRingtone } from '../utils/ringtone';

const CallContext = createContext(null);

const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const IDLE = { phase: 'idle' };

export function CallProvider({ children }) {
  const { subscribe, emit } = useSocket();
  const { push } = useToasts();
  const [call, setCall] = useState(IDLE);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const callRef = useRef(call);
  callRef.current = call;
  const emitRef = useRef(emit);
  emitRef.current = emit;
  const stopSoundRef = useRef(null);

  const stopSound = useCallback(() => {
    if (stopSoundRef.current) {
      stopSoundRef.current();
      stopSoundRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopSound();
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        /* ignore */
      }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      localStreamRef.current = null;
    }
    setCall(IDLE);
  }, [stopSound]);

  const ensurePC = useCallback(async () => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection(STUN);
    pc.onicecandidate = (e) => {
      const c = callRef.current;
      if (e.candidate && c.phase !== 'idle' && c.peerId) {
        emitRef.current('call:ice', { toUserId: c.peerId, candidate: e.candidate });
      }
    };
    pc.ontrack = (e) => {
      const stream = e.streams && e.streams[0];
      if (stream) setCall((prev) => ({ ...prev, remoteStream: stream }));
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        // Let the explicit call:end handle teardown; failed -> cleanup with notice.
        if (pc.connectionState === 'failed' && callRef.current.phase === 'active') {
          push({ kind: 'error', title: 'Call failed', body: 'Connection was lost.' });
          cleanup();
          emitRef.current('call:end', { toUserId: callRef.current.peerId });
        }
      }
    };
    pcRef.current = pc;
    return pc;
  }, [cleanup, push]);

  // ---------- outgoing ----------

  const startCall = useCallback(
    async (peerUser, conversationId, isVideo) => {
      if (callRef.current.phase !== 'idle') {
        push({ kind: 'info', title: 'Already in a call' });
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: isVideo,
        });
        localStreamRef.current = stream;
        const pc = await ensurePC();
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        emitRef.current('call:offer', {
          toUserId: peerUser.id,
          offer: pc.localDescription,
          conversationId,
        });
        setCall({
          phase: 'outgoing',
          peerId: peerUser.id,
          peerName: peerUser.displayName || peerUser.username,
          peerAvatar: peerUser.avatarUrl,
          conversationId,
          isVideo,
          ringing: false,
          muted: false,
          videoOff: false,
          localStream: stream,
          remoteStream: null,
          startedAt: null,
        });
        stopSoundRef.current = playDialtone();
      } catch (e) {
        cleanup();
        push({
          kind: 'error',
          title: 'Could not start call',
          body: e.name === 'NotAllowedError' ? 'Camera/microphone permission denied.' : e.message,
        });
      }
    },
    [cleanup, ensurePC, push]
  );

  // ---------- incoming ----------

  const acceptCall = useCallback(async () => {
    const c = callRef.current;
    if (c.phase !== 'incoming' || !c.offer) return;
    try {
      const isVideo = !!c.offer.sdp && c.offer.sdp.includes('m=video');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: isVideo,
      });
      localStreamRef.current = stream;
      const pc = await ensurePC();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(c.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      emitRef.current('call:answer', { toUserId: c.peerId, answer: pc.localDescription });
      stopSound();
      setCall({
        ...c,
        phase: 'active',
        isVideo,
        localStream: stream,
        startedAt: Date.now(),
      });
    } catch (e) {
      push({
        kind: 'error',
        title: 'Could not answer call',
        body: e.name === 'NotAllowedError' ? 'Camera/microphone permission denied.' : e.message,
      });
      emitRef.current('call:reject', { toUserId: c.peerId });
      cleanup();
    }
  }, [cleanup, ensurePC, push, stopSound]);

  const rejectCall = useCallback(() => {
    const c = callRef.current;
    if (c.phase === 'incoming' && c.peerId) {
      emitRef.current('call:reject', { toUserId: c.peerId });
    }
    cleanup();
  }, [cleanup]);

  const endCall = useCallback(() => {
    const c = callRef.current;
    if (c.peerId && (c.phase === 'active' || c.phase === 'outgoing')) {
      emitRef.current('call:end', { toUserId: c.peerId });
    }
    cleanup();
  }, [cleanup]);

  // ---------- in-call controls ----------

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCall((prev) => ({ ...prev, muted: !track.enabled }));
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCall((prev) => ({ ...prev, videoOff: !track.enabled }));
  }, []);

  // ---------- signaling listeners ----------

  useEffect(() => {
    const unsubs = [];

    unsubs.push(
      subscribe('call:offer', ({ fromUserId, fromDisplayName, fromAvatarUrl, offer, conversationId }) => {
        const c = callRef.current;
        if (!offer || !fromUserId) return;
        if (c.phase !== 'idle') {
          // Busy — politely decline.
          emitRef.current('call:reject', { toUserId: fromUserId });
          return;
        }
        const isVideo = !!offer.sdp && offer.sdp.includes('m=video');
        setCall({
          phase: 'incoming',
          peerId: fromUserId,
          peerName: fromDisplayName || 'Unknown caller',
          peerAvatar: fromAvatarUrl || null,
          offer,
          conversationId,
          isVideo,
          muted: false,
          videoOff: false,
          localStream: null,
          remoteStream: null,
          startedAt: null,
        });
        stopSound();
        stopSoundRef.current = playRingtone();
      })
    );

    unsubs.push(
      subscribe('call:answer', async ({ fromUserId, answer }) => {
        const c = callRef.current;
        if (c.phase !== 'outgoing' || !answer || !pcRef.current) return;
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
          stopSound();
          setCall((prev) => ({ ...prev, phase: 'active', startedAt: Date.now() }));
        } catch (e) {
          console.error('setRemoteDescription failed', e);
        }
      })
    );

    unsubs.push(
      subscribe('call:ice', async ({ fromUserId, candidate }) => {
        if (!candidate || !pcRef.current) return;
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('addIceCandidate failed', e);
        }
      })
    );

    unsubs.push(
      subscribe('call:reject', ({ fromUserId }) => {
        const c = callRef.current;
        if (c.phase === 'outgoing' && (!fromUserId || fromUserId === c.peerId)) {
          push({ kind: 'info', title: 'Call declined', body: `${c.peerName} declined the call.` });
          cleanup();
        }
      })
    );

    unsubs.push(
      subscribe('call:end', ({ fromUserId }) => {
        const c = callRef.current;
        if (c.phase !== 'idle' && (!fromUserId || fromUserId === c.peerId)) {
          cleanup();
        }
      })
    );

    unsubs.push(
      subscribe('call:ringing', () => {
        const c = callRef.current;
        if (c.phase === 'outgoing') setCall((prev) => ({ ...prev, ringing: true }));
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [subscribe, cleanup, push, stopSound]);

  // Teardown if the whole provider unmounts.
  useEffect(() => () => cleanup(), [cleanup]);

  const value = {
    call,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
  };
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used inside CallProvider');
  return ctx;
}
