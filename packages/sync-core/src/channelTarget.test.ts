import { describe, expect, it } from 'vitest';
import { parseChannelTarget, parseMedia } from './index';

describe('streamer inputs', () => {
  it.each([
    'twitch/Some_Name',
    'TWITCH/Some_Name/',
    'https://www.twitch.tv/Some_Name',
    'm.twitch.tv/Some_Name/',
  ])('accepts Twitch target %s', (input) => {
    expect(parseChannelTarget(input)).toEqual({ platform: 'twitch', channel: 'some_name' });
  });
  it.each([
    'kick/Some-Name',
    'KICK/Some-Name/',
    'https://kick.com/Some-Name',
    'www.kick.com/Some-Name/',
  ])('accepts Kick target %s', (input) => {
    expect(parseChannelTarget(input)).toEqual({ platform: 'kick', channel: 'some-name' });
  });
  it.each([
    'twitch/name/more',
    'twitch/not-a-login',
    'kick/',
    'twitch.tv/videos',
    'kick.com/clips',
    'https://kick.com.evil.test/name',
    'https://user:pass@kick.com/name',
    'ftp://kick.com/name',
    'https://kick.com:444/name',
    'kick.com/name?t=5',
    'twitch.tv/name#x',
    '123',
    'kick.com/name?clip=clip_abc',
    'twitch.tv/videos/123?t=2',
    'clips.twitch.tv/Example',
  ])('does not confuse non-target input %s', (input) => {
    expect(parseChannelTarget(input)).toBeUndefined();
  });
  it('continues resolving query-style Kick clips as clips', () => {
    expect(parseMedia('kick.com/name?clip=clip_abc').kind).toBe('clip');
  });
});
