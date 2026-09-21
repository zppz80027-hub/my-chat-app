// Date / time / size formatting helpers.

function toDate(v) {
  return v instanceof Date ? v : new Date(v);
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = toDate(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Conversation-list timestamp: time today, "Yesterday", weekday, else date. */
export function fmtListTime(iso) {
  if (!iso) return '';
  const d = toDate(iso);
  const now = new Date();
  const dayMs = 86400000;
  const diff = startOfDay(now) - startOfDay(d);
  if (diff <= 0) return fmtTime(d);
  if (diff === dayMs) return 'Yesterday';
  if (diff < 7 * dayMs) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** "12 September 2026" style divider label. */
export function fmtDivider(iso) {
  return toDate(iso).toLocaleDateString([], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function sameDay(a, b) {
  const x = toDate(a);
  const y = toDate(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

export function fmtSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

export function timeAgo(iso) {
  if (!iso) return 'offline';
  const s = Math.floor((Date.now() - toDate(iso).getTime()) / 1000);
  if (s < 60) return 'last seen just now';
  if (s < 3600) return `last seen ${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `last seen ${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'last seen yesterday';
  if (d < 7) return `last seen ${d} days ago`;
  return `last seen ${toDate(iso).toLocaleDateString()}`;
}

export function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function fmtCallDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
