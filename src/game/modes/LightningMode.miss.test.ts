// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerOnScreen, ended, letRingClose, mount, phaseOf, preCards, prereaderKid, promptNumber, spoken, type, wrongOf, type Rig } from './lightningHarness';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../ui/early/useSpeech', async (orig) => ({ ...(await orig<typeof import('../../ui/early/useSpeech')>()), speak: vi.fn(async (t: string) => void spoken.push(t)), stopSpeaking: vi.fn(), unlockSpeech: vi.fn() }));
vi.mock('../../ui/early/sounds', () => ({ chime: vi.fn(), softTone: vi.fn(), unlockSounds: vi.fn(), setMuted: vi.fn(), isMuted: () => false }));

let rig: Rig;
afterEach(() => rig?.teardown());

describe('Lightning miss: how a kid gets out of it', () => {
  it('(a) a miss, then a right copy, reaches the next card', async () => {
    rig = await mount();
    const before = rig.host.querySelector('.math')!.textContent;
    await letRingClose(rig);
    await type(rig, promptNumber(rig));
    await rig.ms(600);
    expect(phaseOf(rig)).toBe('ask');
    expect(rig.host.querySelector('[data-testid="lr-answer"]')).toBeNull();
    expect(rig.host.querySelector('.math')!.textContent).not.toBe(before);
  });

  it('shows a prompt that names the number, and highlights the typed box', async () => {
    rig = await mount();
    const answer = await letRingClose(rig);
    const prompt = rig.host.querySelector('[data-testid="lr-copy"]')!;
    expect(prompt.textContent).toBe(`Type ${answer} to keep going`);
    expect(rig.host.querySelector('[data-testid="lr-typed"]')!.className).toContain('is-prompt');
  });

  it('(b) a wrong copy leaves the keypad live, and a right one after it still advances', async () => {
    rig = await mount();
    await letRingClose(rig);
    const answer = promptNumber(rig);
    await type(rig, wrongOf(answer));
    await rig.ms(500);
    expect(phaseOf(rig)).toBe('miss');
    expect(rig.host.querySelectorAll('.keypad button:disabled')).toHaveLength(1); // only GO, with nothing typed
    await type(rig, wrongOf(answer));
    await rig.ms(500);
    expect(phaseOf(rig)).toBe('miss');
    await type(rig, answer);
    await rig.ms(600);
    expect(phaseOf(rig)).toBe('ask');
  });

  it('the miss never moves on by itself while the auto-advance constant is off', async () => {
    rig = await mount();
    await letRingClose(rig);
    await rig.ms(30_000);
    expect(phaseOf(rig)).toBe('miss');
  });

  it('(c) a full round with misses and copies reaches the end screen with the right hit count', async () => {
    rig = await mount();
    let hits = 0;
    let step = 0;
    for (let guard = 0; guard < 400 && !ended(rig); guard++) {
      expect(phaseOf(rig)).toBe('ask');
      if (step % 3 === 2) {
        await letRingClose(rig);
        const answer = promptNumber(rig);
        if (step % 2 === 0) await type(rig, wrongOf(answer));
        await type(rig, answer);
        await rig.ms(600);
      } else if (step % 3 === 1) {
        await type(rig, wrongOf(answerOnScreen(rig)));
        expect(phaseOf(rig)).toBe('miss');
        await type(rig, promptNumber(rig));
        await rig.ms(600);
      } else {
        await type(rig, answerOnScreen(rig));
        hits++;
        await rig.ms(600);
      }
      step++;
    }
    expect(ended(rig)).toBe(true);
    expect(Number(rig.host.querySelector('[data-testid="lr-hits"]')!.textContent)).toBe(hits);
    expect(hits).toBeGreaterThan(5);
  });

  it('pre-reader: the voice says which number to tap, the gold choice pulses, a wrong tap leaves it live, the gold tap advances', async () => {
    rig = await mount(prereaderKid, preCards(Date.now()));
    const delay = Number(rig.host.querySelector('[data-testid="lightning"]')!.getAttribute('data-delay'));
    await rig.ms(delay + 50);
    expect(phaseOf(rig)).toBe('miss');
    const gold = rig.host.querySelector<HTMLButtonElement>('.lr-choice[data-answer="true"]')!;
    expect(gold.className).toContain('is-guide');
    expect(spoken.some((t) => new RegExp(`Tap ${gold.getAttribute('aria-label')} to keep going$`).test(t))).toBe(true);
    const wrong = rig.host.querySelector<HTMLButtonElement>('.lr-choice[data-answer="false"]')!;
    await act(async () => wrong.click());
    await rig.ms(500);
    expect(phaseOf(rig)).toBe('miss');
    await act(async () => gold.click());
    await rig.ms(600);
    expect(phaseOf(rig)).toBe('ask');
  });
});
