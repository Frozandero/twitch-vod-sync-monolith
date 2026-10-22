import { describe, expect, it, vi } from 'vitest';
import { resolveChannelTarget, resolveMedia } from './index';
const start = '2026-09-23T18:00:00Z';
const moment = Date.parse(start) + 300000;
// The session's recordings as half-open spans; here a one-second span at a moment.
const at = (ms: number) => [{ min: ms, max: ms + 1000 }];
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
const refused = { errors: [{ message: 'IntegrityCheckFailed' }] };
describe('Twitch streamer targets', () => {
  it('finds an older matching archive through pagination without selecting the newest VOD', async () => {
    const fetcher = queue(
      page([{ ...video, id: '456', createdAt: '2026-09-24T18:00:00Z' }], 'next'),
      page([video]),
    );
    const result = await resolveChannelTarget('twitch/STREAMER', at(moment), undefined, fetcher);
    expect(result.map((vod) => vod.id)).toEqual(['123']);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).variables.after).toBe('next');
    expect(fetcher.mock.calls.every(([, options]) => options?.credentials === 'omit')).toBe(true);
  });
  it('treats spans as half-open on both sides', async () => {
    const begin = Date.parse(start);
    expect(
      await resolveChannelTarget('twitch/streamer', at(begin), undefined, queue(page([video]))),
    ).toHaveLength(1);
    for (const spans of [
      [{ min: begin - 1000, max: begin }],
      [{ min: begin + 3600000, max: begin + 3601000 }],
    ])
      await expect(
        resolveChannelTarget('twitch/streamer', spans, undefined, queue(page([video]))),
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
      resolveChannelTarget('twitch/streamer', at(moment), undefined, queue(page(invalid))),
    ).rejects.toThrow('No available');
  });
  it('returns every archive overlapping any recording, oldest first', async () => {
    const second = { ...video, id: '789', createdAt: '2026-09-23T19:30:00Z' };
    const third = { ...video, id: '999', createdAt: '2026-09-24T12:00:00Z' };
    const newest = { ...video, id: '111', createdAt: '2026-09-25T00:00:00Z' };
    const spans = [
      { min: moment, max: Date.parse('2026-09-23T21:00:00Z') },
      { min: Date.parse('2026-09-24T12:30:00Z'), max: Date.parse('2026-09-24T13:00:00Z') },
    ];
    const result = await resolveChannelTarget(
      'twitch/streamer',
      spans,
      undefined,
      queue(page([newest, third, second, video])),
    );
    expect(result.map((vod) => vod.id)).toEqual(['123', '789', '999']);
  });
  it('stops paging once an archive ended before every recording started', async () => {
    const old = { ...video, id: '456', createdAt: '2026-09-22T18:00:00Z' };
    const fetcher = queue(page([video, old], 'next'));
    const result = await resolveChannelTarget('twitch/streamer', at(moment), undefined, fetcher);
    expect(result.map((vod) => vod.id)).toEqual(['123']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps confirmed matches when a deeper page is refused', async () => {
    const spans = [{ min: Date.parse('2026-09-20T00:00:00Z'), max: moment }];
    const fetcher = queue(page([video], 'next'), refused);
    const result = await resolveChannelTarget('twitch/streamer', spans, undefined, fetcher);
    expect(result.map((vod) => vod.id)).toEqual(['123']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const late = { ...video, createdAt: '2026-09-23T22:00:00Z' };
    await expect(
      resolveChannelTarget(
        'twitch/streamer',
        spans,
        undefined,
        queue(page([late], 'next'), refused),
      ),
    ).rejects.toThrow('unavailable');
  });
  it('rejects a different or missing channel', async () => {
    await expect(
      resolveChannelTarget(
        'twitch/streamer',
        at(moment),
        undefined,
        queue({ data: { user: null } }),
      ),
    ).rejects.toThrow('not found');
    await expect(
      resolveChannelTarget(
        'twitch/streamer',
        at(moment),
        undefined,
        queue({ data: { user: { login: 'other' } } }),
      ),
    ).rejects.toThrow('different channel');
  });
  it('stops repeated cursors and bounds a long history', async () => {
    const future = { ...video, createdAt: '2027-01-01T00:00:00Z' };
    const repeated = queue(page([future], 'same'), page([future], 'same'));
    await expect(
      resolveChannelTarget('twitch/streamer', at(moment), undefined, repeated),
    ).rejects.toThrow('repeated');
    expect(repeated).toHaveBeenCalledTimes(2);
    const many = queue(...Array.from({ length: 11 }, (_, i) => page([future], `page${i}`)));
    await expect(
      resolveChannelTarget('twitch/streamer', at(moment), undefined, many),
    ).rejects.toThrow('300 recent');
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
      at(moment),
      { clientId: 'test-client', token: 'test-token' },
      fetcher,
    );
    expect(result).toMatchObject([
      { id: '123', provenance: 'twitch-helix', durationSeconds: 3600 },
    ]);
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
      resolveChannelTarget(
        'twitch/streamer',
        at(moment),
        { clientId: 'test', token: 'test' },
        fetcher,
      ),
    ).rejects.toThrow('expired');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid inputs before making requests', async () => {
    const fetcher = queue();
    await expect(
      resolveChannelTarget('kick.com.evil.test/streamer', at(moment), undefined, fetcher),
    ).rejects.toThrow('Use twitch/name');
    for (const spans of [[], [{ min: NaN, max: moment }], [{ min: moment, max: moment }]])
      await expect(
        resolveChannelTarget('twitch/streamer', spans, undefined, fetcher),
      ).rejects.toThrow('Add a VOD or clip first');
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
      at(moment),
      { clientId: 'test', token: 'test' },
      fetcher,
    );
    expect(result).toMatchObject([{ id: newId }]);
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
  it('finds both broadcasts that overlap one long recording', async () => {
    // Observed 2026-10-22: aikobliss restarted 62 s after her first Kick VOD ended, and
    // both VODs overlapped xQc's 12-hour Twitch broadcast.
    const secondId = 'bfedf6ec-e389-4a13-a323-165bc21986b7';
    const fetcher = queue(
      [
        { video: { uuid: secondId }, start_time: '2026-09-23 19:01:02', duration: 7200000 },
        { video: { uuid: oldId }, start_time: '2026-09-23 18:00:00', duration: 3600000 },
        { video: { uuid: newId }, start_time: '2026-09-22 18:00:00', duration: 3600000 },
      ],
      kickVideo,
      {
        ...kickVideo,
        uuid: secondId,
        livestream: {
          ...kickVideo.livestream,
          start_time: '2026-09-23 19:01:02',
          duration: 7200000,
          vod_id: undefined,
        },
      },
    );
    const result = await resolveChannelTarget(
      'kick/streamer',
      [{ min: moment, max: Date.parse('2026-09-24T06:00:00Z') }],
      undefined,
      fetcher,
    );
    expect(result.map((vod) => [vod.id, vod.startedAt])).toEqual([
      [newId, '2026-09-23T18:00:00.000Z'],
      [secondId, '2026-09-23T19:01:02.000Z'],
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('can use an index without timing hints, but never a different owner', async () => {
    const list = [{ video: { uuid: oldId } }];
    expect(
      await resolveChannelTarget('kick/streamer', at(moment), undefined, queue(list, kickVideo)),
    ).toHaveLength(1);
    await expect(
      resolveChannelTarget(
        'kick/streamer',
        at(moment),
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
    await expect(
      resolveChannelTarget('kick/streamer', at(moment), undefined, fetcher),
    ).rejects.toThrow('No available');
  });
  it('accepts exact start and rejects exact end, live entries and missing archives', async () => {
    const list = [{ video: { uuid: oldId }, start_time: start, duration: 3600000 }];
    expect(
      await resolveChannelTarget(
        'kick/streamer',
        at(Date.parse(start)),
        undefined,
        queue(list, kickVideo),
      ),
    ).toHaveLength(1);
    for (const items of [list, [{ ...list[0], is_live: true }], []]) {
      const fetcher = queue(items);
      await expect(
        resolveChannelTarget('kick/streamer', at(Date.parse(start) + 3600000), undefined, fetcher),
      ).rejects.toThrow('50 recent');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it.each([401, 403, 429])('stops on restriction status %s', async (status) => {
    const fetcher = queue([{ video: { uuid: oldId } }], new Response('{}', { status }));
    await expect(
      resolveChannelTarget('kick/streamer', at(moment), undefined, fetcher),
    ).rejects.toThrow(String(status));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects private detail records without inventing a match', async () => {
    await expect(
      resolveChannelTarget(
        'kick/streamer',
        at(moment),
        undefined,
        queue([{ video: { uuid: oldId } }], { ...kickVideo, status: 'private' }),
      ),
    ).rejects.toThrow('private');
  });
});
