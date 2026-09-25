import { resolveKick } from './kick';
import {
  parseMedia,
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
async function helix(path: string, auth: TwitchAuth, fetcher: Fetcher) {
  const result = await json(
    `https://api.twitch.tv/helix/${path}`,
    { headers: { 'Client-ID': auth.clientId, Authorization: `Bearer ${auth.token}` } },
    fetcher,
  );
  if (!result.data?.[0])
    throw new Error('Recording is unavailable, deleted, or not accessible to this account.');
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
