import { describe, expect, it, vi } from 'vitest';
import type { LiveChannel } from '@vodsync/core';
import { opensLive, resolveLiveInputs } from './liveInputs';

const status: Record<string, boolean> = { summit1g: true, xqc: true, hasanabi: false };
const lookup = vi.fn(async (input: string) => {
  const [platform, channel] = input.split('/') as ['twitch' | 'kick', string];
  if (channel === 'missing') throw new Error('Twitch channel missing was not found.');
  return { channel: { platform, channel, name: channel.toUpperCase() }, live: !!status[channel] };
});
const summit: LiveChannel = { platform: 'twitch', channel: 'summit1g', name: 'summit1g' };

describe('live input routing', () => {
  it('opens live only from an empty workspace of channels, or inside a live session', () => {
    expect(opensLive(['twitch/a', 'kick/b'], 0, 0)).toBe(true);
    expect(opensLive(['twitch/a', 'https://www.twitch.tv/videos/1'], 0, 0)).toBe(false);
    expect(opensLive(['twitch/a'], 2, 0)).toBe(false);
    expect(opensLive(['https://www.twitch.tv/videos/1'], 0, 1)).toBe(true);
    expect(opensLive([], 0, 0)).toBe(false);
    // A typo fails on its own row instead of sending the channels to the recording flow.
    expect(opensLive(['twitch/a', 'nonsense!'], 0, 0)).toBe(true);
    expect(opensLive(['nonsense!'], 0, 0)).toBe(false);
  });
  it('starts a session when one channel is live and lets offline ones wait', async () => {
    const result = await resolveLiveInputs(
      ['twitch/hasanabi', 'twitch/summit1g'],
      [],
      undefined,
      lookup,
    );
    expect(result.channels.map((c) => c.channel)).toEqual(['hasanabi', 'summit1g']);
    expect(result.results.map((r) => r.status)).toEqual(['added', 'added']);
    expect(result.results[0]).toMatchObject({ live: false });
  });
  it('refuses to start a session where nobody is live', async () => {
    const result = await resolveLiveInputs(['twitch/hasanabi'], [], undefined, lookup);
    expect(result.added).toBe(0);
    expect(result.failures[0]).toMatchObject({ status: 'failed' });
    expect(result.failures[0].status === 'failed' && result.failures[0].error).toMatch(
      /isn’t live right now/,
    );
  });
  it('adds offline channels to an existing live session', async () => {
    const result = await resolveLiveInputs(['twitch/hasanabi'], [summit], undefined, lookup);
    expect(result.channels.map((c) => c.channel)).toEqual(['summit1g', 'hasanabi']);
    expect(result.added).toBe(1);
  });
  it('keeps VODs, clips and duplicates out of a live session', async () => {
    const result = await resolveLiveInputs(
      ['https://www.twitch.tv/videos/123', 'twitch/summit1g', 'nonsense!', 'twitch/missing'],
      [summit],
      undefined,
      lookup,
    );
    expect(result.channels).toEqual([summit]);
    expect(result.results.map((r) => r.status)).toEqual(['failed', 'existing', 'failed', 'failed']);
    const errors = result.failures.map((r) => (r.status === 'failed' ? r.error : ''));
    expect(errors[0]).toMatch(/channels only/);
    expect(errors[1]).toMatch(/twitch\/name/);
    expect(errors[2]).toMatch(/not found/);
  });
});
