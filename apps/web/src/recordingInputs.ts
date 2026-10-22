import {
  MAX_VODS,
  matchMoment,
  momentAt,
  overlaps,
  parseChannelTarget,
  parseMedia,
  startMs,
  vodKey,
  vodSpan,
  type ClipMarker,
  type Match,
  type Vod,
} from '@vodsync/core';
import { resolveChannelTarget, resolveMedia, type TwitchAuth } from '@vodsync/providers';

type Context = { vods: Vod[]; momentMs: number; leaderKey: string };
type Failure = { input: string; error: string };
// A streamer target can add several recordings, so it can report several results.
export type InputResult =
  | {
      input: string;
      status: 'added' | 'existing';
      kind: 'vod' | 'clip' | 'channel';
      vod: Vod;
      offsetSeconds: number;
      // Where the selected moment falls in this recording.
      state: Match['state'];
    }
  | { input: string; status: 'failed'; error: string };
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Please retry.');

// Resolve explicit media first, then streamer targets against the recordings that are then in
// the session. Network completion order must never choose the source or reorder the session.
export async function resolveRecordingInputs(
  inputs: string[],
  context: Context,
  auth?: TwitchAuth,
  providers = { media: resolveMedia, channel: resolveChannelTarget },
) {
  const existing = new Map(
    context.vods.filter((v) => v.provenance !== 'demo').map((v) => [vodKey(v), v]),
  );
  const accepted = new Map<number, Vod[]>();
  const failures = new Map<number, Failure>();
  const outcomes = new Map<number, InputResult[]>();
  const clips: ClipMarker[] = [];
  const next = new Map(existing);
  let anchor: { vod: Vod; offsetSeconds: number; input: string } | undefined;
  const indexed = inputs.map((input, index) => ({
    input,
    index,
    target: parseChannelTarget(input),
  }));
  let momentMs = context.momentMs;
  let leaderKey = context.leaderKey;
  function accept(
    index: number,
    vods: Vod[],
    input: string,
    kind: 'vod' | 'clip' | 'channel',
    offsetSeconds?: number,
  ) {
    if (next.size + vods.filter((vod) => !next.has(vodKey(vod))).length > MAX_VODS)
      throw new Error('This session is too large.');
    for (const vod of vods) {
      const status = next.has(vodKey(vod)) ? 'existing' : 'added';
      // Streamer recordings report where the captured moment falls; media name their own.
      const match = offsetSeconds === undefined ? matchMoment(vod, momentMs) : undefined;
      next.set(vodKey(vod), vod);
      accepted.set(index, [...(accepted.get(index) ?? []), vod]);
      outcomes.set(index, [
        ...(outcomes.get(index) ?? []),
        {
          input,
          status,
          kind,
          vod,
          offsetSeconds: offsetSeconds ?? match!.offsetSeconds,
          state: match?.state ?? 'playing',
        },
      ]);
    }
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
        const ref = parseMedia(input);
        accept(index, [vod], input, ref.kind, result.value.offsetSeconds);
        if (ref.kind === 'clip')
          clips.push({
            platform: ref.platform,
            id: ref.id,
            url: ref.url,
            vodKey: vodKey(vod),
            offsetSeconds: result.value.offsetSeconds,
          });
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
  // Targets match the recordings captured here, never each other's additions.
  const spans = [...next.values()].map(vodSpan);
  const targets = indexed.filter((item) => item.target);
  for (let i = 0; i < targets.length; i += 4) {
    const batch = targets.slice(i, i + 4);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        if (!spans.length)
          throw new Error(
            'Add a VOD or clip first to choose the recordings to match, or paste one with the streamer targets.',
          );
        return providers.channel(item.input, spans, auth);
      }),
    );
    results.forEach((result, j) => {
      const { input, index } = batch[j];
      try {
        if (result.status === 'rejected') throw result.reason;
        const vods = result.value
          .map(preserve)
          .filter((vod) => spans.some((span) => overlaps(vod, span)))
          .sort((a, b) => startMs(a) - startMs(b));
        if (!vods.length)
          throw new Error(
            'No recording from this streamer overlaps the session with its saved timing and duration.',
          );
        accept(index, vods, input, 'channel');
      } catch (error) {
        failures.set(index, { input, error: messageOf(error) });
      }
    });
  }
  // Keep prior order; new media retain paste order, even when a target precedes the source.
  const ordered = new Map(existing);
  for (const [, vods] of [...accepted].sort(([a], [b]) => a - b))
    for (const vod of vods) ordered.set(vodKey(vod), vod);
  for (const [index, failure] of failures)
    outcomes.set(index, [{ input: failure.input, status: 'failed', error: failure.error }]);
  return {
    vods: [...ordered.values()],
    momentMs,
    leaderKey,
    added: accepted.size,
    clips,
    results: [...outcomes].sort(([a], [b]) => a - b).flatMap(([, outcome]) => outcome),
    failures: [...failures].sort(([a], [b]) => a - b).map(([, failure]) => failure),
  };
}
