import {
  MAX_VODS,
  matchMoment,
  momentAt,
  parseChannelTarget,
  parseMedia,
  vodKey,
  type Vod,
} from '@vodsync/core';
import { resolveChannelTarget, resolveMedia, type TwitchAuth } from '@vodsync/providers';

type Context = { vods: Vod[]; momentMs: number; leaderKey: string };
type Failure = { input: string; error: string };
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Please retry.');

// Resolve explicit media first, then streamer targets against one captured moment.
// Network completion order must never choose the source or reorder the session.
export async function resolveRecordingInputs(
  inputs: string[],
  context: Context,
  auth?: TwitchAuth,
  providers = { media: resolveMedia, channel: resolveChannelTarget },
) {
  const existing = new Map(
    context.vods.filter((v) => v.provenance !== 'demo').map((v) => [vodKey(v), v]),
  );
  const accepted = new Map<number, Vod>();
  const failures = new Map<number, Failure>();
  const next = new Map(existing);
  let anchor: { vod: Vod; offsetSeconds: number; input: string } | undefined;
  const indexed = inputs.map((input, index) => ({
    input,
    index,
    target: parseChannelTarget(input),
  }));
  let momentMs = context.momentMs;
  let leaderKey = context.leaderKey;
  function accept(index: number, vod: Vod) {
    if (!next.has(vodKey(vod)) && next.size >= MAX_VODS)
      throw new Error('This session is too large.');
    next.set(vodKey(vod), vod);
    accepted.set(index, vod);
  }
  function preserve(vod: Vod) {
    const known = existing.get(vodKey(vod));
    return known
      ? {
          ...vod,
          durationSeconds: known.durationSeconds,
          correctionSeconds: known.correctionSeconds,
        }
      : vod;
  }
  const media = indexed.filter((item) => !item.target);
  for (let i = 0; i < media.length; i += 4) {
    const batch = media.slice(i, i + 4);
    const results = await Promise.allSettled(
      batch.map((item) => providers.media(item.input, auth)),
    );
    results.forEach((result, j) => {
      const { input, index } = batch[j];
      try {
        if (result.status === 'rejected') throw result.reason;
        const vod = preserve(result.value.vod);
        momentAt(vod, result.value.offsetSeconds);
        accept(index, vod);
        anchor ??= { vod, offsetSeconds: result.value.offsetSeconds, input };
      } catch (error) {
        failures.set(index, { input, error: messageOf(error) });
      }
    });
  }
  if (anchor) {
    const ref = parseMedia(anchor.input);
    if (!existing.size || ref.kind === 'clip' || /[?&](t|time)=/.test(anchor.input)) {
      momentMs = momentAt(anchor.vod, anchor.offsetSeconds);
      leaderKey = vodKey(anchor.vod);
    }
  }
  const targets = indexed.filter((item) => item.target);
  for (let i = 0; i < targets.length; i += 4) {
    const batch = targets.slice(i, i + 4);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        if (!existing.size && !anchor)
          throw new Error(
            'Add a VOD or clip first to choose a broadcast moment, or paste one with the streamer targets.',
          );
        return providers.channel(item.input, momentMs, auth);
      }),
    );
    results.forEach((result, j) => {
      const { input, index } = batch[j];
      try {
        if (result.status === 'rejected') throw result.reason;
        const vod = preserve(result.value.vod);
        if (matchMoment(vod, momentMs).state !== 'playing')
          throw new Error(
            'This recording does not cover the selected moment with its saved timing and duration.',
          );
        accept(index, vod);
      } catch (error) {
        failures.set(index, { input, error: messageOf(error) });
      }
    });
  }
  // Keep prior order; new media retain paste order, even when a target precedes the source.
  const ordered = new Map(existing);
  for (const [, vod] of [...accepted].sort(([a], [b]) => a - b)) ordered.set(vodKey(vod), vod);
  return {
    vods: [...ordered.values()],
    momentMs,
    leaderKey,
    added: accepted.size,
    failures: [...failures].sort(([a], [b]) => a - b).map(([, failure]) => failure),
  };
}
