// WebAudio ringtones — no audio assets needed.

let audioCtx = null;

function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function beep({ freq = 440, freq2 = null, at = 0, dur = 0.4, type = 'sine', gain = 0.18 }) {
  const ac = ctx();
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freq2) osc.frequency.setValueAtTime(freq2, t0 + dur / 2);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.03);
  g.gain.setValueAtTime(gain, t0 + dur - 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/**
 * Classic phone ring: two-tone burst, pause, repeat.
 * Returns a stop() function.
 */
export function playRingtone() {
  let stopped = false;
  let timer = null;
  const ring = () => {
    if (stopped) return;
    beep({ freq: 440, freq2: 480, dur: 0.9 });
    beep({ freq: 440, freq2: 480, at: 1.0, dur: 0.9 });
    timer = setTimeout(ring, 3000);
  };
  try {
    ring();
  } catch {
    /* audio unavailable */
  }
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** Outgoing dial tone: soft repeating beep. Returns stop(). */
export function playDialtone() {
  let stopped = false;
  let timer = null;
  const dial = () => {
    if (stopped) return;
    beep({ freq: 440, dur: 0.5, gain: 0.08, type: 'sine' });
    timer = setTimeout(dial, 1500);
  };
  try {
    dial();
  } catch {
    /* audio unavailable */
  }
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** Short blip for incoming messages while a chat is open. */
export function playPop() {
  try {
    beep({ freq: 660, dur: 0.08, gain: 0.06 });
  } catch {
    /* ignore */
  }
}
