import { useEffect, useRef, useState } from 'react';
import { AVATAR_SWATCH } from '../AvatarPicker';
import { GoalJar } from '../GoalJar';
import { CampRow } from '../CampRow';
import { HeroFigure } from '../HeroFigure';
import { cardLabel } from '../../engine/modules';
import { dayKey, levelFor, type GameDelta } from '../../engine/game';
import { displayStreak, weekDays } from '../../engine/habit';
import { enabledModes, modeFor } from '../../game/modes/registry';
import { readLastMode, writeLastMode } from '../../game/modes/lastMode';
import type { GameModeId } from '../../game/modes/types';
import type { Repo } from '../../data/repo';
import { UiIcon } from '../sprites';
import { readerMapLine } from '../../engine/summaryView';
import { avatarOf, learnerOf, shop2On, type CardMap, type Kid } from '../../engine/models';
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

function PickerCard({ kid: k, onPick }: { kid: Kid; onPick: (k: Kid) => void }) {
  const a = avatarOf(k);
  return (
    <button
      type="button"
      className={`kid-card ${learnerOf(k.settings) === 'prereader' ? 'is-prereader' : ''}`}
      data-hero={a.hero}
      data-color={a.color}
      style={{ ['--kid-color' as string]: AVATAR_SWATCH[a.color] }}
      onClick={() => onPick(k)}
    >
      <span className="kid-face"><Sprite name={a.hero} size={learnerOf(k.settings) === 'prereader' ? 160 : 128} /></span>
      <span className="kid-name">{k.name}</span>
      <span className="muted pixel small">LV {levelFor(k.game.xp).level}</span>
    </button>
  );
}

export function Picker({ kids, onPick, onParent }: { kids: Kid[]; onPick: (k: Kid) => void; onParent: () => void }) {
  return (
    <div className="screen">
      <h1 className="pixel title center-text">Who is playing?</h1>
      <div className="kid-grid">
        {kids.map((k) => (
          <PickerCard key={k.id} kid={k} onPick={onPick} />
        ))}
      </div>
      <button type="button" className="btn btn-ghost parent-link" onClick={onParent}>Parent area</button>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon?: 'flame' | 'gem' | 'bolt' }) {
  return (
    <div className={`stat ${icon ? 'stat-icon' : ''}`}>
      {icon ? <UiIcon name={icon} size={36} /> : null}
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/** The week at a glance: a star for each day played, Monday to Sunday. The streak sits beside it, smaller. */
function WeekStars({ days, streak }: { days: ReturnType<typeof weekDays>; streak: number }) {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const played = days.filter((d) => d.played).length;
  return (
    <div className="week" data-testid="week-stars" aria-label={`${played} of 7 days played this week`}>
      <div className="week-row">
        {days.map((d, i) => (
          <span key={d.day} className={`week-day ${d.played ? 'is-played' : ''} ${d.today ? 'is-today' : ''}`} data-played={d.played ? 'true' : 'false'}>
            <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21.1l1.4-7L2 9.3l7-.8z" /></svg>
            <span>{names[i]}</span>
          </span>
        ))}
      </div>
      <p className="week-streak">{streak > 0 ? `${streak} day${streak === 1 ? '' : 's'} in a row. One rest day a week keeps it going.` : 'Play today to start a new streak.'}</p>
    </div>
  );
}

export function KidHome(props: { kid: Kid; repo: Repo; onStart: (mode?: GameModeId) => void; onGame: OnGame; onBack: () => void }) {
  return learnerOf(props.kid.settings) === 'prereader'
    ? <PrereaderHome kid={props.kid} onStart={() => props.onStart()} onBack={props.onBack} onGame={props.onGame} />
    : <ReaderHome {...props} />;
}

function ReaderHome({ kid, repo, onStart, onGame, onBack }: { kid: Kid; repo: Repo; onStart: (mode?: GameModeId) => void; onGame: OnGame; onBack: () => void }) {
  const [shop, setShop] = useState(false);
  const [played, setPlayed] = useState<string[]>([]);
  const lv = levelFor(kid.game.xp);
  const modes = enabledModes(kid);
  const today = dayKey(Date.now());
  // The days played come from the session logs, so no stored field changes.
  useEffect(() => {
    let live = true;
    void repo.listSessions(kid.id, 80).then((logs) => live && setPlayed([...new Set(logs.map((l) => dayKey(l.endedAt)))])).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [repo, kid.id, kid.game.lastPlayedDay]);
  const playedAll = kid.game.lastPlayedDay ? [...new Set([...played, kid.game.lastPlayedDay])] : played;
  const start = (mode: GameModeId) => {
    writeLastMode(kid.id, mode);
    onStart(mode);
  };
  return (
    <div className="screen center">
      <div className="panel home">
        <HeroFigure game={kid.game} size={150} className="bob" />
        <h1 className="pixel">{kid.name}</h1>
        <div className="level">
          <span className="pixel small">LV {lv.level}</span>
          <div className="progress"><div className="progress-fill xp" style={{ width: `${(lv.into / lv.span) * 100}%` }} /></div>
        </div>
        <WeekStars days={weekDays(playedAll, today)} streak={displayStreak(kid.game.streakDays, playedAll, today)} />
        <div className="stats">
          <Stat icon="flame" label="day streak" value={displayStreak(kid.game.streakDays, playedAll, today)} />
          <Stat icon="gem" label="gems" value={kid.game.gems} />
          <Stat icon="bolt" label="best combo" value={kid.game.bestCombo} />
        </div>
        <GoalJar game={kid.game} learner="reader" onClick={() => setShop(true)} />
        <CampRow game={kid.game} />
        {modes.length >= 2 ? (
          <div className="mode-cards" role="group" aria-label="Pick how to play">
            {modes.map((m) => (
              <button key={m.id} type="button" className={`mode-card ${modeFor(kid, readLastMode(kid.id)) === m.id ? 'is-last' : ''}`} data-mode={m.id} onClick={() => start(m.id)}>
                <span className="mode-sprites">
                  {m.id === 'overworld' ? (<><Sprite name={kid.game.hero} size={64} /><Sprite name="slime" size={48} /></>) : (<><Sprite name={kid.game.hero} size={64} /><Sprite name="skeleton" size={64} /></>)}
                </span>
                <span className="pixel mode-name">{m.id === 'overworld' ? 'Adventure' : 'Dungeon Run'}</span>
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="btn btn-big btn-start" onClick={() => start(modes[0]?.id ?? 'dungeon')}>Start Quest</button>
        )}
        <div className="row">
          <button type="button" className="btn btn-ghost" onClick={() => setShop(true)}>{shop2On(kid.settings) ? 'Shop' : 'Hero shop'}</button>
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
