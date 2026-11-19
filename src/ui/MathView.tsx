import type { Token } from '../engine/problems';

export function FracView({ w, n, d, size = 1 }: { w?: number; n: number; d: number; size?: number }) {
  return (
    <span className="frac-wrap" style={{ fontSize: `${size}em` }}>
      {w ? <span className="frac-whole">{w}</span> : null}
      <span className="frac">
        <span className="frac-top">{n}</span>
        <span className="frac-bottom">{d}</span>
      </span>
    </span>
  );
}

export function MathView({ tokens, answer }: { tokens: Token[]; answer?: React.ReactNode }) {
  // A missing-number form carries its own "=" and result: the answer goes in the blank, not after the end.
  const hasBlank = tokens.some((t) => t.t === 'blank');
  return (
    <div className="math" aria-live="polite">
      {tokens.map((t, i) =>
        t.t === 'num' ? (
          <span key={i} className="math-num">{t.v}</span>
        ) : t.t === 'op' ? (
          <span key={i} className="math-op">{t.v}</span>
        ) : t.t === 'blank' ? (
          <span key={i} className="math-answer">{answer ?? '?'}</span>
        ) : (
          <FracView key={i} w={t.w} n={t.n} d={t.d} />
        ),
      )}
      {hasBlank ? null : (
        <>
          <span className="math-op">=</span>
          <span className="math-answer">{answer ?? '?'}</span>
        </>
      )}
    </div>
  );
}
