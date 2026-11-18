import { useEffect, useMemo, useState } from 'react';
import { buildInsights, ladderStatus, type Insights, type LadderRow, type Matrix, type MatrixCell, type ModuleInsight } from '../engine/insights';
import { LEVEL_LABELS, type Level } from '../engine/mastery';
import type { CardMap, Kid, SessionLog } from '../engine/models';
import type { Repo } from '../data/repo';
import { reportFailure } from './failures';

// Parent "Learning progress" panel. Read only: it reads the kid's sessions (the cards come from the screen that
// already loaded them) and computes everything in engine/insights.ts. It writes nothing and the kid never sees it.

const SESSIONS_READ = 80;

/** Sessions per kid, kept for as long as the parent area stays open. A new total of xp reads again (a run finished). */
const sessionCache = new Map<string, SessionLog[]>();
export function clearInsightsCache(): void {
  sessionCache.clear();
}

const OP: Record<string, string> = { facts: '×', add10: '+', sub10: '−' };
const SHOWN: Record<string, (a: number, b: number) => number> = {
  facts: (a, b) => a * b,
  add10: (a, b) => a + b,
  sub10: (a, b) => a - b,
};

function fmtSec(ms: number | null): string {
  return ms !== null && Number.isFinite(ms) && ms > 0 ? `${(ms / 1000).toFixed(1)}s` : '–';
}
const pct = (x: number): number => Math.round(x * 100);

function fmtWhen(ms: number | null, now: number): string {
  if (ms === null) return '–';
  const d = new Date(ms);
  const days = Math.round((ms - now) / 86_400_000);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (days <= 0) return `${date} (now)`;
  return `${date} (in ${days} ${days === 1 ? 'day' : 'days'})`;
}

export function InsightsPanel({ repo, kid, cards }: { repo: Repo; kid: Kid; cards: CardMap }) {
  const [sessions, setSessions] = useState<SessionLog[] | null>(() => sessionCache.get(`${kid.id}|${kid.game.xp}`) ?? null);
  const [sheet, setSheet] = useState<{ cell: MatrixCell; moduleId: string } | null>(null);
  const key = `${kid.id}|${kid.game.xp}`;

  useEffect(() => {
    let alive = true;
    const hit = sessionCache.get(key);
    if (hit) {
      setSessions(hit);
      return;
    }
    repo
      .listSessions(kid.id, SESSIONS_READ)
      .then((s) => {
        sessionCache.set(key, s);
        if (alive) setSessions(s);
      })
      .catch((e) => {
        reportFailure('Could not load the learning progress.', e);
        if (alive) setSessions([]);
      });
    return () => {
      alive = false;
    };
  }, [repo, kid.id, key]);

  useEffect(() => setSheet(null), [kid.id]);

  const now = useMemo(() => Date.now(), [sessions, cards]); // eslint-disable-line react-hooks/exhaustive-deps
  const data: Insights | null = useMemo(
    () => (sessions ? buildInsights({ cards, sessions, settings: kid.settings, now }) : null),
    [cards, sessions, kid.settings, now],
  );

  if (!data) {
    return (
      <section className="panel insights" aria-label="Learning progress" data-testid="insights">
        <h2>Learning progress</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  return (
    <section className="panel insights" aria-label="Learning progress" data-testid="insights">
      <h2>Learning progress</h2>
      <Alerts alerts={data.alerts} />
      {data.modules.map(({ insight, matrix }, i) => (
        <ModuleBlock key={insight.moduleId} insight={insight} matrix={matrix} first={i === 0} onCell={(cell) => setSheet({ cell, moduleId: insight.moduleId })} />
      ))}
      <details className="ins-module" data-testid="ins-practice">
        <summary>Pace, practice and trend</summary>
        <div className="ins-body">
          <PaceBlock pace={data.pace} />
          <BalanceBlock balance={data.balance} />
          <NeedsWorkBlock rows={data.needsWork} />
          <TrendBlock days={data.trend} />
          <SkillsBlock rows={data.skills} />
        </div>
      </details>
      {sheet ? <CellSheet cell={sheet.cell} moduleId={sheet.moduleId} now={now} onClose={() => setSheet(null)} /> : null}
    </section>
  );
}

function Alerts({ alerts }: { alerts: Insights['alerts'] }) {
  if (!alerts.length) return <p className="muted" data-testid="ins-no-alerts">Nothing needs attention right now.</p>;
  return (
    <ul className="ins-alerts" aria-label="Alerts" data-testid="ins-alerts">
      {alerts.map((a, i) => (
        <li key={i} data-alert={a.kind}>{a.text}</li>
      ))}
    </ul>
  );
}

function ModuleBlock({ insight, matrix, first, onCell }: { insight: ModuleInsight; matrix: Matrix | null; first: boolean; onCell: (c: MatrixCell) => void }) {
  return (
    <details className="ins-module" data-testid={`ins-module-${insight.moduleId}`} data-first={first || undefined}>
      <summary>{insight.summary}</summary>
      <div className="ins-body ins-split">
        {matrix ? (
          <div className="ins-matrix-wrap">
            <MatrixView matrix={matrix} onCell={onCell} />
            <Legend />
          </div>
        ) : null}
        <Ladder insight={insight} />
      </div>
    </details>
  );
}

function MatrixView({ matrix, onCell }: { matrix: Matrix; onCell: (c: MatrixCell) => void }) {
  const nums = Array.from({ length: matrix.max + 1 }, (_, i) => i);
  const op = OP[matrix.moduleId] ?? '';
  const shown = SHOWN[matrix.moduleId] ?? (() => 0);
  return (
    <div
      className="ins-matrix"
      role="group"
      aria-label={`Fact matrix, ${matrix.moduleId}`}
      data-testid={`ins-matrix-${matrix.moduleId}`}
      data-cards={matrix.cardCount}
      style={{ gridTemplateColumns: `repeat(${matrix.max + 2}, minmax(0, 1fr))` }}
    >
      <span className="ins-head">{op}</span>
      {nums.map((b) => (
        <span key={`h${b}`} className="ins-head" aria-hidden="true">{b}</span>
      ))}
      {matrix.rows.map((row, a) => [
        <span key={`r${a}`} className="ins-head" aria-hidden="true">{a}</span>,
        ...row.map((c, b) =>
          c ? (
            <button
              key={`${a}-${b}`}
              type="button"
              className={`ins-cell lv${c.level}${c.preview ? ' ins-preview' : ''}`}
              aria-label={c.label}
              data-cell={c.id}
              data-level={c.level}
              data-preview={c.preview || undefined}
              onClick={() => onCell(c)}
            >
              {shown(c.a, c.b)}
              {c.preview ? <span className="ins-dot" aria-hidden="true" /> : null}
            </button>
          ) : (
            <span key={`${a}-${b}`} className={`ins-gap ${matrix.kind === 'square' ? 'ins-grey' : ''}`} aria-hidden="true" data-gap="1" />
          ),
        ),
      ])}
    </div>
  );
}

function Legend() {
  return (
    <div className="legend ins-legend" data-testid="ins-legend">
      {([0, 1, 2, 3, 4] as Level[]).map((l) => (
        <span key={l} className="legend-item"><span className={`swatch lv${l}`} />{l === 0 ? 'Not seen' : LEVEL_LABELS[l]}</span>
      ))}
      <span className="legend-item"><span className="swatch lv0 ins-preview-swatch"><span className="ins-dot" /></span>Seen early (preview)</span>
    </div>
  );
}

function Bar({ value, label, marker }: { value: number; label: string; marker?: boolean }) {
  return (
    <div className="ins-bar" role="img" aria-label={label}>
      <div className="ins-bar-fill" style={{ width: `${Math.min(100, pct(value))}%` }} />
      {marker ? <div className="ins-bar-marker" style={{ left: '80%' }} /> : null}
    </div>
  );
}

function Ladder({ insight }: { insight: ModuleInsight }) {
  return (
    <div className="ins-ladder" data-testid={`ins-ladder-${insight.moduleId}`}>
      <h3>Groups</h3>
      <ol className="ins-rows">
        {insight.ladder.map((r) => (
          <LadderItem key={r.id} row={r} prereader={insight.prereader} />
        ))}
      </ol>
      <p className="muted ins-note">
        A group opens when {pct(insight.marker)}% of the one before it is {insight.prereader ? 'steady: seen, with the last two answers right' : 'reviewing or better, or steady (seen, with the last two answers right)'}, whichever comes first.
      </p>
    </div>
  );
}

function LadderItem({ row, prereader }: { row: LadderRow; prereader: boolean }) {
  const main = prereader ? row.steady : row.reviewing;
  return (
    <li className="ins-row" data-group={row.id} data-state={row.state}>
      <div className="ins-row-head">
        <strong>{row.label}</strong>
        <span className="muted">{row.seen}/{row.total} seen</span>
      </div>
      <Bar value={main} marker label={`${row.label}: ${pct(main)}% ${prereader ? 'steady' : 'reviewing or better'}, unlock marker at 80%`} />
      <div className="ins-row-foot">
        <span className={`ins-state ${row.state}`}>{ladderStatus(row, prereader)}</span>
        <span className="muted">{pct(main)}% {prereader ? 'steady' : 'reviewing+'}</span>
      </div>
      {!prereader ? (
        <div className="ins-second">
          <span className="muted">Second rule: steady {pct(row.steady)}%</span>
          <Bar value={row.steady} marker label={`${row.label}: ${pct(row.steady)}% steady, unlock marker at 80%`} />
        </div>
      ) : null}
    </li>
  );
}

function CellSheet({ cell, moduleId, now, onClose }: { cell: MatrixCell; moduleId: string; now: number; onClose: () => void }) {
  const op = OP[moduleId] ?? '';
  const shown = (SHOWN[moduleId] ?? (() => 0))(cell.a, cell.b);
  return (
    <div className="ins-sheet" role="dialog" aria-label="Fact detail" data-testid="ins-sheet">
      <div className="ins-sheet-head">
        <strong>{cell.a} {op} {cell.b} = {shown}</strong>
        <button type="button" className="btn btn-small btn-ghost" onClick={onClose}>Close</button>
      </div>
      <dl className="ins-dl">
        <dt>Level</dt><dd>{cell.level === 0 ? 'Not seen' : LEVEL_LABELS[cell.level]}{cell.preview ? ' (seen early in a preview)' : ''}</dd>
        <dt>Attempts</dt><dd>{cell.attempts}</dd>
        <dt>Correct</dt><dd>{cell.correct} of {cell.attempts}</dd>
        <dt>Median time</dt><dd>{fmtSec(cell.medianMs)}</dd>
        <dt>Last seen</dt><dd>{cell.lastSeen ? new Date(cell.lastSeen).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '–'}</dd>
        <dt>Next due</dt><dd>{fmtWhen(cell.due, now)}</dd>
        <dt>Group</dt><dd>{cell.groupLabel}</dd>
      </dl>
    </div>
  );
}

function PaceBlock({ pace }: { pace: Insights['pace'] }) {
  const max = Math.max(1, ...pace.days.map((d) => d.newFacts));
  return (
    <div className="ins-block" data-testid="ins-pace">
      <h3>New facts</h3>
      <p>{pace.line}</p>
      <div className="ins-chart" role="img" aria-label={`New facts per day, last 14 days: ${pace.days.map((d) => d.newFacts).join(', ')}`}>
        {pace.days.map((d) => (
          <div key={d.day} className="ins-col" title={`${d.day}: ${d.newFacts} new`}>
            <div className="ins-col-bar" style={{ height: `${(d.newFacts / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <p className="muted">
        Today: {pace.today.length ? `${pace.today.length} ${pace.today.length === 1 ? 'run' : 'runs'}, new facts per run ${pace.today.join(', ')}` : 'no runs yet'}.
      </p>
    </div>
  );
}

function BalanceBlock({ balance }: { balance: Insights['balance'] }) {
  return (
    <div className="ins-block" data-testid="ins-balance">
      <h3>Practice balance</h3>
      <p>Attempts per fact: median {balance.medianAttempts}, max {balance.maxAttempts}.</p>
      <div className="two-col">
        <div>
          <h4>Most practiced</h4>
          {balance.most.map((f) => <span key={f.id} className="chip">{f.label} ({f.attempts})</span>)}
        </div>
        <div>
          <h4>Least practiced</h4>
          {balance.least.map((f) => <span key={f.id} className="chip">{f.label} ({f.attempts})</span>)}
        </div>
      </div>
    </div>
  );
}

function NeedsWorkBlock({ rows }: { rows: Insights['needsWork'] }) {
  return (
    <div className="ins-block" data-testid="ins-needs-work">
      <h3>Needs work</h3>
      {rows.length ? (
        <ul className="ins-list">
          {rows.map((r) => (
            <li key={r.id}>
              <strong>{r.label}</strong> · {r.level === 0 ? 'Not seen' : LEVEL_LABELS[r.level]} · {pct(r.accuracy)}% right of {r.attempts} · {fmtSec(r.medianMs)}
              {r.lapses ? ` · slipped ${r.lapses}×` : ''}{r.missedThisWeek ? ' · missed this week' : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None yet.</p>
      )}
    </div>
  );
}

function TrendBlock({ days }: { days: Insights['trend'] }) {
  const maxMs = Math.max(1, ...days.map((d) => d.medianMs ?? 0));
  const graded = days.filter((d) => d.accuracy !== null);
  const avg = graded.length ? pct(graded.reduce((t, d) => t + (d.accuracy ?? 0), 0) / graded.length) : null;
  return (
    <div className="ins-block" data-testid="ins-trend">
      <h3>Accuracy and speed, 14 days</h3>
      <p className="muted">{avg === null ? 'No runs in the last 14 days.' : `Average accuracy on days played: ${avg}%.`}</p>
      <div className="ins-chart" role="img" aria-label={`Accuracy per day: ${days.map((d) => (d.accuracy === null ? 'none' : `${pct(d.accuracy)}%`)).join(', ')}`}>
        {days.map((d) => (
          <div key={d.day} className="ins-col" title={`${d.day}: ${d.accuracy === null ? 'no runs' : `${pct(d.accuracy)}% right`}`}>
            <div className="ins-col-bar acc" style={{ height: `${d.accuracy === null ? 0 : pct(d.accuracy)}%` }} />
          </div>
        ))}
      </div>
      <p className="muted">Median fact time per day</p>
      <div className="ins-chart" role="img" aria-label={`Median fact time per day: ${days.map((d) => fmtSec(d.medianMs)).join(', ')}`}>
        {days.map((d) => (
          <div key={d.day} className="ins-col" title={`${d.day}: ${fmtSec(d.medianMs)}`}>
            <div className="ins-col-bar time" style={{ height: `${d.medianMs === null ? 0 : (d.medianMs / maxMs) * 100}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillsBlock({ rows }: { rows: Insights['skills'] }) {
  if (!rows.length) return null;
  return (
    <div className="ins-block" data-testid="ins-skills">
      <h3>Skills</h3>
      <ul className="ins-list">
        {rows.map((r) => (
          <li key={r.id}>{r.name} · {r.level === 0 ? 'Not seen' : LEVEL_LABELS[r.level]} · {r.attempts} {r.attempts === 1 ? 'try' : 'tries'}</li>
        ))}
      </ul>
    </div>
  );
}
