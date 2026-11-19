import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { resolveSteps } from './steps';

/**
 * The Grown-ups tour. Hand-rolled, no library, no network. A spotlight frames the real section and a card at the bottom of the
 * screen (a bottom sheet on a phone, a centered card on an iPad) says what it is. Next, Back and Skip; Escape closes; Tab stays
 * inside the card. Steps whose section is missing are left out.
 */
export function Tour({ onClose }: { onClose: () => void }) {
  const [items] = useState(() => resolveSteps(document));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cur = items[i];
  const last = i === items.length - 1;

  const measure = useCallback(() => {
    const el = items[i]?.el;
    if (!el || !el.isConnected) return setRect(null);
    const r = el.getBoundingClientRect();
    const top = Math.max(r.top, 8);
    const bottom = Math.min(r.bottom, window.innerHeight - 8);
    setRect({ top, left: Math.max(r.left, 4), width: Math.min(r.width, window.innerWidth - 8), height: Math.max(bottom - top, 24) });
  }, [items, i]);

  // Bring the section into view, opening a collapsed Learning progress block when the step lives inside it.
  useLayoutEffect(() => {
    const el = cur?.el;
    if (!el) return;
    for (let p: HTMLElement | null = el; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
    el.setAttribute('data-tour-active', 'true');
    el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    measure();
    const t = window.setTimeout(measure, reduced ? 50 : 450);
    return () => {
      window.clearTimeout(t);
      el.removeAttribute('data-tour-active');
    };
  }, [cur, measure, reduced]);

  useEffect(() => {
    const on = () => measure();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on, true);
      window.removeEventListener('resize', on);
    };
  }, [measure]);

  useEffect(() => {
    card.current?.querySelector<HTMLElement>('[data-tour-next]')?.focus();
  }, [i]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...(card.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const end = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      end.focus();
    } else if (!e.shiftKey && document.activeElement === end) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!cur) {
    return (
      <div className="tour-layer">
        <div className="tour-card" role="dialog" aria-modal="true" aria-label="Tour" ref={card} onKeyDown={onKey}>
          <p>Nothing to show on this screen yet.</p>
          <button type="button" className="btn btn-small" data-tour-next onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tour-layer" data-testid="tour">
      <div className="tour-shield" aria-hidden="true" />
      {rect ? <div className="tour-spot" data-testid="tour-spot" style={rect} aria-hidden="true" /> : null}
      <div className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text" ref={card} onKeyDown={onKey} data-step={cur.step.id}>
        <p className="pixel small tour-count" data-testid="tour-count">{i + 1} of {items.length}</p>
        <h2 id="tour-title" className="tour-title">{cur.step.title}</h2>
        <p id="tour-text">{cur.step.text}</p>
        <div className="row tour-buttons">
          <button type="button" className="btn btn-ghost btn-small" data-testid="tour-skip" onClick={onClose}>Skip</button>
          <button type="button" className="btn btn-ghost btn-small" data-testid="tour-back" disabled={i === 0} onClick={() => setI((n) => Math.max(0, n - 1))}>Back</button>
          <button type="button" className="btn btn-small" data-testid="tour-next" data-tour-next onClick={() => (last ? onClose() : setI((n) => n + 1))}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The first-visit question: "Want a 1-minute tour?" It sits in the page, under the header, so it never covers anything.
 * Start opens the tour; Not now closes it.
 */
export function TourOffer({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <section className="panel tour-offer" role="region" aria-labelledby="tour-offer-title" data-testid="tour-offer">
      <h2 id="tour-offer-title" className="tour-title">Want a 1-minute tour?</h2>
      <p>A short walk through this area: what each part shows and how to use it. The Tour button at the top replays it any time.</p>
      <div className="row tour-buttons">
        <button type="button" className="btn btn-ghost btn-small" data-testid="tour-offer-no" onClick={onDismiss}>Not now</button>
        <button type="button" className="btn btn-small" data-testid="tour-offer-yes" onClick={onStart}>Start the tour</button>
      </div>
    </section>
  );
}
