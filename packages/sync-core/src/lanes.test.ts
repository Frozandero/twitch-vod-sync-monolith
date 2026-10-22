import { describe, expect, it } from 'vitest';
import { groupLanes, laneKey, laneVod, laneVods, overlaps, vodSpan, type Vod } from './index';

const kick = (id: string, startedAt: string, durationSeconds: number, slug = 'aikobliss'): Vod => ({
  platform: 'kick',
  id,
  url: `https://kick.com/${slug}/videos/${id}`,
  title: 'Recording',
  channel: slug === 'aikobliss' ? 'AikoBliss' : slug,
  startedAt,
  durationSeconds,
  correctionSeconds: 0,
  provenance: 'kick-public',
});
const first = kick('01a15fd9-c248-758c-a777-1633953c6808', '2026-10-21T19:04:29Z', 7200);
const second = kick('bfedf6ec-e389-4a13-a323-165bc21986b7', '2026-10-21T21:07:36Z', 3600);
const xqc: Vod = {
  platform: 'twitch',
  id: '2907037919',
  url: 'https://www.twitch.tv/videos/2907037919',
  title: 'Recording',
  channel: 'xQc',
  startedAt: '2026-10-21T19:56:15Z',
  durationSeconds: 42906,
  correctionSeconds: 0,
  provenance: 'twitch-public',
};
const at = (iso: string) => Date.parse(iso);

describe('lanes', () => {
  it('groups a channel’s recordings in first-appearance order, sorted by start', () => {
    const lanes = groupLanes([second, xqc, first]);
    expect(lanes.map((lane) => lane.key)).toEqual(['kick:aikobliss', 'twitch:xqc']);
    expect(lanes[0].vods).toEqual([first, second]);
    expect(laneKey({ ...xqc, channel: ' XQC ' })).toBe('twitch:xqc');
  });
  it('keys Kick lanes by slug and never merges platforms or different channels', () => {
    expect(laneKey({ ...first, channel: 'Renamed' })).toBe('kick:aikobliss');
    const other = kick('3f425916-5ab2-4e22-a4ef-6c58e5584285', '2026-10-21T19:00:00Z', 60, 'other');
    expect(groupLanes([first, other, { ...xqc, channel: 'aikobliss' }])).toHaveLength(3);
  });
  it('shows the covering recording, the next one in a gap, and the last after the end', () => {
    const [lane] = groupLanes([first, second]);
    expect(laneVod(lane, at('2026-10-21T19:04:29Z'))).toBe(first);
    expect(laneVod(lane, at('2026-10-21T18:00:00Z'))).toBe(first);
    // Half-open: the exact end of the first recording is already the gap.
    expect(laneVod(lane, at('2026-10-21T21:04:29Z'))).toBe(second);
    expect(laneVod(lane, at('2026-10-21T21:07:36Z'))).toBe(second);
    expect(laneVod(lane, at('2026-10-22T00:00:00Z'))).toBe(second);
  });
  it('prefers the earlier of two overlapping recordings in one lane', () => {
    const late = { ...second, startedAt: '2026-10-21T21:00:00Z' };
    const [lane] = groupLanes([late, first]);
    expect(laneVod(lane, at('2026-10-21T21:02:00Z'))).toBe(first);
    expect(laneVods([late, xqc, first], at('2026-10-21T21:02:00Z'))).toEqual([first, xqc]);
  });
  it('treats touching recordings as not overlapping', () => {
    expect(overlaps(second, vodSpan(xqc))).toBe(true);
    expect(
      overlaps(first, { min: at('2026-10-21T21:04:29Z'), max: at('2026-10-21T22:00:00Z') }),
    ).toBe(false);
    expect(
      overlaps(first, { min: at('2026-10-21T18:00:00Z'), max: at('2026-10-21T19:04:29Z') }),
    ).toBe(false);
  });
});
