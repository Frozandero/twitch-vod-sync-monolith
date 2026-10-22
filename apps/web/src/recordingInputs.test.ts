import { expect, it, vi } from 'vitest';
import { momentAt, type Span, type Vod, vodKey, vodSpan } from '@vodsync/core';
import { resolveRecordingInputs } from './recordingInputs';
const source: Vod = {
  platform: 'twitch',
  id: '123',
  url: 'https://www.twitch.tv/videos/123',
  title: 'Source',
  channel: 'source',
  startedAt: '2026-09-23T18:00:00Z',
  durationSeconds: 3600,
  correctionSeconds: 0,
  provenance: 'twitch-public',
};
const target: Vod = {
  ...source,
  id: '456',
  url: 'https://www.twitch.tv/videos/456',
  channel: 'target',
  startedAt: '2026-09-23T18:02:00Z',
};
const context = { vods: [source], leaderKey: vodKey(source), momentMs: momentAt(source, 600) };
const empty = { vods: [], leaderKey: '', momentMs: 0 };
function providers() {
  return {
    media: vi.fn(async () => ({ vod: source, offsetSeconds: 600 })),
    channel: vi.fn(async (_input: string, _spans: Span[]): Promise<Vod[]> => [target]),
  };
}
it('adds targets overlapping the session and retains the source and moment', async () => {
  const resolvers = providers();
  const result = await resolveRecordingInputs(['twitch/target'], context, undefined, resolvers);
  expect(result.vods).toEqual([source, target]);
  expect(result.momentMs).toBe(context.momentMs);
  expect(result.leaderKey).toBe(context.leaderKey);
  expect(resolvers.channel).toHaveBeenCalledWith('twitch/target', [vodSpan(source)], undefined);
  expect(result.results).toEqual([
    {
      input: 'twitch/target',
      status: 'added',
      kind: 'channel',
      vod: target,
      offsetSeconds: 480,
      state: 'playing',
    },
  ]);
  expect(resolvers.media).not.toHaveBeenCalled();
});
it('adds every overlapping recording of a streamer in broadcast order', async () => {
  const resolvers = providers();
  const later: Vod = {
    ...target,
    id: '789',
    url: 'https://www.twitch.tv/videos/789',
    startedAt: '2026-09-23T18:30:00Z',
  };
  resolvers.channel.mockResolvedValueOnce([later, target]);
  const result = await resolveRecordingInputs(['twitch/target'], context, undefined, resolvers);
  expect(result.vods).toEqual([source, target, later]);
  expect(result.added).toBe(1);
  expect(result.momentMs).toBe(context.momentMs);
  expect(
    result.results.map((item) => item.status === 'added' && [item.vod.id, item.state]),
  ).toEqual([
    ['456', 'playing'],
    ['789', 'before'],
  ]);
});
it('adds overlapping recordings even when none covers the selected moment', async () => {
  const resolvers = providers();
  const late = { ...target, startedAt: '2026-09-23T18:40:00Z' };
  resolvers.channel.mockResolvedValueOnce([late]);
  const result = await resolveRecordingInputs(['twitch/target'], context, undefined, resolvers);
  expect(result.vods).toEqual([source, late]);
  expect(result.results[0]).toMatchObject({ status: 'added', state: 'before', offsetSeconds: 0 });
  expect(result.failures).toEqual([]);
});
it('rejects provider recordings that do not overlap the session', async () => {
  const resolvers = providers();
  resolvers.channel.mockResolvedValueOnce([{ ...target, startedAt: '2026-09-23T19:00:00Z' }]);
  const result = await resolveRecordingInputs(['twitch/target'], context, undefined, resolvers);
  expect(result.vods).toEqual([source]);
  expect(result.failures[0].error).toContain('overlaps the session');
});
it('requires a real source for channel-only input in an empty workspace', async () => {
  const resolvers = providers();
  const result = await resolveRecordingInputs(
    ['twitch/target', 'kick/target'],
    empty,
    undefined,
    resolvers,
  );
  expect(result.added).toBe(0);
  expect(result.failures).toHaveLength(2);
  expect(result.failures[0].error).toContain('Add a VOD or clip first');
  expect(resolvers.channel).not.toHaveBeenCalled();
});
it('supports a source in the same batch even when a target is pasted first', async () => {
  const resolvers = providers();
  const result = await resolveRecordingInputs(
    ['twitch/target', 'twitch.tv/videos/123?t=10m'],
    empty,
    undefined,
    resolvers,
  );
  expect(result.vods).toEqual([target, source]);
  expect(result.momentMs).toBe(context.momentMs);
  expect(result.leaderKey).toBe(vodKey(source));
  expect(result.failures).toEqual([]);
});
it('preserves first-explicit-media semantics with two timestamped VODs', async () => {
  const resolvers = providers();
  resolvers.media
    .mockResolvedValueOnce({ vod: source, offsetSeconds: 600 })
    .mockResolvedValueOnce({ vod: target, offsetSeconds: 900 });
  const result = await resolveRecordingInputs(
    ['twitch.tv/videos/123?t=10m', 'twitch.tv/videos/456?t=15m', 'twitch/target'],
    context,
    undefined,
    resolvers,
  );
  expect(result.momentMs).toBe(context.momentMs);
});
it('uses a newly pasted clip moment for every streamer in the batch', async () => {
  const resolvers = providers();
  resolvers.media.mockResolvedValue({ vod: source, offsetSeconds: 900 });
  const result = await resolveRecordingInputs(
    ['twitch/target', 'https://clips.twitch.tv/Example', 'kick/target'],
    context,
    undefined,
    resolvers,
  );
  expect(result.momentMs).toBe(momentAt(source, 900));
  expect(resolvers.channel.mock.calls.map((call) => call[1])).toEqual([
    [vodSpan(source)],
    [vodSpan(source)],
  ]);
  expect(
    result.results.filter((item) => item.status !== 'failed' && item.kind === 'channel'),
  ).toEqual([
    expect.objectContaining({ input: 'twitch/target', offsetSeconds: 780 }),
    expect.objectContaining({ input: 'kick/target', status: 'existing', offsetSeconds: 780 }),
  ]);
  expect(result.vods).toHaveLength(2);
});
it('keeps successful additions and reports failed targets in input order', async () => {
  const resolvers = providers();
  resolvers.channel
    .mockRejectedValueOnce(new Error('No matching VOD'))
    .mockResolvedValueOnce([target]);
  const result = await resolveRecordingInputs(
    ['kick/missing', 'twitch/target'],
    context,
    undefined,
    resolvers,
  );
  expect(result.vods).toEqual([source, target]);
  expect(result.failures).toEqual([{ input: 'kick/missing', error: 'No matching VOD' }]);
});
it('deduplicates an existing VOD and preserves its correction and loaded duration', async () => {
  const resolvers = providers();
  const known = { ...target, correctionSeconds: 10, durationSeconds: 3500 };
  const result = await resolveRecordingInputs(
    ['twitch/target'],
    { ...context, vods: [source, known] },
    undefined,
    resolvers,
  );
  expect(result.vods).toEqual([source, known]);
  expect(result.momentMs).toBe(context.momentMs);
});
it('does not label a saved corrected or shortened boundary as matching', async () => {
  const known = { ...target, durationSeconds: 480 };
  const result = await resolveRecordingInputs(
    ['twitch/target'],
    { ...context, vods: [source, known] },
    undefined,
    providers(),
  );
  expect(result.vods).toEqual([source, known]);
  expect(result.results[0]).toMatchObject({ status: 'existing', state: 'ended' });
});
it('reports one outcome per input and records clip markers in the parent VOD', async () => {
  const resolvers = providers();
  resolvers.media.mockResolvedValue({ vod: target, offsetSeconds: 900 });
  resolvers.channel.mockRejectedValueOnce(new Error('No matching VOD'));
  const result = await resolveRecordingInputs(
    ['https://clips.twitch.tv/Example', 'twitch.tv/videos/123', 'kick/missing'],
    context,
    undefined,
    resolvers,
  );
  expect(result.results.map((item) => item.status)).toEqual(['added', 'existing', 'failed']);
  expect(result.results[0]).toMatchObject({ kind: 'clip', offsetSeconds: 900 });
  expect(result.clips).toEqual([
    {
      platform: 'twitch',
      id: 'Example',
      url: 'https://clips.twitch.tv/Example',
      vodKey: vodKey(target),
      offsetSeconds: 900,
    },
  ]);
});
