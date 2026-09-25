// READY can arrive before Twitch publishes a VOD clock. Do not interpret its
// initial zero as a user-selected timestamp and accidentally sync everyone to it.
export function createPlayerClock(readTime: () => number, initialPosition: number) {
  let confirmed = false;
  let requested = initialPosition;
  let acknowledgedSeek: number | undefined;
  const sample = () => {
    const seconds = readTime();
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new Error('Twitch has not reported a playback position yet.');
    if (acknowledgedSeek !== undefined) {
      if (Math.abs(seconds - acknowledgedSeek) <= 2) acknowledgedSeek = undefined;
      else return { seconds: acknowledgedSeek, confirmed: true };
    }
    if (seconds > 0) confirmed = true;
    return { seconds: confirmed ? seconds : requested, confirmed };
  };
  return {
    sample,
    requested: (seconds: number) => {
      requested = seconds;
    },
    seeked: (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds < 0) return;
      acknowledgedSeek = seconds;
      confirmed = true;
    },
    playing: () => {
      confirmed = true;
    },
    getCurrentTime: () => {
      const position = sample();
      if (!position.confirmed)
        throw new Error('Press play inside this Twitch player before syncing from it.');
      return position.seconds;
    },
  };
}
