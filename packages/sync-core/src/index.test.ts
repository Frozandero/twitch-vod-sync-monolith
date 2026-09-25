import { describe, expect, it } from 'vitest';
import {
  decodeSession,
  encodeSession,
  formatTime,
  formatGap,
  matchDescription,
  timelineBounds,
  matchMoment,
  momentAt,
  parseMedia,
  parseTime,
  validateSession,
  validateVod,
  type Session,
  type Vod,
} from './index';
const vod: Vod = {
  platform: 'twitch',
  id: '123',
  url: 'https://www.twitch.tv/videos/123',
  title: 'Café 日本語',
  channel: 'Example',
  startedAt: '2026-09-25T18:00:00Z',
  durationSeconds: 7200,
  correctionSeconds: 0,
  provenance: 'manual',
};
const session: Session = {
  version: 2,
  vods: [vod],
  leaderKey: 'twitch:123',
  momentMs: Date.parse(vod.startedAt) + 75000,
  view: 'links',
};
describe('timestamps', () => {
  it.each([
    ['1:23:45', 5025],
    ['23:45', 1425],
    ['1h23m45s', 5025],
    ['90m', 5400],
    ['1.5', 1.5],
    ['', 0],
    ['0s', 0],
  ])('parses %s', (input, result) => expect(parseTime(input)).toBe(result));
  it.each(['-1', '1:99', '1:2', 'NaN', '1hnope', '1e5', '31536001'])('rejects %s', (input) =>
    expect(() => parseTime(input)).toThrow(),
  );
  it('formats durations beyond 24 hours', () => expect(formatTime(90061)).toBe('25:01:01'));
});
describe('input URLs', () => {
  it.each([
    '123',
    'v123',
    'twitch.tv/videos/123',
    'https://m.twitch.tv/videos/123',
    'https://www.twitch.tv/name/video/123',
  ])('accepts %s', (input) => expect(parseMedia(input).id).toBe('123'));
  it('parses VOD timestamp', () =>
    expect(parseMedia('https://twitch.tv/videos/123?t=1h2m3s').offsetSeconds).toBe(3723));
  it.each(['https://clips.twitch.tv/Slug-123', 'https://www.twitch.tv/name/clip/Slug-123'])(
    'parses a clip',
    (input) => expect(parseMedia(input).kind).toBe('clip'),
  );
  it('accepts Kick current and legacy links', () => {
    for (const path of ['name/videos', 'video', 'videos'])
      expect(
        parseMedia(`https://kick.com/${path}/a74f8e34-c35c-4a6e-8520-710cbea58173?t=120`)
          .offsetSeconds,
      ).toBe(120);
  });
  it.each([
    'https://twitch.tv.evil.com/videos/123',
    'https://evil.com/?url=twitch.tv/videos/123',
    'https://twitch.tv@evil.com/videos/123',
    'javascript:alert(1)',
    'https://twitch.tv/channel',
    'https://kick.com/name?clip=clip_123',
    'https://twitch.tv:3000/videos/123',
    'https://me:secret@twitch.tv/videos/123',
  ])('rejects unsupported / unsafe URLs', (input) => expect(() => parseMedia(input)).toThrow());
});
describe('wall-clock synchronization', () => {
  const target = {
    ...vod,
    id: '456',
    url: 'https://www.twitch.tv/videos/456',
    startedAt: '2026-09-25T18:20:00Z',
    durationSeconds: 1800,
  };
  it('aligns offsets across broadcasts', () => {
    const result = matchMoment(target, momentAt(vod, 1500));
    expect(result).toMatchObject({
      state: 'playing',
      offsetSeconds: 300,
      url: 'https://www.twitch.tv/videos/456?t=0h5m0s',
    });
  });
  it('clamps before start', () =>
    expect(matchMoment(target, momentAt(vod, 0))).toMatchObject({
      state: 'before',
      offsetSeconds: 0,
      gapSeconds: 1200,
    }));
  it('treats exact start as playable', () =>
    expect(matchMoment(target, momentAt(vod, 1200)).state).toBe('playing'));
  it('treats exact end as ended', () =>
    expect(matchMoment(target, momentAt(vod, 3000))).toMatchObject({
      state: 'ended',
      offsetSeconds: 1800,
      gapSeconds: 0,
    }));
  it('handles no overlap on different days', () =>
    expect(
      matchMoment({ ...target, startedAt: '2026-09-24T18:20:00Z' }, momentAt(vod, 0)).state,
    ).toBe('ended'));
  it('uses timezone offsets', () =>
    expect(momentAt({ ...vod, startedAt: '2026-09-25T21:00:00+03:00' }, 0)).toBe(momentAt(vod, 0)));
  it('applies signed correction', () =>
    expect(
      matchMoment({ ...target, correctionSeconds: 15 }, momentAt(vod, 1500)).offsetSeconds,
    ).toBe(285));
  it('rejects invalid source positions', () => {
    for (const position of [-1, 7200, Infinity, NaN])
      expect(() => momentAt(vod, position)).toThrow();
  });
  it('preserves subsecond matching but rounds links down', () =>
    expect(matchMoment(target, momentAt(vod, 1200.9))).toMatchObject({
      offsetSeconds: 0.9,
      url: 'https://www.twitch.tv/videos/456?t=0h0m0s',
    }));
  it('creates Kick second-based links', () => {
    const kick = {
      ...vod,
      platform: 'kick' as const,
      url: 'https://kick.com/video/a74f8e34-c35c-4a6e-8520-710cbea58173',
    };
    expect(matchMoment(kick, momentAt(vod, 123)).url).toContain('?t=123');
  });
});
describe('untrusted saved sessions', () => {
  it('round-trips unicode metadata', () =>
    expect(decodeSession(encodeSession(session))).toEqual(validateSession(session)));
  it('strips extra fields, including credentials', () => {
    expect(
      JSON.stringify(
        validateSession({
          ...session,
          token: 'never-share',
          vods: [{ ...vod, access_token: 'never-share' }],
        }),
      ),
    ).not.toContain('never-share');
  });
  it('rejects unknown versions and duplicate entries', () => {
    expect(() => validateSession({ ...session, version: 3 })).toThrow();
    expect(() => validateSession({ ...session, vods: [vod, vod] })).toThrow();
  });
  it('requires explicit timezone, positive duration and valid URL identity', () => {
    for (const override of [
      { startedAt: '2026-09-25T18:00:00' },
      { durationSeconds: 0 },
      { id: '456' },
      { url: 'https://evil.com' },
      { correctionSeconds: NaN },
    ])
      expect(() => validateVod({ ...vod, ...override })).toThrow();
  });
  it('rejects malformed, oversized and prototype-shaped shares', () => {
    for (const input of ['bad', 'a'.repeat(60001), btoa('{"__proto__":{"version":1}}')])
      expect(() => decodeSession(input)).toThrow();
  });
  it('migrates existing v1 workspaces without losing recordings or time', () => {
    const migrated = validateSession({
      version: 1,
      vods: [vod],
      sourceKey: 'twitch:123',
      offsetSeconds: 75,
      view: 'links',
    });
    expect(migrated).toEqual(validateSession(session));
  });
  it('rejects share URLs too large to decode and suggests JSON export', () => {
    const vods = Array.from({ length: 100 }, (_, i) => ({
      ...vod,
      id: String(i + 123),
      url: `https://www.twitch.tv/videos/${i + 123}`,
      title: 'x'.repeat(300),
      channel: 'x'.repeat(100),
    }));
    expect(() => encodeSession({ ...session, vods })).toThrow('Export it as JSON');
  });
  it('allows a selected moment in the gap between recordings', () => {
    const later = {
      ...vod,
      id: '456',
      url: 'https://www.twitch.tv/videos/456',
      startedAt: '2026-09-25T22:00:00Z',
    };
    const gap = validateSession({
      ...session,
      vods: [vod, later],
      momentMs: Date.parse('2026-09-25T21:00:00Z'),
    });
    expect(gap.vods.map((v) => matchMoment(v, gap.momentMs).state)).toEqual(['ended', 'before']);
    expect(timelineBounds(gap.vods)).toEqual({
      min: Date.parse(vod.startedAt),
      max: Date.parse('2026-09-26T00:00:00Z'),
    });
  });
  it('rejects non-finite or out-of-timeline moments', () => {
    for (const momentMs of [NaN, Infinity, 0])
      expect(() => validateSession({ ...session, momentMs })).toThrow();
  });
  it('states exact before/after gaps for every recording', () => {
    expect(formatGap(7384)).toBe('2h 3m 4s');
    expect(matchDescription(matchMoment(vod, Date.parse(vod.startedAt) - 7384000))).toBe(
      'No match — starts 2h 3m 4s after this moment',
    );
    expect(matchDescription(matchMoment(vod, Date.parse(vod.startedAt) + 7200000 + 7384000))).toBe(
      'No match — ended 2h 3m 4s before this moment',
    );
  });
});
