import { useCallback, useEffect, useRef, useState } from 'react';
import type { Repo } from '../data/repo';
import { SHOP_TIPS_PER_DAY, shopTipsToday } from '../engine/game';
import { learnerOf, shop2On, shopMathOn, type Kid, type KidGame } from '../engine/models';
import { buildShopMath, prereaderText, readerText, shopMathChoices, type ShopMathPrompt } from '../game/shop/shopMath';
import { payShopTip } from '../game/shop/shopTip';
import { reportFailure } from './failures';
import { ChoiceButtons } from './early/ChoiceButtons';
import { chime, softTone, unlockSounds } from './early/sounds';
import { speak, unlockSpeech } from './early/useSpeech';
import { Keypad } from './Keypad';
import { SpeakButton } from './SpeakButton';
import { Sprite, UiIcon } from './sprites';

interface Props {
  kid: Kid;
  repo: Repo;
  /** The stored game after a tip, so the gem counts on screen follow. */
  onGame: (game: KidGame) => void;
}

type Phase = 'asking' | 'wrong' | 'right';

/** True when the card should be offered at all: both settings on and something to save for. */
export function shopMathVisible(kid: Kid, now: number): boolean {
  return shop2On(kid.settings) && shopMathOn(kid.settings) && buildShopMath(kid.game, learnerOf(kid.settings), kid.id, now) !== null;
}

/** A button on Home that opens the shop math practice card. Nothing when the setting is off or nothing is out of reach. */
export function ShopMathEntry({ kid, repo, onGame }: Props) {
  const [open, setOpen] = useState<ShopMathPrompt | null>(null);
  const learner = learnerOf(kid.settings);
  if (!shop2On(kid.settings) || !shopMathOn(kid.settings)) return null;
  if (open) return <ShopMathCard key={`${open.itemId}-${open.have}-${open.cost}`} kid={kid} repo={repo} onGame={onGame} prompt={open} onClose={() => setOpen(null)} />;
  const p = buildShopMath(kid.game, learner, kid.id, Date.now());
  if (!p) return null;
  return (
    <button
      type="button"
      className={`btn shopmath-open ${learner === 'prereader' ? 'shopmath-open-pre' : ''}`}
      data-testid="shop-math-open"
      aria-label="Shop math"
      onClick={() => {
        unlockSounds();
        unlockSpeech();
        setOpen(p);
      }}
    >
      <UiIcon name="gem" size={learner === 'prereader' ? 48 : 28} /> {learner === 'prereader' ? '' : 'Shop math'}
    </button>
  );
}

function Dots({ have, cost }: { have: number; cost: number }) {
  return (
    <span className="shopmath-dots" aria-hidden="true">
      {Array.from({ length: cost }, (_, i) => <span key={i} className={`shopmath-dot ${i < have ? 'is-have' : ''}`} />)}
    </span>
  );
}

function ShopMathCard({ kid, repo, onGame, prompt, onClose }: Props & { prompt: ShopMathPrompt; onClose: () => void }) {
  const pre = learnerOf(kid.settings) === 'prereader';
  const [phase, setPhase] = useState<Phase>('asking');
  const [typed, setTyped] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const [tip, setTip] = useState<'paid' | 'capped' | 'none' | null>(null);
  const tried = useRef(false); // the first answer is the only one that can pay
  const choices = useRef(shopMathChoices(prompt.answer, kid.id, Date.now())).current;
  const text = pre ? prereaderText(prompt) : readerText(prompt);
  useEffect(() => {
    if (pre) void speak(text);
  }, [pre, text]);
  const left = SHOP_TIPS_PER_DAY - shopTipsToday(kid.game, Date.now());

  const answer = useCallback(
    async (value: number) => {
      const first = !tried.current;
      tried.current = true;
      if (value !== prompt.answer) {
        softTone();
        setPhase('wrong');
        if (pre) void speak(`The answer is ${prompt.answer}. Tap it.`);
        return;
      }
      chime();
      setPhase('right');
      if (!first) {
        setTip('none');
        return;
      }
      const r = await payShopTip(repo, kid);
      if (r.status === 'paid') {
        setTip('paid');
        onGame(r.game);
        if (pre) void speak('You got it! One gem for you.');
      } else if (r.status === 'capped') {
        setTip('capped');
      } else {
        setTip('none');
        reportFailure('The tip was not saved. It will try again later.', r.error);
      }
    },
    [kid, onGame, pre, prompt.answer, repo],
  );

  const submit = () => {
    if (typed !== '') void answer(Number(typed));
  };
  const retry = () => {
    setTyped('');
    setPicked(null);
    setPhase('asking');
  };

  return (
    <div className="screen center shopmath" role="dialog" aria-modal="true" aria-label="Shop math" data-testid="shop-math-card">
      <div className="shopmath-body">
        <Sprite name={prompt.itemId} size={pre ? 96 : 72} />
        <p className={`shopmath-text ${pre ? 'shopmath-text-pre' : ''}`} data-testid="shop-math-text">{text}</p>
        {pre ? <SpeakButton text={text} /> : null}
        {pre ? <Dots have={prompt.have} cost={prompt.cost} /> : null}
        {phase === 'wrong' ? (
          <p className="shopmath-answer" data-testid="shop-math-answer" role="status">
            The answer is <strong>{prompt.answer}</strong>. No problem, nothing lost.
          </p>
        ) : null}
        {phase === 'right' ? (
          <p className="shopmath-right" data-testid="shop-math-right" role="status">
            <UiIcon name="check" size={32} /> Right!{' '}
            {tip === 'paid' ? <span data-testid="shop-math-tip">+1 gem</span> : null}
            {tip === 'capped' ? <span data-testid="shop-math-capped">Tips are done for today.</span> : null}
            {tip === 'none' ? <span data-testid="shop-math-notip">No tip this time.</span> : null}
          </p>
        ) : null}

        {pre ? (
          phase === 'right' ? null : (
            <ChoiceButtons
              choices={choices}
              answer={prompt.answer}
              guide={phase === 'wrong'}
              picked={picked}
              disabled={false}
              onChoose={(v) => {
                setPicked(v);
                void answer(v);
              }}
            />
          )
        ) : phase === 'right' ? null : (
          <>
            <div className="shopmath-entry" data-testid="shop-math-entry" aria-live="polite">{typed === '' ? '?' : typed}</div>
            <Keypad
              onDigit={(d) => setTyped((t) => (t.length >= 4 ? t : t === '0' ? String(d) : t + d))}
              onBack={() => setTyped((t) => t.slice(0, -1))}
              onSubmit={submit}
              canSubmit={typed !== '' && phase === 'asking'}
              disabled={phase === 'wrong'}
            />
          </>
        )}

        <div className="row">
          {phase === 'wrong' && !pre ? <button type="button" className="btn" data-testid="shop-math-retry" onClick={retry}>Try again (no tip)</button> : null}
          {phase === 'asking' && !pre && left > 0 && !tried.current ? <span className="hint" data-testid="shop-math-left">{left} tip{left === 1 ? '' : 's'} left today</span> : null}
          <button type="button" className="btn btn-ghost" data-testid="shop-math-close" aria-label="Close" onClick={onClose}>
            {pre ? <UiIcon name="close" size={44} /> : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
