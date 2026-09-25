import { describe, expect, it, vi } from 'vitest';
import { resolveMedia } from './index';

// Allowlisted metadata observed on Kick, 2026-09-25. No media URLs or account data.
const oldId = '302d2f04-d05c-4fdb-86b6-57d175bb03d7';
const newId = '01a0cb24-ca08-7953-9e4a-ae201b03b8ef';
const url = `https://kick.com/aikobliss/videos/${oldId}`;
const modernUrl = `https://kick.com/aikobliss/videos/${newId}`;
const clipId = 'clip_01M35VYB72DC0GQ7GXNYBEFKYA';
const clipUrl = `https://kick.com/aikobliss/clips/${clipId}`;
const video = {
  uuid: oldId,
  status: 'public',
  livestream: {
    start_time: '2026-09-22T22:03:01+00:00',
    duration: 36504000,
    is_live: false,
    vod_id: newId,
    session_title: 'Recording',
    channel: { slug: 'aikobliss' },
  },
};
const clip = {
  id: clipId,
  vod: { id: oldId },
  vod_starts_at: 9292,
  duration: 25,
  started_at: '2026-09-23T00:37:51Z',
  created_at: '2099-01-01T00:00:00Z',
  channel: { slug: 'aikobliss' },
};
function queue(...items: unknown[]) {
  return vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => {
    const item = items.shift();
    if (item instanceof Error) throw item;
    return item instanceof Response ? item : new Response(JSON.stringify(item));
  });
}
describe('Kick metadata', () => {
  it('uses broadcast start and milliseconds, and canonicalizes obsolete IDs', async () => {
    const result = await resolveMedia(`${url}?t=10`, undefined, queue(video));
    expect(result).toMatchObject({
      vod: {
        id: newId,
        url: modernUrl,
        startedAt: '2026-09-22T22:03:01.000Z',
        durationSeconds: 36504,
      },
      offsetSeconds: 10,
    });
  });
  it('accepts the older API’s UTC SQL date without using upload time', async () => {
    const result = await resolveMedia(
      url,
      undefined,
      queue({
        ...video,
        created_at: '2099-01-01',
        livestream: { ...video.livestream, start_time: '2026-09-22 22:03:01' },
      }),
    );
    expect(result.vod.startedAt).toBe('2026-09-22T22:03:01.000Z');
  });
  it('maps current URLs through an explicitly matching vod_id, and caches aliases', async () => {
    const fetcher = queue(new Response('{}', { status: 404 }), [{ video: { uuid: oldId } }], video);
    const current = await resolveMedia(modernUrl, undefined, fetcher);
    expect(current.vod.id).toBe(newId);
    expect((await resolveMedia(url, undefined, fetcher)).vod).toEqual(current.vod);
    expect((await resolveMedia(modernUrl, undefined, fetcher)).vod).toEqual(current.vod);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      fetcher.mock.calls.every(([, init]) => init?.credentials === 'omit' && !init.headers),
    ).toBe(true);
  });
  it('does not select a recording just because its dates match', async () => {
    const fetcher = queue(
      new Response('{}', { status: 404 }),
      [{ video: { uuid: oldId } }],
      { ...video, livestream: { ...video.livestream, vod_id: undefined } },
      { id: 76274 },
      new TypeError('CORS'),
    );
    await expect(resolveMedia(modernUrl, undefined, fetcher)).rejects.toThrow('cannot be matched');
  });
  it('can read the newer service when accessible, whose duration is seconds', async () => {
    const fetcher = queue(
      new Response('{}', { status: 404 }),
      [],
      { id: 76274 },
      {
        data: {
          id: newId,
          status: 'public',
          channel: { slug: 'aikobliss' },
          is_live: false,
          start_time: '2026-09-22T22:03:01Z',
          duration: 36504,
          title: 'Recording',
        },
      },
    );
    expect((await resolveMedia(modernUrl, undefined, fetcher)).vod.durationSeconds).toBe(36504);
  });
  it('maps clips by vod_starts_at, never created_at or started_at', async () => {
    const result = await resolveMedia(`${clipUrl}?t=5`, undefined, queue({ clip }, video));
    expect(result.offsetSeconds).toBe(9297);
    expect(result.vod.url).toBe(modernUrl);
  });
  it('accepts a zero clip offset', async () => {
    expect(
      (
        await resolveMedia(
          clipUrl,
          undefined,
          queue({ clip: { ...clip, vod_starts_at: 0 } }, video),
        )
      ).offsetSeconds,
    ).toBe(0);
  });
  it.each([null, -1, '100', Infinity])('rejects invalid clip offset %s', async (offset) => {
    await expect(
      resolveMedia(clipUrl, undefined, queue({ clip: { ...clip, vod_starts_at: offset } })),
    ).rejects.toThrow('broadcast offset');
  });
  it('rejects missing and expired parents', async () => {
    await expect(
      resolveMedia(clipUrl, undefined, queue({ clip: { ...clip, vod: null } })),
    ).rejects.toThrow('parent VOD');
    await expect(
      resolveMedia(clipUrl, undefined, queue({ clip }, new Response('{}', { status: 410 }))),
    ).rejects.toThrow('410');
  });
  it('rejects out-of-range clip and parent offsets', async () => {
    await expect(resolveMedia(`${clipUrl}?t=25`, undefined, queue({ clip }))).rejects.toThrow(
      'outside the clip',
    );
    await expect(
      resolveMedia(clipUrl, undefined, queue({ clip: { ...clip, vod_starts_at: 36504 } }, video)),
    ).rejects.toThrow('inside the recording');
  });
  it.each([
    { status: 'private' },
    { is_private: true },
    { is_pruned: true },
    { deleted_at: '2026-09-25' },
  ])('rejects inaccessible recordings %j', async (extra) => {
    await expect(resolveMedia(url, undefined, queue({ ...video, ...extra }))).rejects.toThrow(
      'unavailable',
    );
  });
  it.each([{ start_time: null }, { is_live: true }, { duration: '36504000' }])(
    'requires completed, reliable broadcast timing %j',
    async (extra) => {
      await expect(
        resolveMedia(
          url,
          undefined,
          queue({ ...video, livestream: { ...video.livestream, ...extra } }),
        ),
      ).rejects.toThrow('completed broadcast');
    },
  );
  it('rejects mismatched identities and malicious provider URLs', async () => {
    await expect(resolveMedia(url, undefined, queue({ ...video, uuid: newId }))).rejects.toThrow(
      'different recording',
    );
    await expect(
      resolveMedia(clipUrl, undefined, queue({ clip: { ...clip, id: 'another' } })),
    ).rejects.toThrow('different clip');
    await expect(
      resolveMedia(
        clipUrl,
        undefined,
        queue({ clip: { ...clip, channel: { slug: 'evil.com/path' } } }),
      ),
    ).rejects.toThrow('invalid channel');
  });
  it('does not retry restrictions or leak Twitch credentials into Kick requests', async () => {
    const fetcher = queue(new Response('{}', { status: 403 }));
    await expect(
      resolveMedia(url, { clientId: 'client', token: 'private' }, fetcher),
    ).rejects.toThrow('403');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
    expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();
  });
});
