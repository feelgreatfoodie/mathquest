import { useEffect, useRef, useState } from 'react';
import { AVATAR_SWATCH } from '../AvatarPicker';
import { GoalJar } from '../GoalJar';
import { ShopMathEntry } from '../ShopMathCard';
import { CampScene } from '../CampScene';
import { HeroFigure } from '../HeroFigure';
import { TitleBadge } from '../TitleBadge';
import { cardLabel } from '../../engine/modules';
import { dayKey, levelFor, type GameDelta } from '../../engine/game';
import { displayStreak, weekDays } from '../../engine/habit';
import { enabledModes, modeFor } from '../../game/modes/registry';
import { lastModeOf, readLastMode, writeLastMode } from '../../game/modes/lastMode';
import type { GameModeId } from '../../game/modes/types';
import type { Repo } from '../../data/repo';
import { readerMapLine } from '../../engine/summaryView';
import { summaryCounts } from '../../engine/runLabel';
import { avatarOf, learnerOf, shop2On, type CardMap, type Kid, type KidGame, modesOnOf } from '../../engine/models';
import { PrereaderHome } from '../early/PrereaderScreens';
import { PrereaderSummary } from '../early/PrereaderSummary';
import type { RunInfo } from '../runShared';
import { HeroShop, type OnGame } from '../HeroShop';
import { GiftPresent } from '../GiftUi';
import type { GiftApi } from '../giftApi';
import type { RunSummary } from '../../engine/session';
import { TABS, readTab, tabForKey, writeTab, type LandingTab } from '../landingTab';
import { PinPad } from '../PinPad';
import { readDeviceKids, type DeviceKid } from '../../data/deviceKids';
import { PicturePad } from '../early/PicturePad';
import { Sprite } from '../sprites';
import { looksReady, owedOf, vaultBalance, vaultOn } from '../../game/vault';
import { useDeposits, type VaultApi } from '../vaultApi';
import { TitleMenu, TitleScreen } from './TitleScreen';
import { Intro } from './Intro';
import { PixelButton, PixelFrame, PixelIcon, applyCrt, readCrt, writeCrt, type PixelIconName } from '../pixel';

function LandingTabs({ tab, onTab }: { tab: LandingTab; onTab: (t: LandingTab, viaKeyboard?: boolean) => void }) {
  const labels: Record<LandingTab, string> = { kid: 'Kid', parent: 'Grown-ups' };
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
export function Landing(props: LandingProps) {
  return (
    <TitleScreen>
      <LandingCard {...props} />
    </TitleScreen>
  );
}

interface LandingProps {
  initialTab?: LandingTab;
  error: string | null;
  /** Resolve to false when the name and PIN were refused, so the dots shake and clear. */
  onKidSubmit: (name: string, pin: string) => void | boolean | Promise<void | boolean>;
  onParentSignIn: () => void;
  onTabChange?: () => void;
}

function LandingCard({ initialTab, error, onKidSubmit, onParentSignIn, onTabChange }: LandingProps) {
  const [tab, setTab] = useState<LandingTab>(() => initialTab ?? readTab());
  // The first signed-out screen is the title menu. A caller that names a tab (the grown-up sign-in after a break screen) skips it.
  const [view, setView] = useState<'title' | 'signin' | 'intro'>(() => (initialTab ? 'signin' : 'title'));
  const [name, setName] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const [needName, setNeedName] = useState(false);
  // Faces from this device's own cache (written after a sign-in here). Nothing is fetched for a signed-out device.
  const [faces] = useState<DeviceKid[]>(() => readDeviceKids());
  const [who, setWho] = useState<DeviceKid | null>(null);
  const [typed, setTyped] = useState(false);
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
  const back = <button type="button" className="btn btn-ghost btn-small" data-testid="landing-back" onClick={() => setView('title')}>Back</button>;
  const open = (t: LandingTab) => {
    setTab(t);
    writeTab(t);
    setNeedName(false);
    onTabChange?.();
    setView('signin');
  };
  const panelProps = { id: 'landing-panel', role: 'tabpanel', 'aria-labelledby': `landing-tab-${tab}` } as const;

  if (view === 'title') return <TitleMenu onPlay={() => open('kid')} onGrownUps={() => open('parent')} onIntro={() => setView('intro')} />;
  if (view === 'intro') return <Intro onStart={() => open('parent')} onBack={() => setView('title')} />;

  if (tab === 'kid' && faces.length > 0 && !typed) {
    return (
      <div className="screen center">
        <div className="panel pin-panel" {...panelProps}>
          {tabs}
          {who ? (
            who.picture ? (
              <div data-testid="picture-signin" data-kid={who.kidId}>
                <PicturePad onComplete={(code) => onKidSubmit(who.name, code)} onCancel={() => setWho(null)} />
                {error ? <p className="error">{error}</p> : null}
              </div>
            ) : (
              <PinPad
                embedded
                title={who.name}
                subtitle="Type your 4-digit PIN."
                error={error}
                onCancel={() => setWho(null)}
                onComplete={(pin) => onKidSubmit(who.name, pin)}
              />
            )
          ) : (
            <>
              <h2 className="pixel">Who's playing?</h2>
              <div className="face-grid" data-testid="face-grid">
                {faces.map((f) => (
                  <button key={f.kidId} type="button" className="face-btn" data-kid={f.kidId} data-hero={f.hero} data-picture={f.picture ? 'yes' : 'no'} style={{ ['--kid-color' as string]: AVATAR_SWATCH[f.color] }} onClick={() => setWho(f)}>
                    <Sprite name={f.hero} size={96} />
                    <span className="kid-name">{f.name}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setTyped(true)}>Type a name instead</button>
              {back}
            </>
          )}
        </div>
      </div>
    );
  }

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
            footer={<>{faces.length > 0 ? <button type="button" className="btn btn-ghost" onClick={() => setTyped(false)}>Show faces</button> : null}{back}</>}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="screen center">
      <div className="panel title-panel landing-parent" {...panelProps}>
        {tabs}
        {error ? <p className="error">{error}</p> : null}
        <p className="muted landing-sub">For parents and teachers</p>
        <button type="button" className="btn btn-big" onClick={onParentSignIn}>Sign in with Google</button>
        <p className="muted">New here? Sign in with Google to create your family.</p>
        {back}
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
      <button type="button" className="btn btn-ghost parent-link" onClick={onParent}>Grown-ups area</button>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon?: PixelIconName }) {
  return (
    <div className={`stat ${icon ? 'stat-icon' : ''}`}>
      {icon ? <PixelIcon name={icon} size={36} /> : null}
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
            <PixelIcon name="star" size={40} />
            <span>{names[i]}</span>
          </span>
        ))}
      </div>
      <p className="week-streak">{streak > 0 ? `${streak} day${streak === 1 ? '' : 's'} in a row. One rest day a week keeps it going.` : 'Play today to start a new streak.'}</p>
    </div>
  );
}

export function KidHome(props: { kid: Kid; repo: Repo; onStart: (mode?: GameModeId) => void; onGame: OnGame; onTipGame?: (game: KidGame) => void; onBack: () => void; vault?: VaultApi; gift?: GiftApi }) {
  return learnerOf(props.kid.settings) === 'prereader'
    ? <PrereaderHome kid={props.kid} repo={props.repo} onStart={(mode) => { if (mode !== 'lightning') { writeLastMode(props.kid.id, mode); void props.repo.setWorldLastMode(props.kid.id, mode).catch(() => undefined); } props.onStart(mode); }} onBack={props.onBack} onGame={props.onGame} onTipGame={props.onTipGame} vault={props.vault} gift={props.gift} />
    : <ReaderHome {...props} />;
}

function ReaderHome({ kid, repo, onStart, onGame, onTipGame, onBack, vault, gift }: { kid: Kid; repo: Repo; onStart: (mode?: GameModeId) => void; onGame: OnGame; onTipGame?: (game: KidGame) => void; onBack: () => void; vault?: VaultApi; gift?: GiftApi }) {
  const [shop, setShop] = useState(false);
  const [shopVault, setShopVault] = useState(false);
  const hasVault = !!vault && vaultOn(kid.settings);
  const dep = useDeposits(vault, hasVault, kid.game.gems);
  const ready = hasVault && dep.deposits.some((d) => (d.status !== 'active' && owedOf(d) > 0) || looksReady(d, Date.now()));
  const [played, setPlayed] = useState<string[]>([]);
  const lv = levelFor(kid.game.xp);
  // Lightning Round is a practice button of its own, not one of the quest cards, so Start Quest and the two cards read as before.
  const modes = enabledModes(kid).filter((m) => m.id !== 'lightning');
  const lightning = modesOnOf(kid.settings).lightning;
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
  // The last pick: world/main when it has one (it follows the kid across devices), else this device's value.
  const [worldMode, setWorldMode] = useState<GameModeId | null>(null);
  useEffect(() => {
    let live = true;
    void repo.loadWorld(kid.id).then((w) => live && setWorldMode(lastModeOf(w))).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [repo, kid.id]);
  const start = (mode: GameModeId) => {
    // Lightning Round is a side practice, never the "last pick": Home keeps opening the Dungeon or Adventure.
    if (mode !== 'lightning') {
      writeLastMode(kid.id, mode);
      void repo.setWorldLastMode(kid.id, mode).catch(() => undefined);
    }
    onStart(mode);
  };
  return (
    <div className="screen center home-fit">
      <div className="panel home px-home">
        <PixelFrame className="stats px-topbar">
          <Stat icon="flame" label="day streak" value={displayStreak(kid.game.streakDays, playedAll, today)} />
          <Stat icon="gem" label="gems" value={kid.game.gems} />
          {hasVault ? <Stat icon="vault" label="in the vault" value={vaultBalance(dep.deposits)} /> : null}
          <Stat icon="bolt" label="best combo" value={kid.game.bestCombo} />
        </PixelFrame>
        <CampScene game={kid.game}>
          <div className="px-camp-name">
            <h1 className="pixel">{kid.name}</h1>
            <TitleBadge game={kid.game} name={kid.name} />
            <div className="level">
              <span className="pixel small">LV {lv.level}</span>
              <div className="progress px-bar"><div className="progress-fill xp" style={{ width: `${(lv.into / lv.span) * 100}%` }} /></div>
            </div>
          </div>
        </CampScene>
        <WeekStars days={weekDays(playedAll, today)} streak={displayStreak(kid.game.streakDays, playedAll, today)} />
        <ScanlineToggle kidId={kid.id} />
        {ready ? (
          <PixelButton tone="gold" className="btn vault-ready" data-testid="home-vault-ready" onClick={() => { setShopVault(true); setShop(true); }}>
            <PixelIcon name="chest" size={28} /> Your vault is ready to collect
          </PixelButton>
        ) : null}
        <GoalJar game={kid.game} learner="reader" onClick={() => setShop(true)} />
        <ShopMathEntry kid={kid} repo={repo} onGame={onTipGame ?? (() => undefined)} />
        {modes.length >= 2 ? (
          <div className="mode-cards" role="group" aria-label="Pick how to play">
            {modes.map((m) => (
              <button key={m.id} type="button" className={`mode-card px-frame ${m.id === 'overworld' ? 'px-adventure' : 'px-dungeon'} ${modeFor(kid, worldMode ?? readLastMode(kid.id)) === m.id ? 'is-last' : ''}`} data-mode={m.id} onClick={() => start(m.id)}>
                <span className="mode-sprites">
                  {m.id === 'overworld' ? (<><Sprite name={kid.game.hero} size={64} /><Sprite name="slime" size={48} /></>) : (<><Sprite name={kid.game.hero} size={64} /><Sprite name="skeleton" size={64} /></>)}
                </span>
                <span className="pixel mode-name">{m.id === 'overworld' ? 'Adventure' : 'Dungeon Run'}</span>
                <span className="mode-status">{m.id === 'overworld' ? 'Explore and find chests' : 'Fight monsters with math'}</span>
              </button>
            ))}
          </div>
        ) : (
          <PixelButton tone="gold" size="big" className="btn btn-big btn-start" onClick={() => start(modes[0]?.id ?? 'dungeon')}>Start Quest</PixelButton>
        )}
        {lightning ? (
          <PixelButton tone="lightning" size="big" data-testid="home-lightning" data-mode="lightning" onClick={() => start('lightning')}>
            <PixelIcon name="bolt" size={32} /> Lightning Round
          </PixelButton>
        ) : null}
        <div className="row">
          <PixelButton tone="gold" className="btn" onClick={() => { setShopVault(false); setShop(true); }}>{shop2On(kid.settings) ? 'Shop' : 'Hero shop'}</PixelButton>
          <PixelButton className="btn" onClick={onBack}>Switch player</PixelButton>
        </div>
      </div>
      <GiftPresent api={gift} learner="reader" />
      {shop ? <HeroShop kid={kid} learner="reader" onGame={onGame} vault={vault} gift={gift} openVault={shopVault} onClose={() => { setShop(false); setShopVault(false); }} /> : null}
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
  const counts = summaryCounts(summary);
  const acc = counts.total ? counts.right / counts.total : 0;
  const stars = acc >= 0.9 ? 3 : acc >= 0.75 ? 2 : 1;
  return (
    <div className="screen center px-treasure-screen">
      <div className="px-treasure" aria-hidden="true"><PixelIcon name="chest" size={96} /><PixelIcon name="gem" size={48} /><PixelIcon name="key" size={48} /><PixelIcon name="gem" size={36} /></div>
      <div className="panel summary px-frame px-neutral">
        <p className="pixel tag">Quest complete!</p>
        <div className="stars" aria-label={`${stars} of 3 stars`}>
          {[1, 2, 3].map((i) => (
            <PixelIcon key={i} name="star" size={54} className={i <= stars ? 'px-star on' : 'px-star'} />
          ))}
        </div>
        <HeroFigure game={kid.game} size={96} className="bob" />
        <TitleBadge game={kid.game} name={kid.name} className="kid-title-end" />
        <div className="stats">
          <Stat label="correct" value={`${counts.right}/${counts.total}`} />
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
          <PixelButton tone="gold" size="big" className="btn btn-big" onClick={onAgain}>Play again</PixelButton>
          <PixelButton className="btn" onClick={onHome}>Home</PixelButton>
        </div>
      </div>
    </div>
  );
}

/** Per-kid CRT scanlines. Off by default, kept on this device only. */
export function ScanlineToggle({ kidId }: { kidId: string }) {
  const [on, setOn] = useState(() => readCrt(kidId));
  return (
    <button
      type="button"
      className="btn btn-ghost scanline-toggle"
      data-testid="scanline-toggle"
      aria-pressed={on}
      onClick={() => {
        const next = !on;
        setOn(next);
        writeCrt(kidId, next);
        applyCrt(next);
      }}
    >
      Scanlines: {on ? 'On' : 'Off'}
    </button>
  );
}
