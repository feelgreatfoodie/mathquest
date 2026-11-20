import type { FirebaseApp } from 'firebase/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ initializeAppCheck: vi.fn(), ReCaptchaEnterpriseProvider: vi.fn() }));
vi.mock('firebase/app-check', () => sdk);

import { initAppCheck } from './appCheck';

const app = {} as FirebaseApp;

describe('App Check client init', () => {
  beforeEach(() => {
    sdk.initializeAppCheck.mockReset();
    sdk.ReCaptchaEnterpriseProvider.mockReset();
  });

  it('is off without a site key: nothing starts', async () => {
    for (const key of [undefined, '', '   ']) expect(await initAppCheck(app, key, false)).toBe(false);
    expect(sdk.initializeAppCheck).not.toHaveBeenCalled();
    expect(sdk.ReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
  });

  it('is off against the emulators even with a key', async () => {
    expect(await initAppCheck(app, 'site-key-abc', true)).toBe(false);
    expect(sdk.initializeAppCheck).not.toHaveBeenCalled();
  });

  it('starts with a reCAPTCHA Enterprise provider and token refresh when the key is set', async () => {
    expect(await initAppCheck(app, ' site-key-abc ', false)).toBe(true);
    expect(sdk.ReCaptchaEnterpriseProvider).toHaveBeenCalledWith('site-key-abc');
    expect(sdk.initializeAppCheck).toHaveBeenCalledTimes(1);
    expect(sdk.initializeAppCheck.mock.calls[0]![0]).toBe(app);
    expect(sdk.initializeAppCheck.mock.calls[0]![1]).toMatchObject({ isTokenAutoRefreshEnabled: true });
  });

  it('never throws: a failing App Check leaves sign-in working', async () => {
    sdk.initializeAppCheck.mockImplementation(() => {
      throw new Error('recaptcha blocked');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await initAppCheck(app, 'site-key-abc', false)).toBe(false);
    warn.mockRestore();
  });
});
