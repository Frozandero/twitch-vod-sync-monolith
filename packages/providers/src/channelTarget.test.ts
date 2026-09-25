import { describe, expect, it, vi } from 'vitest';
import { resolveChannelTarget, resolveMedia } from './index';
const start = '2026-09-23T18:00:00Z';
const moment = Date.parse(start) + 300000;
const video = {
  id: '123',
  title: 'Recording',
  createdAt: start,
  lengthSeconds: 3600,
  broadcastType: 'ARCHIVE',
  owner: { login: 'streamer', displayName: 'Streamer' },
};
const oldId = '089d5bf8-0aec-4576-9809-0689633feca6';
const newId = '01a0d036-d2e8-7921-a378-da2f05c97032';
const kickVideo = {
  uuid: oldId,
  status: 'public',
  livestream: {
    start_time: start,
    is_live: false,
    duration: 3600000,
    vod_id: newId,
    channel: { slug: 'streamer' },
    session_title: 'Recording',
  },
};
function queue(...items: unknown[]) {
  return vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => {
    const item = items.shift();
    return item instanceof Response ? item : new Response(JSON.stringify(item));
  });
}
function page(videos: unknown[], cursor?: string) {
  return {
    data: {
      user: {
        login: 'streamer',
        videos: {
          edges: videos.map((node) => ({ node, cursor })),
          pageInfo: { hasNextPage: !!cursor },
        },
      },
    },
  };
}
describe('Twitch streamer targets', () => {
  it('finds an older matching archive through pagination without selecting the newest VOD', async () => {
    const fetcher = queue(
      page([{ ...video, id: '456', createdAt: '2026-09-24T18:00:00Z' }], 'next'),
      page([video]),
    );
    const result = await resolveChannelTarget('twitch/STREAMER', moment, undefined, fetcher);
    expect(result.vod.id).toBe('123');
    expect(result.offsetSeconds).toBe(300);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).variables.after).toBe('next');
    expect(fetcher.mock.calls.every(([, options]) => options?.credentials === 'omit')).toBe(true);
  });
  it('accepts exact start but rejects exact end and gaps', async () => {
    expect(
      (
        await resolveChannelTarget(
          'twitch/streamer',
          Date.parse(start),
          undefined,
          queue(page([video])),
        )
      ).offsetSeconds,
    ).toBe(0);
    for (const target of [Date.parse(start) - 1, Date.parse(start) + 3600000])
      await expect(
        resolveChannelTarget('twitch/streamer', target, undefined, queue(page([video]))),
      ).rejects.toThrow('No available');
  });
  it('skips highlights, wrong owners and invalid metadata', async () => {
    const invalid = [
      { ...video, broadcastType: 'HIGHLIGHT' },
      { ...video, owner: { login: 'other', displayName: 'Streamer' } },
      { ...video, lengthSeconds: -1 },
      { ...video, owner: { login: 42, displayName: 'Streamer' } },
      { ...video, id: 'https://evil.test' },
    ];
    await expect(
      resolveChannelTarget('twitch/streamer', moment, undefined, queue(page(invalid))),
    ).rejects.toThrow('No available');
  });
  it('chooses the latest start among overlapping archives', async () => {
    const result = await resolveChannelTarget(
      'twitch/streamer',
      moment,
      undefined,
      queue(page([video, { ...video, id: '789', createdAt: '2026-09-23T18:04:00Z' }])),
    );
    expect(result.vod.id).toBe('789');
    expect(result.offsetSeconds).toBe(60);
  });
  it('rejects a different or missing channel', async () => {
    await expect(
      resolveChannelTarget('twitch/streamer', moment, undefined, queue({ data: { user: null } })),
    ).rejects.toThrow('not found');
    await expect(
      resolveChannelTarget(
        'twitch/streamer',
        moment,
        undefined,
        queue({ data: { user: { login: 'other' } } }),
      ),
    ).rejects.toThrow('different channel');
  });
  it('stops repeated cursors and bounds a long history', async () => {
    const future = { ...video, createdAt: '2027-01-01T00:00:00Z' };
    const repeated = queue(page([future], 'same'), page([future], 'same'));
    await expect(
      resolveChannelTarget('twitch/streamer', moment, undefined, repeated),
    ).rejects.toThrow('repeated');
    expect(repeated).toHaveBeenCalledTimes(2);
    const many = queue(...Array.from({ length: 11 }, (_, i) => page([future], `page${i}`)));
    await expect(resolveChannelTarget('twitch/streamer', moment, undefined, many)).rejects.toThrow(
      '300 recent',
    );
    expect(many).toHaveBeenCalledTimes(10);
  });
  it('uses authenticated user lookup and paginated archive filters', async () => {
    const fetcher = queue(
      { data: [{ id: '42', login: 'streamer' }] },
      { data: [], pagination: { cursor: 'next+/=' } },
      {
        data: [
          {
            id: '123',
            user_id: '42',
            user_name: 'Streamer',
            title: 'Recording',
            type: 'archive',
            created_at: start,
            duration: '1h',
          },
        ],
        pagination: {},
      },
    );
    const result = await resolveChannelTarget(
      'twitch/streamer',
      moment,
      { clientId: 'test-client', token: 'test-token' },
      fetcher,
    );
    expect(result.offsetSeconds).toBe(300);
    expect(result.vod.provenance).toBe('twitch-helix');
    const url = new URL(String(fetcher.mock.calls[2][0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      user_id: '42',
      type: 'archive',
      sort: 'time',
      first: '100',
      after: 'next+/=',
    });
    expect(
      fetcher.mock.calls.every(([url]) => String(url).startsWith('https://api.twitch.tv/helix/')),
    ).toBe(true);
  });
  it('never falls back anonymously after an auth failure', async () => {
    const fetcher = queue(new Response('{}', { status: 401 }));
    await expect(
      resolveChannelTarget('twitch/streamer', moment, { clientId: 'test', token: 'test' }, fetcher),
    ).rejects.toThrow('expired');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid inputs before making requests', async () => {
    const fetcher = queue();
    await expect(
      resolveChannelTarget('kick.com.evil.test/streamer', moment, undefined, fetcher),
    ).rejects.toThrow('Use twitch/name');
    await expect(resolveChannelTarget('twitch/streamer', NaN, undefined, fetcher)).rejects.toThrow(
      'Select a broadcast',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('Kick streamer targets', () => {
  it('narrows by broadcast time then confirms and canonicalizes detail metadata', async () => {
    const fetcher = queue(
      [
        {
          video: { uuid: oldId },
          start_time: '2026-09-24 18:00:00',
          duration: 3600000,
          is_live: false,
        },
        {
          video: { uuid: oldId },
          start_time: '2026-09-23 18:00:00',
          duration: 3600000,
          is_live: false,
        },
      ],
      kickVideo,
    );
    const result = await resolveChannelTarget(
      'kick/streamer',
      moment,
      { clientId: 'test', token: 'test' },
      fetcher,
    );
    expect(result).toMatchObject({ vod: { id: newId }, offsetSeconds: 300 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.every(
        ([, options]) => !options?.headers && options?.credentials === 'omit',
      ),
    ).toBe(true);
    expect(
      (await resolveMedia(`kick.com/streamer/videos/${newId}`, undefined, fetcher)).vod.id,
    ).toBe(newId);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('can use an index without timing hints, but never a different owner', async () => {
    const list = [{ video: { uuid: oldId } }];
    expect(
      (await resolveChannelTarget('kick/streamer', moment, undefined, queue(list, kickVideo)))
        .offsetSeconds,
    ).toBe(300);
    await expect(
      resolveChannelTarget(
        'kick/streamer',
        moment,
        undefined,
        queue(list, {
          ...kickVideo,
          livestream: { ...kickVideo.livestream, channel: { slug: 'other' } },
        }),
      ),
    ).rejects.toThrow('No available');
  });
  it('requires detail coverage even when the list claims a match', async () => {
    const fetcher = queue([{ video: { uuid: oldId }, start_time: start, duration: 3600000 }], {
      ...kickVideo,
      livestream: { ...kickVideo.livestream, duration: 300000 },
    });
    await expect(resolveChannelTarget('kick/streamer', moment, undefined, fetcher)).rejects.toThrow(
      'No available',
    );
  });
  it('accepts exact start and rejects exact end, live entries and missing archives', async () => {
    const list = [{ video: { uuid: oldId }, start_time: start, duration: 3600000 }];
    expect(
      (
        await resolveChannelTarget(
          'kick/streamer',
          Date.parse(start),
          undefined,
          queue(list, kickVideo),
        )
      ).offsetSeconds,
    ).toBe(0);
    for (const items of [list, [{ ...list[0], is_live: true }], []]) {
      const fetcher = queue(items);
      await expect(
        resolveChannelTarget('kick/streamer', Date.parse(start) + 3600000, undefined, fetcher),
      ).rejects.toThrow('50 recent');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it.each([401, 403, 429])('stops on restriction status %s', async (status) => {
    const fetcher = queue([{ video: { uuid: oldId } }], new Response('{}', { status }));
    await expect(resolveChannelTarget('kick/streamer', moment, undefined, fetcher)).rejects.toThrow(
      String(status),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects private detail records without inventing a match', async () => {
    await expect(
      resolveChannelTarget(
        'kick/streamer',
        moment,
        undefined,
        queue([{ video: { uuid: oldId } }], { ...kickVideo, status: 'private' }),
      ),
    ).rejects.toThrow('private');
  });
});
