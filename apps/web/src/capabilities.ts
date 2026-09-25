import type { Vod } from '@vodsync/core';

// Kick VODs use public HLS media; Twitch uses its official player SDK.
export const supportsPlayback = (vod: Vod) => vod.platform === 'twitch' || vod.platform === 'kick';
