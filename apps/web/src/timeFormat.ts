const pad = (value: number) => String(value).padStart(2, '0');

export function clock(ms: number, local: boolean) {
  const date = new Date(ms);
  return local
    ? [date.getHours(), date.getMinutes(), date.getSeconds()].map(pad).join(':')
    : date.toISOString().slice(11, 19);
}

export function shortClock(ms: number, local: boolean) {
  return clock(ms, local).slice(0, 5);
}

export function calendarDate(ms: number, local: boolean) {
  const date = new Date(ms);
  return local
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    : date.toISOString().slice(0, 10);
}

// "Sun 18 Oct 2026" in the chosen zone, independent of the browser locale.
export function dayLabel(ms: number, local: boolean) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: local ? undefined : 'UTC',
  })
    .format(new Date(ms))
    .replace(',', '');
}

// Player drift: one decimal under a minute, minutes and seconds beyond.
export function formatDelta(seconds: number) {
  const sign = seconds < 0 ? '−' : '+';
  const abs = Math.abs(seconds);
  if (abs < 0.05) return '0.0 s';
  if (abs < 60) return `${sign}${abs.toFixed(1)} s`;
  const whole = Math.round(abs);
  return `${sign}${Math.floor(whole / 60)}:${pad(whole % 60)}`;
}

// A compact span such as "7h 19m" or "42m".
export function formatSpan(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${pad(minutes % 60)}m` : `${minutes}m`;
}
