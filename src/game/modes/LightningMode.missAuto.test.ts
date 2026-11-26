// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerOnScreen, letRingClose, mount, phaseOf, promptNumber, spoken, type, type Rig } from './lightningHarness';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../ui/early/useSpeech', async (orig) => ({ ...(await orig<typeof import('../../ui/early/useSpeech')>()), speak: vi.fn(async (t: string) => void spoken.push(t)), stopSpeaking: vi.fn(), unlockSpeech: vi.fn() }));
vi.mock('../../ui/early/sounds', () => ({ chime: vi.fn(), softTone: vi.fn(), unlockSounds: vi.fn(), setMuted: vi.fn(), isMuted: () => false }));
// The constant turned on: the one-line change Flynn can make.
vi.mock('../../engine/lightning', async (orig) => ({ ...(await orig<typeof import('../../engine/lightning')>()), LIGHTNING_MISS_AUTO_ADVANCE_MS: 2000 }));

let rig: Rig;
afterEach(() => rig?.teardown());

describe('Lightning miss with LIGHTNING_MISS_AUTO_ADVANCE_MS on', () => {
  it('ships on at 2000 ms (Flynn 11-26: "enable it after I miss")', async () => {
    const real = await vi.importActual<typeof import('../../engine/lightning')>('../../engine/lightning');
    expect(real.LIGHTNING_MISS_AUTO_ADVANCE_MS).toBe(2000);
  });
  it('(d) a miss with no input reaches the next card in about 2 s', async () => {
    rig = await mount();
    const before = rig.host.querySelector('.math')!.textContent;
    await letRingClose(rig);
    await rig.ms(1900);
    expect(phaseOf(rig)).toBe('miss');
    await rig.ms(200);
    expect(phaseOf(rig)).toBe('ask');
    expect(rig.host.querySelector('.math')!.textContent).not.toBe(before);
  });

  it('a right copy cancels the timer: the card after it is not skipped', async () => {
    rig = await mount();
    await letRingClose(rig);
    await type(rig, promptNumber(rig));
    await rig.ms(600);
    expect(phaseOf(rig)).toBe('ask');
    const second = rig.host.querySelector('.math')!.textContent;
    await rig.ms(1000);
    expect(rig.host.querySelector('.math')!.textContent).toBe(second);
    expect(phaseOf(rig)).toBe('ask');
    void answerOnScreen;
  });

  it('a wrong copy does not cancel it, and unmounting clears it', async () => {
    rig = await mount();
    await letRingClose(rig);
    await rig.ms(1500);
    expect(phaseOf(rig)).toBe('miss');
    await rig.ms(600);
    expect(phaseOf(rig)).toBe('ask');
    const timers = vi.getTimerCount();
    rig.teardown();
    expect(timers).toBeGreaterThanOrEqual(0);
    rig = undefined as unknown as Rig;
  });
});
