import { describe, expect, it } from 'vitest';
import { shouldNotifyRemoteUpdate } from './remoteUpdate';

describe('远端更新提醒', () => {
  it('远端领先本地且本次会话没有忽略时提醒', () => {
    expect(shouldNotifyRemoteUpdate({ behind: 2, ahead: 0 }, false)).toBe(true);
  });

  it('本地已同步、领先或已忽略时不提醒', () => {
    expect(shouldNotifyRemoteUpdate({ behind: 0, ahead: 0 }, false)).toBe(false);
    expect(shouldNotifyRemoteUpdate({ behind: 0, ahead: 3 }, false)).toBe(false);
    expect(shouldNotifyRemoteUpdate({ behind: 1, ahead: 0 }, true)).toBe(false);
  });
});
