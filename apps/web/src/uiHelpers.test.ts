import { describe, expect, it } from 'vitest';
import { momentAt, vodKey, type Session, type Vod } from '@vodsync/core';
import { dayLabel, formatDelta, formatSpan } from './timeFormat';
import { overlapRange, rulerTicks, viewRange } from './timelineScale';
import { driftSeconds, syncSummary } from './syncSummary';
import { readRecent, rememberSession } from './recentSessions';

const a: Vod = {
  platform: 'twitch',
  id: '1',
  url: 'https://www.twitch.tv/videos/1',
  title: 'A',
  channel: 'a',
  startedAt: '2026-10-18T18:00:00Z',
  durationSeconds: 7200,
  correctionSeconds: 0,
  provenance: 'twitch-public',
};
const b: Vod = {
  ...a,
  id: '2',
  url: 'https://www.twitch.tv/videos/2',
  channel: 'b',
  startedAt: '2026-10-18T19:00:00Z',
};
const session = (vods: Vod[]): Session => ({
  version: 2,
  vods,
  leaderKey: vodKey(vods[0]),
  momentMs: momentAt(vods[0], 4000),
  view: 'grid',
  clips: [],
});

describe('time labels', () => {
  it('formats drift with a sign and one decimal under a minute', () => {
    expect(formatDelta(3.24)).toBe('+3.2 s');
    expect(formatDelta(-0.2)).toBe('−0.2 s');
    expect(formatDelta(0.01)).toBe('0.0 s');
    expect(formatDelta(-65)).toBe('−1:05');
  });
  it('formats spans and UTC day labels', () => {
    expect(formatSpan(7 * 3600000 + 19 * 60000)).toBe('7h 19m');
    expect(formatSpan(42 * 60000)).toBe('42m');
    expect(dayLabel(Date.parse('2026-10-18T23:30:00Z'), false)).toBe('Sun 18 Oct 2026');
  });
});

describe('timeline scale', () => {
  it('finds the span every recording covers', () => {
    expect(overlapRange([a, b])).toEqual({
      min: Date.parse(b.startedAt),
      max: Date.parse('2026-10-18T20:00:00Z'),
    });
    expect(overlapRange([a])).toBeUndefined();
    const late = {
      ...b,
      id: '3',
      url: 'https://www.twitch.tv/videos/3',
      startedAt: '2026-10-19T00:00:00Z',
    };
    expect(overlapRange([a, late])).toBeUndefined();
    expect(viewRange([a, late], 'overlap').min).toBe(Date.parse(a.startedAt));
  });
  it('places round ruler ticks inside the range', () => {
    const range = {
      min: Date.parse('2026-10-18T18:07:00Z'),
      max: Date.parse('2026-10-18T21:00:00Z'),
    };
    const ticks = rulerTicks(range).map((t) => new Date(t).toISOString().slice(11, 16));
    expect(ticks).toEqual(['18:30', '19:00', '19:30', '20:00', '20:30', '21:00']);
  });
});

describe('sync summary', () => {
  it('separates verified, drifting and unverified players', () => {
    const moment = momentAt(b, 600);
    const states = {
      [vodKey(a)]: { status: 'ready' as const, seconds: 4200, paused: false },
      [vodKey(b)]: { status: 'ready' as const, seconds: 603.5, paused: false },
    };
    expect(driftSeconds(b, moment, states[vodKey(b)])).toBeCloseTo(3.5);
    expect(syncSummary([a, b], moment, states, vodKey(a))).toMatchObject({
      inSync: 1,
      unverified: 0,
      drifting: [{ vod: b }],
    });
    expect(syncSummary([a, b], moment, {}, vodKey(a)).unverified).toBe(2);
  });
});

describe('recent sessions', () => {
  it('replaces an earlier, smaller state of the same session', () => {
    const first = rememberSession([], session([a]), 1);
    const grown = rememberSession(first, session([a, b]), 2);
    expect(grown.map((r) => ('vods' in r.session ? r.session.vods.length : 0))).toEqual([2]);
    // A smaller session never deletes a larger one that contains it.
    const smaller = rememberSession(grown, session([b]), 3);
    expect(smaller.map((r) => r.savedAt)).toEqual([3, 2]);
    const c = { ...b, id: '3', url: 'https://www.twitch.tv/videos/3' };
    const other = rememberSession(grown, session([c]), 4);
    expect(other.map((r) => r.savedAt)).toEqual([4, 2]);
  });
  it('keeps live sessions apart from recordings and lets them grow', () => {
    const live = (...channels: string[]) => ({
      version: 2 as const,
      kind: 'live' as const,
      channels: channels.map((channel) => ({
        platform: 'twitch' as const,
        channel,
        name: channel,
      })),
    });
    const withVods = rememberSession([], session([a]), 1);
    const first = rememberSession(withVods, live('xqc'), 2);
    const grown = rememberSession(first, live('xqc', 'summit1g'), 3);
    expect(grown.map((r) => r.savedAt)).toEqual([3, 1]);
    expect(readRecent(JSON.stringify(grown)).map((r) => 'kind' in r.session)).toEqual([
      true,
      false,
    ]);
  });
  it('drops entries that no longer validate', () => {
    const raw = JSON.stringify([
      { savedAt: 1, session: session([a]) },
      { savedAt: 2, session: { version: 9 } },
      'bad',
    ]);
    expect(readRecent(raw)).toHaveLength(1);
    expect(readRecent('not json')).toEqual([]);
  });
});
