import { useEffect, useRef, useState } from 'react';
import { cardLabel } from '../../engine/modules';
import { levelFor, type GameDelta } from '../../engine/game';
import { readerMapLine } from '../../engine/summaryView';
import { learnerOf, type CardMap, type Kid } from '../../engine/models';
import { PrereaderHome } from '../early/PrereaderScreens';
import { PrereaderSummary } from '../early/PrereaderSummary';
import type { RunInfo } from '../runShared';
import { HeroShop, type OnGame } from '../HeroShop';
import type { RunSummary } from '../../engine/session';
import { TABS, readTab, tabForKey, writeTab, type LandingTab } from '../landingTab';
import { PinPad } from '../PinPad';
import { Sprite } from '../sprites';

function LandingTabs({ tab, onTab }: { tab: LandingTab; onTab: (t: LandingTab, viaKeyboard?: boolean) => void }) {
  const labels: Record<LandingTab, string> = { kid: 'Kid', parent: 'Parent' };
  return (
    <div className="landing-tabs" role="tablist" aria-label="Who is signing in?">
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          id={`landing-tab-${t}`}
          aria-selected={tab === t}
          aria-controls="landing-panel"
          tabIndex={tab === t ? 0 : -1}
          className={`landing-tab ${tab === t ? 'is-active' : ''}`}
          onClick={() => onTab(t)}
          onKeyDown={(e) => {
            const next = tabForKey(t, e.key);
            if (!next) return;
            e.preventDefault();
            onTab(next, true);
          }}
        >
          {labels[t]}
        </button>
      ))}
    </div>
  );
}

/**
 * The landing card: Kid and Parent are two equal tabs. Kid shows the first-name + PIN form,
 * Parent shows Google sign-in (which registers the parent, then opens setup). The last tab is remembered.
 */
export function Landing({
  initialTab,
  error,
  onKidSubmit,
  onParentSignIn,
  onTabChange,
}: {
  initialTab?: LandingTab;
  error: string | null;
  /** Resolve to false when the name and PIN were refused, so the dots shake and clear. */
  onKidSubmit: (name: string, pin: string) => void | boolean | Promise<void | boolean>;
  onParentSignIn: () => void;
  onTabChange?: () => void;
}) {
  const [tab, setTab] = useState<LandingTab>(() => initialTab ?? readTab());
  const [name, setName] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const [needName, setNeedName] = useState(false);
  const refocus = useRef(false);
  // The tab list remounts when the panel swaps, so focus moves after the new tab renders.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    document.getElementById(`landing-tab-${tab}`)?.focus();
  }, [tab]);
  const pick = (t: LandingTab, viaKeyboard = false) => {
    if (t === tab) return;
    refocus.current = viaKeyboard;
    setTab(t);
    setNeedName(false);
    writeTab(t);
    onTabChange?.();
  };
  const tabs = <LandingTabs tab={tab} onTab={pick} />;
  const panelProps = { id: 'landing-panel', role: 'tabpanel', 'aria-labelledby': `landing-tab-${tab}` } as const;

  if (tab === 'kid') {
    return (
      <div className="screen center">
        <div className="panel pin-panel" {...panelProps}>
          <PinPad
            embedded
            top={tabs}
            title="Who's playing?"
            subtitle="Type your first name, then your 4-digit PIN."
            error={needName ? 'Type your first name first.' : error}
            header={
              <>
                <label htmlFor="kid-signin-name" className="visually-hidden">First name</label>
                <input
                  id="kid-signin-name"
                  className="kid-name-input"
                  ref={nameRef}
                  value={name}
                  onChange={(e) => { setName(e.target.value); setNeedName(false); }}
                  placeholder="First name"
                  maxLength={20}
                  autoComplete="off"
                  autoCapitalize="words"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </>
            }
            onComplete={(pin) => {
              if (!name.trim()) {
                setNeedName(true);
                nameRef.current?.focus();
                return false;
              }
              setNeedName(false);
              return onKidSubmit(name, pin);
            }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="screen center">
      <div className="panel title-panel landing-parent" {...panelProps}>
        {tabs}
        <div className="title-sprites">
          <Sprite name="knight" size={84} />
          <Sprite name="boss" size={110} />
        </div>
        <h1 className="pixel title">Math Quest</h1>
        {error ? <p className="error">{error}</p> : null}
        <button type="button" className="btn btn-big" onClick={onParentSignIn}>Sign in with Google</button>
        <p className="muted">New here? Sign in with Google to create your family.</p>
      </div>
    </div>
  );
}

export function Picker({ kids, onPick, onParent }: { kids: Kid[]; onPick: (k: Kid) => void; onParent: () => void }) {
  return (
    <div className="screen">
      <h1 className="pixel title center-text">Who is playing?</h1>
      <div className="kid-grid">
        {kids.map((k) => (
          <button key={k.id} type="button" className={`kid-card ${learnerOf(k.settings) === 'prereader' ? 'is-prereader' : ''}`} onClick={() => onPick(k)}>
            <Sprite name={k.game.hero} size={learnerOf(k.settings) === 'prereader' ? 128 : 96} />
            <span className="kid-name">{k.name}</span>
            <span className="muted pixel small">LV {levelFor(k.game.xp).level}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-ghost parent-link" onClick={onParent}>Parent area</button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function KidHome(props: { kid: Kid; onStart: () => void; onGame: OnGame; onBack: () => void }) {
  return learnerOf(props.kid.settings) === 'prereader'
    ? <PrereaderHome kid={props.kid} onStart={props.onStart} onBack={props.onBack} onGame={props.onGame} />
    : <ReaderHome {...props} />;
}

function ReaderHome({ kid, onStart, onGame, onBack }: { kid: Kid; onStart: () => void; onGame: OnGame; onBack: () => void }) {
  const [shop, setShop] = useState(false);
  const lv = levelFor(kid.game.xp);
  return (
    <div className="screen center">
      <div className="panel home">
        <Sprite name={kid.game.hero} size={150} className="bob" />
        <h1 className="pixel">{kid.name}</h1>
        <div className="level">
          <span className="pixel small">LV {lv.level}</span>
          <div className="progress"><div className="progress-fill xp" style={{ width: `${(lv.into / lv.span) * 100}%` }} /></div>
        </div>
        <div className="stats">
          <Stat label="day streak" value={kid.game.streakDays} />
          <Stat label="gems" value={kid.game.gems} />
          <Stat label="best combo" value={kid.game.bestCombo} />
        </div>
        <button type="button" className="btn btn-big btn-start" onClick={onStart}>Start Quest</button>
        <div className="row">
          <button type="button" className="btn btn-ghost" onClick={() => setShop(true)}>Hero shop</button>
          <button type="button" className="btn btn-ghost" onClick={onBack}>Switch player</button>
        </div>
      </div>
      {shop ? <HeroShop kid={kid} learner="reader" onGame={onGame} onClose={() => setShop(false)} /> : null}
    </div>
  );
}

export interface SummaryProps {
  kid: Kid;
  summary: RunSummary;
  info: RunInfo;
  loadCards: () => Promise<CardMap>;
  onGame: (d: GameDelta) => Promise<boolean>;
  onAgain: () => void;
  onHome: () => void;
}

export function Summary(props: SummaryProps) {
  return learnerOf(props.kid.settings) === 'prereader' ? <PrereaderSummary {...props} /> : <ReaderSummary {...props} />;
}

function ReaderSummary({ kid, summary, info, loadCards, onAgain, onHome }: SummaryProps) {
  const [mapLine, setMapLine] = useState<string | null>(null);
  const loadRef = useRef(loadCards);
  loadRef.current = loadCards;
  useEffect(() => {
    let live = true;
    void loadRef.current().then((c) => live && setMapLine(readerMapLine(c, kid.settings))).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [kid.settings]);
  const lv = levelFor(kid.game.xp);
  const acc = summary.graded ? summary.correct / summary.graded : 0;
  const stars = acc >= 0.9 ? 3 : acc >= 0.75 ? 2 : 1;
  return (
    <div className="screen center">
      <div className="panel summary">
        <p className="pixel tag">Quest complete!</p>
        <div className="stars" aria-label={`${stars} of 3 stars`}>
          {[1, 2, 3].map((i) => (
            <svg key={i} width="54" height="54" viewBox="0 0 24 24" aria-hidden="true" className={i <= stars ? 'star on' : 'star'}>
              <path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21.1l1.4-7L2 9.3l7-.8z" />
            </svg>
          ))}
        </div>
        <Sprite name={kid.game.hero} size={96} className="bob" />
        <div className="stats">
          <Stat label="correct" value={`${summary.correct}/${summary.graded}`} />
          <Stat label="fast answers" value={summary.fast} />
          <Stat label="XP" value={`+${summary.xp}`} />
          <Stat label="gems" value={`+${summary.gems}`} />
        </div>
        {info.saved ? (
          <>
            <div className="stats">
              <Stat label="gems in total" value={kid.game.gems} />
              <Stat label="level" value={lv.level} />
            </div>
            <div className="sum-bar sum-bar-reader" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={lv.span} aria-valuenow={lv.into}>
              <div className="sum-bar-fill" style={{ width: `${(lv.into / lv.span) * 100}%` }} />
            </div>
            {mapLine ? <p className="muted" data-testid="reader-map">{mapLine}</p> : null}
          </>
        ) : (
          <p className="muted">Your totals are not saved yet. Use Try again on the message.</p>
        )}
        {summary.newLearned ? <p>You learned <strong>{summary.newLearned}</strong> new {summary.newLearned === 1 ? 'thing' : 'things'}!</p> : null}
        {summary.faster.length ? (
          <div className="chips">
            <span className="muted">Faster than before:</span>
            {summary.faster.slice(0, 8).map((id) => <span key={id} className="chip good">{cardLabel(id)}</span>)}
          </div>
        ) : null}
        {summary.missed.length ? (
          <div className="chips">
            <span className="muted">Coming back soon:</span>
            {summary.missed.slice(0, 8).map((id) => <span key={id} className="chip">{cardLabel(id)}</span>)}
          </div>
        ) : null}
        <div className="row">
          <button type="button" className="btn btn-big" onClick={onAgain}>Play again</button>
          <button type="button" className="btn btn-ghost" onClick={onHome}>Home</button>
        </div>
      </div>
    </div>
  );
}
