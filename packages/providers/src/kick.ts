import {
  momentAt,
  parseMedia,
  validateVod,
  type MediaRef,
  type ResolvedMedia,
  type Vod,
} from '@vodsync/core';

type Fetcher = typeof fetch;
class KickHttpError extends Error {
  constructor(public status: number) {
    super(
      status === 404
        ? 'Kick recording or clip was not found. It may have expired or been deleted.'
        : `Kick metadata request failed (${status}). Retry or open the link on Kick.`,
    );
  }
}
async function kickJson(url: string, fetcher: Fetcher) {
  let response: Response;
  try {
    response = await fetcher(url, { credentials: 'omit', signal: AbortSignal.timeout(12000) });
  } catch {
    throw new Error(
      url.startsWith('https://web.kick.com/')
        ? 'Kick blocks this newer recording’s metadata on external websites. This link cannot be matched on GitHub Pages yet. A clip from the same recording may still resolve through Kick’s older service.'
        : 'Could not reach Kick metadata. Retry or open the link on Kick. Connecting Twitch will not fix a Kick lookup.',
    );
  }
  if (!response.ok) throw new KickHttpError(response.status);
  return response.json();
}
function channelSlug(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value))
    throw new Error('Kick returned an invalid channel.');
  return value.toLowerCase();
}
function vodRef(id: unknown, slug: unknown): MediaRef {
  if (typeof id !== 'string') throw new Error('Kick clip has no available parent VOD.');
  const ref = parseMedia(`https://kick.com/${channelSlug(slug)}/videos/${id}`);
  if (ref.kind !== 'vod' || ref.id !== id.toLowerCase())
    throw new Error('Kick returned an invalid VOD.');
  return ref;
}
function makeVod(ref: MediaRef, v: any, modern: boolean): Vod {
  const id = modern ? v?.id : v?.uuid;
  const stream = modern ? v : v?.livestream;
  if (typeof id !== 'string' || id.toLowerCase() !== ref.id)
    throw new Error('Kick returned a different recording.');
  if (v.status !== 'public' || v.is_private || v.deleted_at || v.is_pruned)
    throw new Error('This Kick recording is private, deleted, or unavailable.');
  // Upload/clip creation dates cannot locate footage on a broadcast timeline.
  if (!stream?.start_time || stream.is_live !== false || typeof stream.duration !== 'number')
    throw new Error('Kick did not return a completed broadcast with a reliable start time.');
  const slug = channelSlug(stream.channel?.slug);
  const canonical = vodRef(modern ? id : (stream.vod_id ?? id), slug);
  const rawStart = String(stream.start_time).replace(' ', 'T');
  // The older API also returns UTC SQL timestamps without a suffix.
  const startedAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(rawStart)
    ? `${rawStart}Z`
    : rawStart;
  return validateVod({
    platform: 'kick',
    id: canonical.id,
    url: canonical.url,
    title: (modern ? stream.title : stream.session_title) ?? 'Kick recording',
    channel: stream.channel?.username ?? stream.channel?.user?.username ?? slug,
    startedAt,
    durationSeconds: modern ? stream.duration : stream.duration / 1000,
    correctionSeconds: 0,
    provenance: 'kick-public',
  });
}
type Cache = {
  expires: number;
  recordings: Map<string, Promise<Vod>>;
  lists: Map<string, Promise<string[]>>;
  playback: Map<string, string>;
};
const caches = new WeakMap<Fetcher, Cache>();
function cacheFor(fetcher: Fetcher) {
  let cache = caches.get(fetcher);
  if (!cache || cache.expires < Date.now()) {
    cache = {
      expires: Date.now() + 300000,
      recordings: new Map(),
      lists: new Map(),
      playback: new Map(),
    };
    caches.set(fetcher, cache);
  }
  return cache;
}
function legacyVod(ref: MediaRef, fetcher: Fetcher): Promise<Vod> {
  const cache = cacheFor(fetcher);
  const known = cache.recordings.get(ref.id);
  if (known) return known;
  const pending = kickJson(`https://kick.com/api/v1/video/${ref.id}`, fetcher)
    .then((data) => {
      const vod = makeVod(ref, data, false);
      const source = playbackSource(data.source);
      if (source) cache.playback.set(vod.id, source);
      return vod;
    })
    .then((vod) => {
      cache.recordings.set(vod.id, Promise.resolve(vod));
      return vod;
    })
    .catch((error) => {
      cache.recordings.delete(ref.id);
      throw error;
    });
  cache.recordings.set(ref.id, pending);
  return pending;
}
async function kickVod(ref: MediaRef, fetcher: Fetcher): Promise<Vod> {
  try {
    return await legacyVod(ref, fetcher);
  } catch (error) {
    if (!(error instanceof KickHttpError) || error.status !== 404) throw error;
    const slug = /^\/([\w-]+)\/videos\//.exec(new URL(ref.url).pathname)?.[1];
    if (!slug) throw error;
    const cache = cacheFor(fetcher);
    let list = cache.lists.get(slug);
    if (!list) {
      list = kickJson(`https://kick.com/api/v2/channels/${channelSlug(slug)}/videos`, fetcher)
        .then((items) => {
          if (!Array.isArray(items)) throw new Error('Kick returned an invalid recording list.');
          // Resource guard: inspect recent public recordings, never infer identity from dates.
          return items.slice(0, 50).flatMap((item) => {
            try {
              return [vodRef(item?.video?.uuid, slug).id];
            } catch {
              return [];
            }
          });
        })
        .catch((error) => {
          cache.lists.delete(slug);
          throw error;
        });
      cache.lists.set(slug, list);
    }
    const ids = await list;
    for (let i = 0; i < ids.length; i += 3) {
      const batch = await Promise.allSettled(
        ids.slice(i, i + 3).map((id) => legacyVod(vodRef(id, slug), fetcher)),
      );
      const found = batch.find(
        (result) => result.status === 'fulfilled' && result.value.id === ref.id,
      );
      if (found?.status === 'fulfilled') return found.value;
      for (const result of batch) {
        if (
          result.status === 'rejected' &&
          result.reason instanceof KickHttpError &&
          [401, 403, 429].includes(result.reason.status)
        )
          throw result.reason;
      }
    }
    const channel = await kickJson(
      `https://kick.com/api/v2/channels/${channelSlug(slug)}`,
      fetcher,
    );
    if (!Number.isSafeInteger(channel?.id) || channel.id <= 0)
      throw new Error('Kick returned an invalid channel.');
    // Recordings absent from the legacy index need the new service, which currently
    // blocks browser CORS. Keep its adapter explicit for a future supported API.
    const result = await kickJson(
      `https://web.kick.com/api/v1/channels/${channel.id}/videos/${ref.id}`,
      fetcher,
    );
    return makeVod(ref, result?.data, true);
  }
}
// Public playlists observed on Kick's own CDN. Never accept a media URL from
// an imported session, guess a CDN path, or persist it with recording data.
function playbackSource(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      url.hostname === 'stream.kick.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname.endsWith('.m3u8')
    )
      return url.href;
  } catch {
    /* Missing or unsupported public playback source. */
  }
}

export async function resolveKickPlayback(vod: Vod, refresh = false, fetcher: Fetcher = fetch) {
  const ref = parseMedia(vod.url);
  if (vod.platform !== 'kick' || ref.platform !== 'kick' || ref.kind !== 'vod' || ref.id !== vod.id)
    throw new Error('Invalid Kick recording.');
  if (refresh) caches.delete(fetcher);
  const resolved = await kickVod(ref, fetcher);
  if (resolved.id !== vod.id) throw new Error('Kick returned a different recording.');
  const source = cacheFor(fetcher).playback.get(resolved.id);
  if (!source)
    throw new Error(
      'Kick did not provide a supported public video playlist. Open the VOD on Kick.',
    );
  return source;
}

export async function resolveKick(ref: MediaRef, fetcher: Fetcher): Promise<ResolvedMedia> {
  if (ref.kind === 'vod')
    return { vod: await kickVod(ref, fetcher), offsetSeconds: ref.offsetSeconds };
  const result = await kickJson(
    `https://kick.com/api/v2/clips/${encodeURIComponent(ref.id)}/play`,
    fetcher,
  );
  const clip = result?.clip;
  if (clip?.id !== ref.id) throw new Error('Kick clip was not found or returned a different clip.');
  const offset = clip.vod_starts_at;
  if (!clip.vod?.id || typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0)
    throw new Error(
      'This Kick clip has no available parent VOD or broadcast offset. Its creation date cannot locate the footage.',
    );
  if (
    typeof clip.duration !== 'number' ||
    !Number.isFinite(clip.duration) ||
    clip.duration <= 0 ||
    ref.offsetSeconds >= clip.duration
  )
    throw new Error('Timestamp is outside the clip or its duration is unavailable.');
  const vod = await kickVod(vodRef(clip.vod.id, clip.channel?.slug), fetcher);
  const offsetSeconds = offset + ref.offsetSeconds;
  momentAt(vod, offsetSeconds);
  return { vod, offsetSeconds };
}
