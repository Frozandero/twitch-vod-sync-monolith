import { describe, expect, it, vi } from 'vitest';
import { resolveLiveChannel } from './index';

function fetchQueue(...bodies: Array<{ status?: number; body: unknown }>) {
  return vi.fn(async () => {
    const next = bodies.shift()!;
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });
}
const auth = { clientId: 'client', token: 'token' };

describe('live channel lookup', () => {
  it('reads Twitch public live status and display name', async () => {
    const fetcher = fetchQueue({
      body: {
        data: {
          user: { login: 'summit1g', displayName: 'Summit1G', stream: { id: '9', type: 'live' } },
        },
      },
    });
    expect(await resolveLiveChannel('twitch/Summit1G', undefined, fetcher)).toEqual({
      channel: { platform: 'twitch', channel: 'summit1g', name: 'Summit1G' },
      live: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('returns offline Twitch channels instead of failing', async () => {
    const fetcher = fetchQueue({
      body: { data: { user: { login: 'hasanabi', displayName: 'HasanAbi', stream: null } } },
    });
    expect(
      (await resolveLiveChannel('https://www.twitch.tv/hasanabi', undefined, fetcher)).live,
    ).toBe(false);
  });
  it('rejects missing or mismatched Twitch channels', async () => {
    await expect(
      resolveLiveChannel(
        'twitch/nobody',
        undefined,
        fetchQueue({ body: { data: { user: null } } }),
      ),
    ).rejects.toThrow('not found');
    await expect(
      resolveLiveChannel(
        'twitch/a',
        undefined,
        fetchQueue({ body: { data: { user: { login: 'b', displayName: 'B', stream: null } } } }),
      ),
    ).rejects.toThrow('different channel');
  });
  it('uses Helix users and streams when connected', async () => {
    const fetcher = fetchQueue(
      { body: { data: [{ id: '1', login: 'xqc', display_name: 'xQc' }] } },
      { body: { data: [{ type: 'live', user_login: 'xqc' }] } },
    );
    expect(await resolveLiveChannel('twitch/xqc', auth, fetcher)).toEqual({
      channel: { platform: 'twitch', channel: 'xqc', name: 'xQc' },
      live: true,
    });
    const urls = fetcher.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(urls[0]).toContain('helix/users?login=xqc');
    expect(urls[1]).toContain('helix/streams?user_login=xqc');
  });
  it('reads Kick live status without touching the playback URL', async () => {
    const body = {
      slug: 'xqc',
      user: { username: 'xQc' },
      livestream: { is_live: true },
      playback_url: 'https://example.playback.live-video.net/channel.m3u8?token=secret',
    };
    const result = await resolveLiveChannel('kick/xqc', undefined, fetchQueue({ body }));
    expect(result).toEqual({
      channel: { platform: 'kick', channel: 'xqc', name: 'xQc' },
      live: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/token|m3u8/);
  });
  it('treats Kick channels without a live stream as offline and rejects others', async () => {
    expect(
      (
        await resolveLiveChannel(
          'https://kick.com/roshtein',
          undefined,
          fetchQueue({
            body: { slug: 'roshtein', user: { username: 'Roshtein' }, livestream: null },
          }),
        )
      ).live,
    ).toBe(false);
    await expect(
      resolveLiveChannel('kick/a', undefined, fetchQueue({ body: { slug: 'b' } })),
    ).rejects.toThrow('different channel');
    await expect(
      resolveLiveChannel('kick/gone', undefined, fetchQueue({ status: 404, body: {} })),
    ).rejects.toThrow('Kick channel gone was not found.');
  });
  it('rejects inputs that are not channels', async () => {
    await expect(
      resolveLiveChannel('https://www.twitch.tv/videos/123', undefined, fetchQueue()),
    ).rejects.toThrow('live channel');
  });
});
