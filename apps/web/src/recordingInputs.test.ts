import { expect, it, vi } from 'vitest';
import { momentAt, type Vod, vodKey } from '@vodsync/core';
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
    channel: vi.fn(async (_input: string, _moment: number) => ({
      vod: target,
      offsetSeconds: 480,
    })),
  };
}
it('adds targets at the captured seeker moment and retains the source', async () => {
  const resolvers = providers();
  const result = await resolveRecordingInputs(['twitch/target'], context, undefined, resolvers);
  expect(result.vods).toEqual([source, target]);
  expect(result.momentMs).toBe(context.momentMs);
  expect(result.leaderKey).toBe(context.leaderKey);
  expect(resolvers.channel).toHaveBeenCalledWith('twitch/target', context.momentMs, undefined);
  expect(resolvers.media).not.toHaveBeenCalled();
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
    momentAt(source, 900),
    momentAt(source, 900),
  ]);
  expect(result.vods).toHaveLength(2);
});
it('keeps successful additions and reports failed targets in input order', async () => {
  const resolvers = providers();
  resolvers.channel
    .mockRejectedValueOnce(new Error('No matching VOD'))
    .mockResolvedValueOnce({ vod: target, offsetSeconds: 480 });
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
  expect(result.added).toBe(0);
  expect(result.vods).toEqual([source, known]);
  expect(result.failures[0].error).toContain('saved timing and duration');
});
