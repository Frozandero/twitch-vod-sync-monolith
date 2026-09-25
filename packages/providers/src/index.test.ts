import { describe, expect, it, vi } from 'vitest';
import { resolveMedia } from './index';
const video = {
  id: '123',
  title: 'Recording',
  createdAt: '2026-09-25T18:00:00Z',
  lengthSeconds: 7200,
  broadcastType: 'ARCHIVE',
  owner: { displayName: 'Streamer' },
};
function fetchQueue(...bodies: unknown[]) {
  return vi.fn(async () => new Response(JSON.stringify(bodies.shift()), { status: 200 }));
}
describe('Twitch adapters', () => {
  it('loads an anonymous past broadcast', async () => {
    const fetcher = fetchQueue({ data: { video } });
    const result = await resolveMedia('123', undefined, fetcher);
    expect(result.vod.provenance).toBe('twitch-public');
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it('maps a clip using its start offset, never creation time or duration subtraction', async () => {
    const fetcher = fetchQueue(
      {
        data: {
          clip: {
            video: { id: '123' },
            videoOffsetSeconds: 1800,
            durationSeconds: 30,
            createdAt: '2099-01-01',
          },
        },
      },
      { data: { video } },
    );
    expect(
      (await resolveMedia('https://clips.twitch.tv/Example?t=5', undefined, fetcher)).offsetSeconds,
    ).toBe(1805);
  });
  it('rejects missing parent VOD or offset, including null', async () => {
    for (const clip of [
      { video: null, videoOffsetSeconds: 100 },
      { video: { id: '123' }, videoOffsetSeconds: null },
    ])
      await expect(
        resolveMedia('https://clips.twitch.tv/Example', undefined, fetchQueue({ data: { clip } })),
      ).rejects.toThrow('parent VOD');
  });
  it('accepts a clip offset of zero', async () => {
    const fetcher = fetchQueue(
      { data: { clip: { video: { id: '123' }, videoOffsetSeconds: 0, durationSeconds: 30 } } },
      { data: { video } },
    );
    expect(
      (await resolveMedia('https://clips.twitch.tv/Example', undefined, fetcher)).offsetSeconds,
    ).toBe(0);
  });
  it('rejects clip-local timestamps outside clip', async () => {
    await expect(
      resolveMedia(
        'https://clips.twitch.tv/Example?t=30',
        undefined,
        fetchQueue({
          data: { clip: { video: { id: '123' }, videoOffsetSeconds: 0, durationSeconds: 30 } },
        }),
      ),
    ).rejects.toThrow('outside the clip');
  });
  it('rejects highlights rather than using their upload date', async () => {
    await expect(
      resolveMedia(
        '123',
        undefined,
        fetchQueue({ data: { video: { ...video, broadcastType: 'HIGHLIGHT' } } }),
      ),
    ).rejects.toThrow('Highlights');
  });
  it('rejects deleted VODs', async () => {
    await expect(
      resolveMedia('123', undefined, fetchQueue({ data: { video: null } })),
    ).rejects.toThrow('not found');
  });
  it('surfaces public GraphQL failure', async () => {
    await expect(
      resolveMedia('123', undefined, fetchQueue({ errors: [{ message: 'blocked' }] })),
    ).rejects.toThrow('public lookup');
  });
  it('uses official Helix when connected and preserves GET Clips vod_offset', async () => {
    const fetcher = fetchQueue(
      { data: [{ video_id: '123', vod_offset: 100, duration: 30 }] },
      {
        data: [
          {
            id: '123',
            title: 'Recording',
            user_name: 'Streamer',
            type: 'archive',
            created_at: video.createdAt,
            duration: '2h0m0s',
          },
        ],
      },
    );
    const result = await resolveMedia(
      'https://clips.twitch.tv/Example',
      { clientId: 'client', token: 'token' },
      fetcher,
    );
    expect(result.offsetSeconds).toBe(100);
    expect(result.vod.provenance).toBe('twitch-helix');
  });
  it('does not silently switch identity when official auth expires', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 401 }));
    await expect(
      resolveMedia('123', { clientId: 'client', token: 'token' }, fetcher),
    ).rejects.toThrow('expired');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
describe('Kick adapter', () => {
  const url = 'https://kick.com/test/videos/a74f8e34-c35c-4a6e-8520-710cbea58173';
  it('uses stream start_time and converts milliseconds to seconds', async () => {
    const result = await resolveMedia(
      url,
      undefined,
      fetchQueue({
        livestream: {
          start_time: '2026-09-25 18:00:00',
          duration: 7200000,
          session_title: 'Kick stream',
          channel: { slug: 'test' },
        },
      }),
    );
    expect(result.vod.startedAt).toBe('2026-09-25T18:00:00.000Z');
    expect(result.vod.durationSeconds).toBe(7200);
  });
  it('never guesses from upload date when actual start is missing', async () => {
    await expect(
      resolveMedia(
        url,
        undefined,
        fetchQueue({ created_at: '2026-09-25T18:00:00Z', livestream: { duration: 7200000 } }),
      ),
    ).rejects.toThrow('reliable start');
  });
  it('rejects incomplete live recordings', async () => {
    await expect(
      resolveMedia(
        url,
        undefined,
        fetchQueue({
          livestream: { start_time: '2026-09-25 18:00:00', duration: 7200000, is_live: true },
        }),
      ),
    ).rejects.toThrow('completed broadcast');
  });
  it('explains CORS failures with manual recovery', async () => {
    await expect(
      resolveMedia(
        url,
        undefined,
        vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      ),
    ).rejects.toThrow('add timing details manually');
  });
});
