import { forwardRef } from 'react';
import { PixelFrame, PixelIcon } from '../../ui/pixel';
import { barFill, type MiniRoom } from './lairView';

// The lair's own screen parts, built from the style-1 pixel parts (PixelFrame, PixelIcon) and tokens. No new font and no new icon.

/** The boss countdown: a big draining bar with whole seconds, over the question. Not drawn when the timer is off. */
export function BossBar({ remainingMs, budgetMs, prereader }: { remainingMs: number; budgetMs: number; prereader: boolean }) {
  const f = barFill(remainingMs, budgetMs);
  return (
    <PixelFrame tone="neutral" className={`lair-bar${prereader ? ' lair-bar-pre' : ''}${f.urgent ? ' lair-bar-urgent' : ''}`} role="timer" aria-label={`${f.secs} seconds left`} data-testid="boss-bar" data-secs={f.secs} data-pct={f.pct}>
      <PixelIcon name="flame" size={prereader ? 56 : 36} />
      <div className="lair-bar-track">
        <div className={`lair-bar-fill lair-bar-${f.tone}`} style={{ width: `${f.pct}%` }} data-testid="boss-bar-fill" />
      </div>
      <b className="pixel-label lair-bar-secs" data-testid="boss-secs">{f.secs}</b>
    </PixelFrame>
  );
}

/** "Lair: 12 of 30" and the mini room map: one box per room, green when cleared, gold where the hero is. */
export function LairHud({ answered, total, rooms, w, h }: { answered: number; total: number; rooms: MiniRoom[]; w: number; h: number }) {
  const unit = 4;
  return (
    <span className="lair-hud" data-testid="lair-hud">
      <span className="lair-count" data-testid="lair-count" aria-label={`Lair: ${answered} of ${total}`}>
        Lair: <b>{answered}</b> of <b>{total}</b>
      </span>
      <PixelFrame tone="stone" className="lair-map" aria-hidden="true" data-testid="lair-map" style={{ width: w * unit + 8, height: h * unit + 8 }}>
        {rooms.map((r, i) => (
          <i key={i} className={`lair-room lair-room-${r.state}${r.boss ? ' lair-room-boss' : ''}`} data-state={r.state} style={{ left: r.x * unit + 4, top: r.y * unit + 4, width: r.w * unit, height: r.h * unit }}>
            {r.boss ? <PixelIcon name="flame" size={Math.min(r.w, r.h) * unit - 4} /> : null}
          </i>
        ))}
      </PixelFrame>
    </span>
  );
}

/** The door's label over the lair door in the world: Beaten N times, the best time. A pre-reader sees a star and the number. */
export const DoorLabel = forwardRef<HTMLDivElement, { lines: string[]; prereader: boolean; count: number }>(function DoorLabel({ lines, prereader, count }, ref) {
  return (
    <div ref={ref} className="lair-door" hidden={!lines.length} data-testid="lair-door">
      <PixelFrame tone="gold" className="lair-door-frame" role="status">
        {prereader ? (
          <span className="lair-door-pre" aria-label={lines[0] ?? ''}>
            <PixelIcon name="star" size={44} />
            <b className="pixel-label">{count}</b>
          </span>
        ) : (
          lines.map((l, i) => <span key={i} className="lair-door-line">{l}</span>)
        )}
      </PixelFrame>
    </div>
  );
});
