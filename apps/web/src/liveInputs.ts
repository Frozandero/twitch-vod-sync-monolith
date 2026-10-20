import { MAX_VODS, liveKey, parseChannelTarget, parseMedia, type LiveChannel } from '@vodsync/core';
import { resolveLiveChannel, type TwitchAuth } from '@vodsync/providers';

export type LiveInputResult =
  | { input: string; status: 'added' | 'existing'; channel: LiveChannel; live: boolean }
  | { input: string; status: 'failed'; error: string };
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Please retry.');

// Channel inputs open live streams only when nothing else gives them a moment: in an empty
// workspace (where at least one must be live now) or inside a live session (where offline
// channels wait for their stream). VODs and clips never join a live session.
export function opensLive(inputs: string[], recordings: number, liveChannels: number) {
  if (liveChannels) return true;
  return !recordings && inputs.length > 0 && inputs.every((input) => parseChannelTarget(input));
}

export async function resolveLiveInputs(
  inputs: string[],
  current: LiveChannel[],
  auth?: TwitchAuth,
  lookup = resolveLiveChannel,
) {
  const starting = !current.length;
  const next = new Map(current.map((channel) => [liveKey(channel), channel]));
  const outcomes: LiveInputResult[] = [];
  const found: { index: number; channel: LiveChannel; live: boolean }[] = [];
  const channels = inputs.flatMap((input, index) => {
    if (parseChannelTarget(input)) return [{ input, index }];
    let media = false;
    try {
      parseMedia(input);
      media = true;
    } catch {
      /* Neither a channel nor a recording. */
    }
    outcomes[index] = {
      input,
      status: 'failed',
      error: media
        ? 'Live sessions take channels only. Close the live channels to sync VODs or clips.'
        : 'Use twitch/name, kick/name, or a channel URL.',
    };
    return [];
  });
  for (let i = 0; i < channels.length; i += 4) {
    const batch = channels.slice(i, i + 4);
    const results = await Promise.allSettled(batch.map((item) => lookup(item.input, auth)));
    results.forEach((result, j) => {
      const { input, index } = batch[j];
      if (result.status === 'rejected')
        outcomes[index] = { input, status: 'failed', error: messageOf(result.reason) };
      else found.push({ index, ...result.value });
    });
  }
  // A new live session needs something to watch now; otherwise these are past-broadcast
  // targets that need a VOD or clip to set their moment.
  const anyLive = found.some((item) => item.live);
  for (const { index, channel, live } of found.sort((a, b) => a.index - b.index)) {
    const input = inputs[index];
    if (starting && !anyLive) {
      outcomes[index] = {
        input,
        status: 'failed',
        error: `${channel.name} isn’t live right now. To find a past broadcast, add a VOD or clip first, or paste one with the channel.`,
      };
      continue;
    }
    const known = next.has(liveKey(channel));
    if (!known && next.size >= MAX_VODS) {
      outcomes[index] = { input, status: 'failed', error: 'This session is too large.' };
      continue;
    }
    if (!known) next.set(liveKey(channel), channel);
    outcomes[index] = { input, status: known ? 'existing' : 'added', channel, live };
  }
  const results = outcomes.filter(Boolean);
  return {
    channels: [...next.values()],
    added: results.filter((result) => result.status === 'added').length,
    results,
    failures: results.filter((result) => result.status === 'failed'),
  };
}
