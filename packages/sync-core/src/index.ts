export type Platform = 'twitch' | 'kick';
export type MediaRef = {
  platform: Platform;
  kind: 'vod' | 'clip';
  id: string;
  url: string;
  offsetSeconds: number;
};
export type Vod = {
  platform: Platform;
  id: string;
  url: string;
  title: string;
  channel: string;
  startedAt: string;
  durationSeconds: number;
  correctionSeconds: number;
  provenance: 'twitch-public' | 'twitch-helix' | 'kick-public' | 'manual' | 'demo';
};
export type ResolvedMedia = { vod: Vod; offsetSeconds: number };
export type Match = {
  state: 'before' | 'playing' | 'ended';
  offsetSeconds: number;
  gapSeconds: number;
  url: string;
};
// Import/request resource guard, not a visible workspace quota.
export const MAX_VODS = 100;

export function parseTime(value: string): number {
  const text = value.trim().toLowerCase();
  if (!text) return 0;
  let seconds: number;
  if (/^\d+(?:\.\d+)?$/.test(text)) seconds = Number(text);
  else if (/^\d+:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(text)) {
    const parts = text.split(':').map(Number);
    if (parts.slice(1).some((v) => v >= 60))
      throw new Error('Minutes and seconds must be below 60.');
    seconds = parts.reduce((acc, part) => acc * 60 + part, 0);
  } else {
    const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(text);
    if (!units || !units.slice(1).some(Boolean))
      throw new Error('Use 1:23:45, 23:45, 1h23m45s, or seconds.');
    seconds = Number(units[1] || 0) * 3600 + Number(units[2] || 0) * 60 + Number(units[3] || 0);
  }
  if (!Number.isFinite(seconds) || seconds > 31536000) throw new Error('Timestamp is too large.');
  return seconds;
}

export function formatTime(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds));
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60]
    .map((x) => String(x).padStart(2, '0'))
    .join(':');
}

export function formatGap(seconds: number): string {
  const n = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(n / 3600)}h ${Math.floor(n / 60) % 60}m ${n % 60}s`;
}

export function matchDescription(match: Match): string {
  if (match.state === 'before')
    return `No match — starts ${formatGap(match.gapSeconds)} after this moment`;
  if (match.state === 'ended')
    return `No match — ended ${formatGap(match.gapSeconds)} before this moment`;
  return 'Matching moment';
}

export function timelineBounds(vods: Vod[]): { min: number; max: number } {
  if (!vods.length) throw new Error('A timeline needs at least one recording.');
  return {
    min: Math.min(...vods.map(startMs)),
    max: Math.max(...vods.map((v) => startMs(v) + v.durationSeconds * 1000)),
  };
}

export function parseMedia(input: string): MediaRef {
  let value = input.trim();
  if (/^v?\d+$/.test(value)) value = `https://www.twitch.tv/videos/${value.replace(/^v/, '')}`;
  if (!/^[a-z]+:\/\//i.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a Twitch or Kick VOD/clip URL, or a Twitch VOD ID.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port)
    throw new Error('Use a regular Twitch or Kick URL.');
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const path = url.pathname.replace(/\/$/, '');
  const offsetSeconds = parseTime(url.searchParams.get('t') ?? url.searchParams.get('time') ?? '0');
  if (host === 'twitch.tv') {
    const vod = /^\/(?:videos\/|[\w-]+\/video\/)(\d+)$/.exec(path);
    if (vod)
      return {
        platform: 'twitch',
        kind: 'vod',
        id: vod[1],
        url: `https://www.twitch.tv/videos/${vod[1]}`,
        offsetSeconds,
      };
    const clip = /^\/[\w-]+\/clip\/([\w-]+)$/.exec(path);
    if (clip)
      return {
        platform: 'twitch',
        kind: 'clip',
        id: clip[1],
        url: `https://clips.twitch.tv/${clip[1]}`,
        offsetSeconds,
      };
  }
  if (host === 'clips.twitch.tv' && /^\/[\w-]+$/.test(path))
    return {
      platform: 'twitch',
      kind: 'clip',
      id: path.slice(1),
      url: `https://clips.twitch.tv${path}`,
      offsetSeconds,
    };
  if (host === 'kick.com') {
    const vod =
      /^\/(?:[\w-]+\/videos|video|videos)\/([a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i.exec(path);
    if (vod)
      return {
        platform: 'kick',
        kind: 'vod',
        id: vod[1].toLowerCase(),
        url: `https://kick.com${path.toLowerCase()}`,
        offsetSeconds,
      };
    const clip = /^\/([\w-]+)\/clips\/(clip_[\w-]{1,100})$/.exec(path);
    const legacyClip = /^\/[\w-]+$/.test(path) ? url.searchParams.get('clip') : null;
    const id = clip?.[2] ?? legacyClip;
    if (id && /^clip_[\w-]{1,100}$/.test(id))
      return {
        platform: 'kick',
        kind: 'clip',
        id,
        url: `https://kick.com/${(clip?.[1] ?? path.slice(1)).toLowerCase()}/clips/${id}`,
        offsetSeconds,
      };
  }
  throw new Error('Unsupported link. Use a Twitch or Kick VOD/clip URL.');
}

export const vodKey = (vod: Pick<Vod, 'platform' | 'id'>) => `${vod.platform}:${vod.id}`;
export const startMs = (vod: Vod) => Date.parse(vod.startedAt) + vod.correctionSeconds * 1000;
export function momentAt(vod: Vod, offset: number): number {
  if (!Number.isFinite(offset) || offset < 0 || offset >= vod.durationSeconds)
    throw new Error('Source timestamp must fall inside the recording.');
  return startMs(vod) + offset * 1000;
}
export function timestampUrl(vod: Vod, offset: number): string {
  const url = new URL(vod.url);
  const seconds = Math.max(0, Math.floor(offset));
  url.search = '';
  url.hash = '';
  url.searchParams.set(
    't',
    vod.platform === 'twitch'
      ? `${Math.floor(seconds / 3600)}h${Math.floor(seconds / 60) % 60}m${seconds % 60}s`
      : String(seconds),
  );
  return url.toString();
}
export function matchMoment(vod: Vod, moment: number): Match {
  const raw = (moment - startMs(vod)) / 1000;
  const state = raw < 0 ? 'before' : raw >= vod.durationSeconds ? 'ended' : 'playing';
  const offsetSeconds = Math.max(0, Math.min(raw, vod.durationSeconds));
  return {
    state,
    offsetSeconds,
    gapSeconds: state === 'before' ? -raw : state === 'ended' ? raw - vod.durationSeconds : 0,
    url: timestampUrl(vod, offsetSeconds),
  };
}

export function validateVod(input: unknown): Vod {
  if (!input || typeof input !== 'object') throw new Error('Invalid recording.');
  const v = input as Vod;
  const ref = parseMedia(v.url);
  if (ref.kind !== 'vod' || ref.id !== v.id || ref.platform !== v.platform)
    throw new Error('Recording URL does not match its identity.');
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v.startedAt) ||
    !Number.isFinite(Date.parse(v.startedAt))
  )
    throw new Error('Enter an ISO start time with a timezone, e.g. 2026-09-25T18:00:00Z.');
  if (!Number.isFinite(v.durationSeconds) || v.durationSeconds <= 0 || v.durationSeconds > 31536000)
    throw new Error('Duration must be greater than zero and under one year.');
  if (!Number.isFinite(v.correctionSeconds) || Math.abs(v.correctionSeconds) > 86400)
    throw new Error('Timing correction must be within 24 hours.');
  if (typeof v.title !== 'string' || typeof v.channel !== 'string')
    throw new Error('Invalid recording label.');
  if (!['twitch-public', 'twitch-helix', 'kick-public', 'manual', 'demo'].includes(v.provenance))
    throw new Error('Invalid metadata source.');
  return {
    platform: ref.platform,
    id: ref.id,
    url: ref.url,
    startedAt: new Date(v.startedAt).toISOString(),
    durationSeconds: v.durationSeconds,
    correctionSeconds: v.correctionSeconds,
    title: v.title.slice(0, 300),
    channel: v.channel.slice(0, 100),
    provenance: v.provenance,
  };
}

export type Session = {
  version: 2;
  vods: Vod[];
  leaderKey: string;
  momentMs: number;
  view: 'grid' | 'links';
};
export function validateSession(value: unknown): Session {
  if (!value || typeof value !== 'object') throw new Error('Invalid session.');
  const v = value as
    | Session
    | { version: 1; vods: Vod[]; sourceKey: string; offsetSeconds: number; view: 'grid' | 'links' };
  if (
    ![1, 2].includes(v.version) ||
    !Array.isArray(v.vods) ||
    !v.vods.length ||
    v.vods.length > MAX_VODS
  )
    throw new Error('Session is empty, unsupported, or too large.');
  const vods = v.vods.map(validateVod);
  if (new Set(vods.map(vodKey)).size !== vods.length)
    throw new Error('Session contains duplicate recordings.');
  const leaderKey = v.version === 1 ? v.sourceKey : v.leaderKey;
  const source = vods.find((vod) => vodKey(vod) === leaderKey);
  if (!source) throw new Error('Session source is missing.');
  const momentMs = v.version === 1 ? momentAt(source, v.offsetSeconds) : v.momentMs;
  const { min, max } = timelineBounds(vods);
  if (!Number.isFinite(momentMs) || momentMs < min || momentMs > max)
    throw new Error('Selected moment is outside the timeline.');
  if (!['grid', 'links'].includes(v.view)) throw new Error('Invalid view.');
  return { version: 2, vods, leaderKey, momentMs, view: v.view };
}
export function encodeSession(value: Session): string {
  const bytes = new TextEncoder().encode(JSON.stringify(validateSession(value)));
  const encoded = btoa(Array.from(bytes, (n) => String.fromCharCode(n)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (encoded.length > 60000)
    throw new Error('This session is too large for a shared link. Export it as JSON instead.');
  return encoded;
}
export function decodeSession(value: string): Session {
  if (value.length > 60000) throw new Error('Shared session is too large.');
  try {
    return validateSession(
      JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
            c.charCodeAt(0),
          ),
        ),
      ),
    );
  } catch {
    throw new Error('This shared session is invalid or uses an unsupported version.');
  }
}
