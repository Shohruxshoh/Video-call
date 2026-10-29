export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** localStorage that never throws (private mode, blocked storage, quota). */
export const storage = {
  get<T>(key: string): T | null {
    try {
      const value = localStorage.getItem(key);
      return value === null ? null : (JSON.parse(value) as T);
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  },
};

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const DAY_MS = 24 * 3600 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

function daysAgo(ts: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Math.ceil((start.getTime() - ts) / DAY_MS);
}

export function clock(ts: number) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Compact timestamp for the friends list. */
export function shortTime(ts: number) {
  const ago = daysAgo(ts);
  if (ago <= 0) return clock(ts);
  if (ago === 1) return 'kecha';
  const d = new Date(ts);
  return d.getFullYear() === new Date().getFullYear()
    ? `${d.getDate()}-${MONTHS[d.getMonth()]}`
    : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Separator between days in a conversation. */
export function dayLabel(ts: number) {
  const ago = daysAgo(ts);
  if (ago <= 0) return 'Bugun';
  if (ago === 1) return 'Kecha';
  const d = new Date(ts);
  const label = `${d.getDate()}-${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? label : `${label}, ${d.getFullYear()}`;
}

export function sameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function duration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
