import { useEffect, useRef, useState } from 'react';
import { INTRO_CARDS, INTRO_IMAGE } from './introCards';

/**
 * "What is Math Quest?": 5 swipeable cards, readable signed out. Static files only: the images are lazy-loaded WebP from
 * public/intro/, and nothing here calls Firestore or Auth. The last card ends with Get started (the Grown-ups sign-in).
 */
export function Intro({ onStart, onBack }: { onStart: () => void; onBack: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  // The card being scrolled to. Next and Back count from it, so quick taps during a smooth scroll still move one card each.
  const want = useRef(0);
  // While a Next or Back scroll runs, the scroll listener leaves the card number alone.
  const busyUntil = useRef(0);
  const last = INTRO_CARDS.length - 1;

  const go = (n: number) => {
    const el = track.current;
    if (!el) return;
    const next = Math.max(0, Math.min(last, n));
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    want.current = next;
    busyUntil.current = Date.now() + (reduced ? 150 : 900);
    el.scrollTo({ left: next * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
    setI(next);
  };

  // A swipe moves the scroller; the dots and buttons follow it.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let t = 0;
    // A swipe: once the scroller rests, the dots and buttons take the card it landed on.
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (Date.now() < busyUntil.current) return;
        const n = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
        want.current = n;
        setI(n);
      }, 120);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(t);
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div className="screen center intro" data-testid="intro">
      <section className="panel intro-panel" aria-roledescription="carousel" aria-label="What is Math Quest?">
        <div
          className="intro-track"
          ref={track}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') go(want.current + 1);
            else if (e.key === 'ArrowLeft') go(want.current - 1);
            else if (e.key === 'Escape') onBack();
          }}
        >
          {INTRO_CARDS.map((c, n) => (
            <figure key={c.id} className="intro-card" role="group" aria-roledescription="slide" aria-label={`${n + 1} of ${INTRO_CARDS.length}`} data-testid={`intro-card-${n}`}>
              <img src={`/intro/${c.file}`} alt={c.alt} loading="lazy" decoding="async" width={INTRO_IMAGE.width} height={INTRO_IMAGE.height} />
              <figcaption>{c.text}</figcaption>
            </figure>
          ))}
        </div>
        <div className="intro-dots" aria-hidden="true">
          {INTRO_CARDS.map((c, n) => <i key={c.id} className={n === i ? 'is-on' : ''} />)}
        </div>
        <div className="row intro-buttons">
          <button type="button" className="btn btn-ghost" data-testid="intro-back" onClick={() => (want.current === 0 ? onBack() : go(want.current - 1))}>{i === 0 ? 'Close' : 'Back'}</button>
          {i === last ? (
            <button type="button" className="btn" data-testid="intro-start" onClick={onStart}>Get started</button>
          ) : (
            <button type="button" className="btn" data-testid="intro-next" onClick={() => go(want.current + 1)}>Next</button>
          )}
        </div>
      </section>
    </div>
  );
}
