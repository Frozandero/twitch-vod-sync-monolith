// READY can arrive before Twitch publishes a VOD clock. Do not interpret its
// initial zero as a user-selected timestamp and accidentally sync everyone to it.
export function createPlayerClock(readTime: () => number, initialPosition: number) {
  let confirmed = false;
  let requested = initialPosition;
  const sample = () => {
    const seconds = readTime();
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new Error('Twitch has not reported a playback position yet.');
    if (seconds > 0) confirmed = true;
    return { seconds: confirmed ? seconds : requested, confirmed };
  };
  return {
    sample,
    requested: (seconds: number) => {
      requested = seconds;
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
