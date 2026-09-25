import type { Vod } from '@vodsync/core';

// Kick's official embed currently plays live channels, not recordings.
export const supportsPlayback = (vod: Vod) => vod.platform === 'twitch';
