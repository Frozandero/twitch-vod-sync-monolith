import { resolveKick, resolveKickChannel } from './kick';
export { resolveKickPlayback } from './kick';
import {
  parseMedia,
  parseChannelTarget,
  matchMoment,
  startMs,
  parseTime,
  validateVod,
  type MediaRef,
  type ResolvedMedia,
  type Vod,
} from '@vodsync/core';
export type TwitchAuth = { clientId: string; token: string };
type Fetcher = typeof fetch;
const PUBLIC_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // Public Twitch web application identifier; not a secret.
async function json(url: string, options: RequestInit, fetcher: Fetcher): Promise<any> {
  const response = await fetcher(url, {
    ...options,
    signal: AbortSignal.timeout(12000),
    credentials: 'omit',
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Twitch connection expired. Reconnect or use public lookup.'
        : `Metadata request failed (${response.status}). Retry or connect Twitch in Settings.`,
    );
  return response.json();
}
export async function resolveChannelTarget(
  input: string,
  momentMs: number,
  auth?: TwitchAuth,
  fetcher: Fetcher = fetch,
): Promise<ResolvedMedia> {
  const target = parseChannelTarget(input);
  if (!target) throw new Error('Use twitch/name or kick/name for a streamer target.');
  if (!Number.isFinite(momentMs) || !Number.isFinite(new Date(momentMs).getTime()))
    throw new Error('Select a broadcast moment first.');
  if (target.platform === 'kick') return resolveKickChannel(target.channel, momentMs, fetcher);
  const { channel } = target;
  const user = auth
    ? await helix(
        `users?login=${encodeURIComponent(channel)}`,
        auth,
        fetcher,
        `Twitch channel ${channel} was not found.`,
      )
    : null;
  if (
    auth &&
    (typeof user?.id !== 'string' ||
      !/^\d+$/.test(user.id) ||
      typeof user.login !== 'string' ||
      user.login.toLowerCase() !== channel)
  )
    throw new Error('Twitch returned a different channel.');
  let cursor: string | null = null;
  const cursors = new Set<string>();
  for (let page = 0; page < 10; page++) {
    let items: any[];
    let next: unknown;
    if (auth) {
      const params = new URLSearchParams({
        user_id: user.id,
        type: 'archive',
        sort: 'time',
        first: '100',
      });
      if (cursor) params.set('after', cursor);
      const data = await json(
        `https://api.twitch.tv/helix/videos?${params}`,
        {
          headers: { 'Client-ID': auth.clientId, Authorization: `Bearer ${auth.token}` },
        },
        fetcher,
      );
      if (!Array.isArray(data.data)) throw new Error('Twitch returned an invalid recording list.');
      items = data.data.slice(0, 100);
      next = data.pagination?.cursor;
    } else {
      const data = await gql(
        'query VodSyncChannel($login: String!, $after: Cursor) { user(login: $login) { login videos(first: 30, after: $after, type: ARCHIVE, sort: TIME) { edges { cursor node { id title createdAt lengthSeconds broadcastType owner { login displayName } } } pageInfo { hasNextPage } } } }',
        { login: channel, after: cursor },
        fetcher,
      );
      if (!data?.user) throw new Error(`Twitch channel ${channel} was not found.`);
      if (typeof data.user.login !== 'string' || data.user.login.toLowerCase() !== channel)
        throw new Error('Twitch returned a different channel.');
      const list = data.user.videos;
      if (!Array.isArray(list?.edges))
        throw new Error('Twitch returned an invalid recording list.');
      items = list.edges.slice(0, 30).map((edge: any) => edge?.node);
      next = list.pageInfo?.hasNextPage ? list.edges.at(-1)?.cursor : undefined;
      if (list.pageInfo?.hasNextPage && !next)
        throw new Error('Twitch did not provide the next recording page. Retry the lookup.');
    }
    const matches: Vod[] = [];
    for (const v of items) {
      if (!v || typeof v.id !== 'string' || !/^\d+$/.test(v.id)) continue;
      if (
        auth
          ? v.type !== 'archive' || v.user_id !== user.id
          : v.broadcastType !== 'ARCHIVE' ||
            typeof v.owner?.login !== 'string' ||
            v.owner.login.toLowerCase() !== channel
      )
        continue;
      try {
        const vod = validateVod({
          platform: 'twitch',
          id: v.id,
          url: `https://www.twitch.tv/videos/${v.id}`,
          title: v.title,
          channel: auth ? v.user_name : v.owner.displayName,
          startedAt: auth ? v.created_at : v.createdAt,
          durationSeconds: auth ? parseTime(v.duration) : v.lengthSeconds,
          correctionSeconds: 0,
          provenance: auth ? 'twitch-helix' : 'twitch-public',
        });
        if (matchMoment(vod, momentMs).state === 'playing') matches.push(vod);
      } catch {
        /* Unusable archive metadata cannot establish a match. */
      }
    }
    matches.sort((a, b) => startMs(b) - startMs(a));
    if (matches[0])
      return { vod: matches[0], offsetSeconds: matchMoment(matches[0], momentMs).offsetSeconds };
    if (!next) break;
    if (typeof next !== 'string' || next.length > 2048 || cursors.has(next))
      throw new Error('Twitch repeated or returned an invalid recording page. Retry the lookup.');
    cursors.add(next);
    cursor = next;
  }
  throw new Error(
    `No available Twitch past broadcast for ${channel} covers ${new Date(momentMs).toISOString()}. Checked up to ${auth ? 1000 : 300} recent recordings; older, deleted, or unavailable VODs may be missing.`,
  );
}
async function gql(query: string, variables: object, fetcher: Fetcher) {
  const payload = await json(
    'https://gql.twitch.tv/gql',
    {
      method: 'POST',
      headers: { 'Client-ID': PUBLIC_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    },
    fetcher,
  );
  if (payload.errors?.length)
    throw new Error('Twitch public lookup is unavailable. Retry or connect Twitch in Settings.');
  return payload.data;
}
async function helix(
  path: string,
  auth: TwitchAuth,
  fetcher: Fetcher,
  emptyMessage = 'Recording is unavailable, deleted, or not accessible to this account.',
) {
  const result = await json(
    `https://api.twitch.tv/helix/${path}`,
    { headers: { 'Client-ID': auth.clientId, Authorization: `Bearer ${auth.token}` } },
    fetcher,
  );
  if (!result.data?.[0]) throw new Error(emptyMessage);
  return result.data[0];
}
async function twitchVod(id: string, auth: TwitchAuth | undefined, fetcher: Fetcher): Promise<Vod> {
  if (auth) {
    const v = await helix(`videos?id=${encodeURIComponent(id)}`, auth, fetcher);
    if (v.type !== 'archive')
      throw new Error(
        'Only past broadcasts have a reliable timeline. Highlights and uploads are not supported.',
      );
    return validateVod({
      platform: 'twitch',
      id,
      url: `https://www.twitch.tv/videos/${id}`,
      title: v.title,
      channel: v.user_name,
      startedAt: v.created_at,
      durationSeconds: parseTime(v.duration),
      correctionSeconds: 0,
      provenance: 'twitch-helix',
    });
  }
  const result = await gql(
    'query VodSyncVideo($id: ID!) { video(id: $id) { id title createdAt lengthSeconds broadcastType owner { displayName } } }',
    { id },
    fetcher,
  );
  const v = result?.video;
  if (!v) throw new Error('Twitch VOD was not found. It may have expired or been deleted.');
  if (v.broadcastType !== 'ARCHIVE')
    throw new Error(
      'Highlights and uploads are not supported; their upload date is not the broadcast start.',
    );
  return validateVod({
    platform: 'twitch',
    id,
    url: `https://www.twitch.tv/videos/${id}`,
    title: v.title,
    channel: v.owner?.displayName ?? 'Twitch',
    startedAt: v.createdAt,
    durationSeconds: v.lengthSeconds,
    correctionSeconds: 0,
    provenance: 'twitch-public',
  });
}
async function twitchClip(
  ref: MediaRef,
  auth: TwitchAuth | undefined,
  fetcher: Fetcher,
): Promise<ResolvedMedia> {
  let id: string | undefined, offset: number | null, duration: number;
  if (auth) {
    const clip = await helix(`clips?id=${encodeURIComponent(ref.id)}`, auth, fetcher);
    id = clip.video_id;
    offset = clip.vod_offset;
    duration = clip.duration;
  } else {
    const result = await gql(
      'query VodSyncClip($slug: ID!) { clip(slug: $slug) { video { id } videoOffsetSeconds durationSeconds } }',
      { slug: ref.id },
      fetcher,
    );
    if (!result?.clip) throw new Error('Twitch clip was not found.');
    id = result.clip.video?.id;
    offset = result.clip.videoOffsetSeconds;
    duration = result.clip.durationSeconds;
  }
  if (!id || offset == null || !Number.isFinite(offset) || offset < 0)
    throw new Error(
      'This clip has no available parent VOD or offset. Its creation date cannot be used as broadcast time. Try a different clip or the parent VOD URL if available.',
    );
  if (ref.offsetSeconds >= duration) throw new Error('Timestamp is outside the clip.');
  return { vod: await twitchVod(id, auth, fetcher), offsetSeconds: offset + ref.offsetSeconds };
}
export async function resolveMedia(
  input: string,
  auth?: TwitchAuth,
  fetcher: Fetcher = fetch,
): Promise<ResolvedMedia> {
  const ref = parseMedia(input);
  try {
    if (ref.platform === 'kick') return await resolveKick(ref, fetcher);
    if (ref.kind === 'clip') return await twitchClip(ref, auth, fetcher);
    return { vod: await twitchVod(ref.id, auth, fetcher), offsetSeconds: ref.offsetSeconds };
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name))
    )
      throw new Error(
        `${ref.platform === 'kick' ? 'Could not reach Kick metadata. Retry or open the link on Kick.' : 'Could not reach Twitch. Retry or connect Twitch in Settings.'}`,
      );
    throw error;
  }
}
