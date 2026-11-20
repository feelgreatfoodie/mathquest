import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { learnerOf, type CardMap, type Kid } from '../../engine/models';
import type { Entry, Feedback, SessionRunner } from '../../engine/session';
import { finishRun } from '../../ui/finishRun';
import { usePauseState, usePauseStop } from '../../ui/usePause';
import { reportFailure } from '../../ui/failures';
import { loadRunner, type SaveExtra } from '../../ui/runShared';
import { newId } from '../../data/repo';
import { CHECKPOINT_EVERY, addRun, claimChest, loadTrip, openedSpots, resolveTrip, saveTrip, type TripState, type TripTotals } from './trip';
import type { TripSpot } from './chests';
import { planRegion, spotsFor } from './tripPlan';
import { queueCheckpoint, queueLairLog } from './tripWrite';
import { HoldButton } from '../../ui/early/HoldButton';
import { chest as chestSound, defeat, unlockSounds } from '../../ui/early/sounds';
import { speak, unlockSpeech } from '../../ui/early/useSpeech';
import { MuteButton, useMute } from '../../ui/MuteButton';
import { Sprite, UiIcon } from '../../ui/sprites';
import { PixelHeart, PixelIcon } from '../../ui/pixel';
import { QuestionPanel } from '../QuestionPanel';
import { PixelButton, PixelFrame } from '../../ui/pixel';
import { ownedItems } from '../shop/shopState';
import type { GameModeProps } from '../modes/types';
import { bossReady } from './boss';
import { TILE, drawScene, viewFor, type Scene } from './draw';
import { MAX_VISIBLE, retryEntity, type Entity } from './encounters';
import {
  BossClock, bossBudgetMs, bossOutcome, bossTimerOn, enterLair as planLair, instantiateLair, lairProgress, lairReward, lairSpotId, lairStats, loadLair, planLairEntities,
  roomsClearedOf, saveLair, showRooms, watchVisibility, type BossOutcome, type LairBuild, type LairState, type LairStats,
} from './lair';
import { BossBar, DoorLabel, LairHud } from './LairHud';
import { walkSpeed } from './speed';
import { doorLabel, lairRetryEntity, miniMap, openedLairSpots } from './lairView';
import { LAIRS, MAPS, findTiles, heroStart, isWalkable, tileAt, type LairDef, type Point, type RegionId, type TileMap, type WalkCtx } from './maps';
import { approach } from './pathfind';
import { MAX_FLAGS, campReducer, flagsIn, fromCampDoc, itemAt, newCamp, placeBlock, tentOf, toCampDoc, type CampDoc, type CampKind } from './camp';
import { NEXT_REGION, PREV_REGION, REGION_NAMES, furthestRegion, gateInfo, lairMessage, lairPicture, regionProgress } from './regions';
import { fromDoc, settleHero, toDoc, worldReducer, type Facing, type WorldAction, type WorldState } from './worldState';
import { lifetimeChests } from '../../engine/chestLedger';

const SAVE_MS = 5000;
const CAMP_HOLD_MS = 1000;
const DIRS: Record<Facing, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const KEYS: Record<string, Facing> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };

interface Hud {
  left: number;
  lit: boolean;
}

interface ModalState {
  entry: Entry;
  entity?: Entity;
  boss?: boolean;
}

/** One visit to a lair, held while the hero is inside. `back` is where the hero stands outside, `overEnts` the overworld's entities. */
interface LairRun {
  state: LairState;
  def: LairDef;
  build: LairBuild;
  done: Set<string>;
  cleared: number;
  back: Point;
  overEnts: Entity[];
}

interface BossFight {
  entries: Entry[];
  idx: number;
  correct: number;
  answered: number;
  result: BossOutcome;
  startedAt: number;
  /** Clock time at the answer that ended the fight. */
  ms: number | null;
}

interface FightTimer {
  clock: BossClock | null;
  budget: number;
  stopVis: () => void;
  timer: ReturnType<typeof setInterval> | null;
}

interface OverlayInfo {
  kind: 'win' | 'lose';
  first?: boolean;
  gems?: number;
  why?: 'timeout' | 'lose';
}

const NO_STATS: LairStats = { beaten: 0, bestMs: null, bestCorrect: 0 };
/** The boss door of each land in the overworld: the door label stands above it. */
const BOSS_DOOR: Record<RegionId, Point | undefined> = { meadow: findTiles(MAPS.meadow, 'boss')[0], forest: findTiles(MAPS.forest, 'boss')[0], castle: findTiles(MAPS.castle, 'boss')[0] };

interface Msg {
  text: string;
  progress?: number;
  /** A pre-reader's lair message: a dragon icon and one dot per card, filled for the ready ones. No sentence. */
  dots?: { tokens: number; lit: number; count: string };
}

/** The voice. `speak` stays silent while the kid is muted or a parent set voice off. */
function voice(text: string) {
  void speak(text);
}

export const CAMP_VOICE = 'Walk to the campfire to finish your trip!';
export const COMING_SOON_VOICE = 'More lands are coming soon!';
export const LAIR_VOICE = 'The dragon is sleeping. Answer more to wake it!';

type Intent = 'boss' | 'gate' | null;

/**
 * Adventure: the reader walks a top-down world. Tap a tile to walk there (or use the pad or the arrow keys). A monster
 * or a chest opens the same QuestionPanel the Dungeon uses, as a modal over a paused world. The questions are the run's
 * own plan, answered through `runner.answerEntry`, so grading is the Dungeon's grading. The panel's clock starts when it
 * appears: walking never counts.
 */
export default function Overworld({ repo, kid, onDone, onExit, onSynced }: GameModeProps) {
  const kidRef = useRef<Kid>(kid);
  kidRef.current = kid;
  // A pre-reader gets the picture question (dots or a ten-frame, 3 big choices, a voice); a reader gets the keypad.
  const learner = learnerOf(kid.settings);
  const mute = useMute(kid);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const runnerRef = useRef<SessionRunner | null>(null);
  const cardsRef = useRef<CardMap>({});
  const startedAt = useRef(Date.now());
  const worldRef = useRef<WorldState | null>(null);
  /** The furthest land the kid has stood in or beaten. Gates up to it stay open, so a change to the ladder never moves a kid back. */
  const reachedRef = useRef<RegionId>('meadow');
  const reached = useCallback((): RegionId => {
    const w = worldRef.current;
    if (w) reachedRef.current = furthestRegion(reachedRef.current, w.region, ...w.bossesDefeated);
    return reachedRef.current;
  }, []);
  const entsRef = useRef<Entity[]>([]);
  const known = useRef(new Set<string>());
  const bossIds = useRef(new Set<string>());
  const bossRun = useRef<BossFight | null>(null);
  const lairRef = useRef<LairRun | null>(null);
  const fightRef = useRef<FightTimer | null>(null);
  /** Dev only: the hook can push the boss clock forward. Always 0 in a build. */
  const skew = useRef(0);
  const doorRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<Point[]>([]);
  const heldRef = useRef<Facing | null>(null);
  const intent = useRef<Intent>(null);
  const pausedRef = useRef(false);
  const finishing = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  // The trip: one session doc that grows. `tripRef` is its identity and totals as of the last checkpoint; `baseRef` is what earlier opens of it already counted.
  const tripRef = useRef<TripState | null>(null);
  const baseRef = useRef<TripTotals | null>(null);
  const cpGraded = useRef(0);
  const cpAnswered = useRef(0);
  const markerRef = useRef<Point | null>(null);
  const hero = useRef({ x: 0, y: 0, fx: 0, fy: 0, facing: 'down' as Facing, frame: 0, moving: null as null | { from: Point; to: Point; p: number } });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState<RegionId>('meadow');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [overlay, setOverlay] = useState<OverlayInfo | null>(null);
  const [inLair, setInLair] = useState(false);
  const [lairView, setLairView] = useState({ answered: 0, total: 0, cleared: 0, here: { x: 0, y: 0 } });
  const [bossHud, setBossHud] = useState<{ remainingMs: number; budgetMs: number } | null>(null);
  const [stats, setStats] = useState<Partial<Record<RegionId, LairStats>>>({});
  const [hud, setHud] = useState<Hud>({ left: 0, lit: false });
  const [keys, setKeys] = useState(0);
  const [chestHud, setChestHud] = useState({ open: 0, total: 0 });
  // The camp: the tent and flags the kid placed (families/{uid}/kids/{kidId}/world/camp). The tray is open while the kid decorates.
  const campRef = useRef<CampDoc>(newCamp(0));
  const [camp, setCamp] = useState<CampDoc>(campRef.current);
  const [campOpen, setCampOpen] = useState(false);
  const [campTool, setCampTool] = useState<CampKind | 'pick'>('flag');
  const campOpenRef = useRef(false);
  campOpenRef.current = campOpen && !inLair;
  const campToolRef = useRef<CampKind | 'pick'>('flag');
  campToolRef.current = campTool;
  const [, bump] = useState(0);

  // The first tap unlocks audio on iOS, so a pre-reader's first question can be spoken.
  useEffect(() => {
    if (learner !== 'prereader') return;
    const unlock = () => {
      unlockSounds();
      unlockSpeech();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [learner]);

  const modalRef = useRef<ModalState | null>(null);
  modalRef.current = modal;
  const items = useMemo(() => ownedItems(kid.game), [kid.game]);
  const gear = useMemo(
    () => ({ key: items.includes('a-key'), boots: items.includes('a-boots'), lantern: items.includes('a-lantern'), bridge: items.includes('a-bridge') }),
    [items],
  );
  const gearRef = useRef(gear);
  gearRef.current = gear;

  const liveCards = useCallback((): CardMap => {
    const r = runnerRef.current;
    const merged = { ...cardsRef.current };
    for (const c of r?.changedCards() ?? []) merged[c.id] = c;
    return merged;
  }, []);

  /** A key opens doors: the Key item from the shop, or a key from a chest or a boss (kept, not used up). */
  const hasKey = useCallback((): boolean => gearRef.current.key || (worldRef.current?.keys ?? 0) > 0, []);

  /** The map the hero walks on: the lair's interior while inside one, else the land. */
  const curMap = useCallback((): TileMap => lairRef.current?.def.map ?? MAPS[worldRef.current!.region], []);

  const walkCtx = useCallback((): WalkCtx => {
    const w = worldRef.current!;
    const lair = lairRef.current;
    if (lair) return { gateOpen: false, hasKey: hasKey(), hasBridgeKit: gearRef.current.bridge, roomsCleared: lair.cleared };
    const next = NEXT_REGION[w.region];
    return { gateOpen: next ? gateInfo(next, liveCards(), kidRef.current.settings, reached()).open : false, hasKey: hasKey(), hasBridgeKit: gearRef.current.bridge };
  }, [liveCards, reached, hasKey]);

  const refreshHud = useCallback(() => {
    const r = runnerRef.current;
    if (!r) return;
    const left = r.pending().filter((e) => e.kind === 'graded' && !bossIds.current.has(e.id)).length;
    setHud({ left, lit: left === 0 });
  }, []);

  // ---- saving the world ----
  const flushWorld = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const w = worldRef.current;
    if (!w || !dirty.current) return;
    dirty.current = false;
    try {
      await repo.saveWorld(kidRef.current.id, toDoc(w));
    } catch (e) {
      dirty.current = true;
      reportFailure('Your place on the map was not saved.', e, () => repo.saveWorld(kidRef.current.id, toDoc(worldRef.current!)));
    }
  }, [repo]);

  const touchWorld = useCallback(
    (a: WorldAction, now = Date.now()) => {
      worldRef.current = worldReducer(worldRef.current!, a, now);
      dirty.current = true;
      if (!saveTimer.current) saveTimer.current = setTimeout(() => void flushWorld(), SAVE_MS);
    },
    [flushWorld],
  );

  // ---- entities ----
  /** The trip's chest spots in the land the hero stands in. */
  const spotsHere = useCallback((): TripSpot[] => {
    const w = worldRef.current;
    const trip = tripRef.current;
    const r = runnerRef.current;
    return w && trip && r ? spotsFor(r, trip.tripId, w.region, learner, bossIds.current, { key: gearRef.current.key, bridge: gearRef.current.bridge }, openedSpots(trip)) : [];
  }, [learner]);

  /** The opened chests of this trip in this land, for the drawing. */
  const openedHere = useCallback((): Point[] => {
    const w = worldRef.current;
    const trip = tripRef.current;
    if (!w || !trip) return [];
    return openedSpots(trip)
      .filter((id) => id.startsWith(`${w.region}:`))
      .map((id) => {
        const [x, y] = id.slice(w.region.length + 1).split(',').map(Number);
        return { x: x!, y: y! };
      });
  }, []);

  const refreshChestHud = useCallback(() => {
    const trip = tripRef.current;
    if (!trip) return;
    const lair = lairRef.current;
    if (lair) {
      const ids = lair.build.rooms.filter((e) => e.role === 'chest' && e.at).map((e) => lairSpotId(lair.def.region, lair.state.seq, e.at!));
      setChestHud({ open: ids.filter((id) => openedSpots(trip).includes(id)).length, total: ids.length });
      return;
    }
    const spots = spotsHere();
    const open = spots.filter((s) => openedSpots(trip).includes(s.id)).length;
    setChestHud({ open, total: spots.length });
  }, [spotsHere]);

  const placeEntities = useCallback(() => {
    const w = worldRef.current!;
    const trip = tripRef.current!;
    const { entities } = planRegion({
      runner: runnerRef.current!,
      cards: liveCards(),
      settings: kidRef.current.settings,
      learner,
      tripId: trip.tripId,
      opened: openedSpots(trip),
      gear: { key: gearRef.current.key, bridge: gearRef.current.bridge },
      region: w.region,
      hero: { x: hero.current.x, y: hero.current.y },
      bossIds: bossIds.current,
      rng: Math.random,
      ctx: walkCtx(),
      now: Date.now(),
    });
    entsRef.current = entities;
    for (const q of runnerRef.current!.queue) known.current.add(q.id);
    refreshChestHud();
  }, [walkCtx, liveCards, learner, refreshChestHud]);

  const revealWaiting = useCallback(() => {
    if (lairRef.current) return; // a lair's rooms show by the doors, not by a count
    const ents = entsRef.current;
    let shown = ents.filter((e) => e.kind === 'monster' && e.shown).length;
    for (const e of ents) {
      if (shown >= MAX_VISIBLE) break;
      if (e.kind === 'monster' && !e.shown) {
        e.shown = true;
        shown++;
      }
    }
  }, []);

  // ---- loading ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { runner, startedAt: at, cards } = await loadRunner(repo, kidRef.current);
        let stored: unknown = null;
        try {
          stored = await repo.loadWorld(kidRef.current.id);
        } catch {
          stored = null; // a world that will not load starts fresh; the next save repairs it
        }
        if (!alive) return;
        let storedCamp: unknown = null;
        try {
          storedCamp = await repo.loadCamp(kidRef.current.id);
        } catch {
          storedCamp = null; // an unreadable camp starts empty; the next placement repairs it
        }
        const w0 = fromDoc(stored, Date.now());
        const w = settleHero(w0);
        runnerRef.current = runner;
        // The trip: resume an open one under 24 h old, else start a new one (and close the expired one as 'left').
        const storedTrip = loadTrip(kidRef.current.id);
        const { trip, close } = resolveTrip(storedTrip, Date.now(), newId);
        tripRef.current = trip;
        baseRef.current = trip.totals;
        cpAnswered.current = trip.totals.answered;
        cpGraded.current = trip.totals.graded;
        if (close) sendCheckpoint(close, close.totals, w0.region, 'left');
        saveTrip(kidRef.current.id, trip);
        cardsRef.current = cards;
        startedAt.current = at;
        worldRef.current = w;
        campRef.current = fromCampDoc(storedCamp, Date.now());
        setCamp(campRef.current);
        reachedRef.current = furthestRegion(w.region, ...w.bossesDefeated);
        // A new trip in a land that has a tent starts at the tent (a trip being resumed keeps the saved place).
        const tent = trip !== storedTrip ? tentOf(campRef.current.placed, w.region) : undefined;
        if (tent) {
          w.x = tent.x;
          w.y = tent.y;
        }
        hero.current = { ...hero.current, x: w.x, y: w.y, fx: w.x, fy: w.y, facing: w.facing };
        setRegion(w.region);
        setKeys(w.keys);
        placeEntities();
        refreshHud();
        setLoaded(true);
        void loadStats();
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);


  // ---- game actions ----
  const say = useCallback((m: Msg | null) => setMsg(m), []);

  /** Saves one land's camp doc (world/camp_<land>). world/main is never written for a placement. */
  const saveCamp = useCallback(
    async (region: RegionId) => {
      try {
        await repo.saveCamp(kidRef.current.id, toCampDoc(campRef.current), region);
      } catch (e) {
        reportFailure('Your camp was not saved.', e, () => repo.saveCamp(kidRef.current.id, toCampDoc(campRef.current), region));
      }
    },
    [repo],
  );

  /** A tap on the map while the camp tray is open: place the picked item, or pick one up. Never runs inside a lair. */
  const campTap = useCallback(
    (p: Point) => {
      const w = worldRef.current;
      if (!w || lairRef.current) return;
      const tool = campToolRef.current;
      const here = itemAt(campRef.current.placed, w.region, p.x, p.y);
      let next = campRef.current;
      if (tool === 'pick' || (here && here.kind === tool)) {
        if (!here) return;
        next = campReducer(next, { t: 'remove', region: w.region, x: p.x, y: p.y }, Date.now());
      } else {
        const item = { region: w.region, kind: tool, x: p.x, y: p.y };
        const why = placeBlock(next.placed, item);
        if (why) {
          if (learner !== 'prereader') say({ text: why === 'flags' ? `You can put ${MAX_FLAGS} flags in each land. Pick one up first.` : why === 'taken' ? 'Something is already there.' : 'Pick a plain grass tile.' });
          return;
        }
        next = campReducer(next, { t: 'place', item }, Date.now());
      }
      if (next === campRef.current) return;
      campRef.current = next;
      setCamp(next);
      void saveCamp(w.region);
    },
    [learner, say, saveCamp],
  );

  const sendCheckpoint = useCallback(
    (trip: TripState, totals: TripTotals, region: string, end?: 'left') => {
      void queueCheckpoint(repo, kidRef.current.id, trip, totals, region, end);
    },
    [repo],
  );

  const checkpoint = useCallback(() => {
    const r = runnerRef.current;
    const trip = tripRef.current;
    if (!r || !trip || !baseRef.current || finishing.current) return;
    const totals = addRun(baseRef.current, r.summary());
    if (totals.answered === cpAnswered.current) return; // nothing new since the last one
    cpAnswered.current = totals.answered;
    cpGraded.current = totals.graded;
    const cards = r.changedCards();
    void repo.saveCards(kidRef.current.id, cards).catch((e) => reportFailure('Some answers were not saved.', e, () => repo.saveCards(kidRef.current.id, cards)));
    sendCheckpoint(trip, totals, worldRef.current?.region ?? 'meadow');
  }, [repo, sendCheckpoint]);

  const finishTrip = useCallback(async () => {
    const r = runnerRef.current;
    const trip = tripRef.current;
    if (!r || finishing.current) return;
    finishing.current = true;
    pausedRef.current = true;
    await flushWorld();
    // The campfire closes the trip: the final checkpoint carries the cumulative totals and finished = true, and the next open starts a new trip.
    let extra: SaveExtra = { mode: 'overworld' };
    if (trip && baseRef.current) {
      trip.seq += 1;
      trip.finished = true;
      trip.updatedAt = Date.now();
      trip.totals = addRun(baseRef.current, r.summary());
      saveTrip(kidRef.current.id, trip);
      extra = { mode: 'overworld', trip: { id: trip.tripId, startedAt: trip.startedAt, seq: trip.seq, base: baseRef.current, region: worldRef.current?.region ?? 'meadow' } };
    }
    await finishRun({ repo, kid: kidRef.current, runner: r, startedAt: startedAt.current, onSynced, onDone, onExit, extra });
  }, [repo, onSynced, onDone, onExit, flushWorld]);

  useEffect(
    () => () => {
      void flushWorld();
      checkpoint(); // leaving by any road keeps the answers: a checkpoint on unmount
    },
    [flushWorld, checkpoint],
  );

  // A tab sent to the background or closed is a checkpoint too (save-first: the outbox holds it if the page dies mid-write).
  useEffect(() => {
    const away = () => {
      void flushWorld();
      checkpoint();
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') away();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', away);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', away);
    };
  }, [flushWorld, checkpoint]);

  // A grown-up's pause: no question is cut off. With no question or result on screen, the trip is checkpointed and the world
  // saved (the same path as going to the background), then the break screen takes over. A question left open for
  // PAUSE_GRACE_MS is checkpointed and left too.
  const leaveForPause = useCallback(() => {
    if (finishing.current) return;
    void flushWorld();
    checkpoint();
    onExit();
  }, [flushWorld, checkpoint, onExit]);
  usePauseStop(leaveForPause);
  const { paused: pauseOn } = usePauseState();
  useEffect(() => {
    if (pauseOn && !modal && !overlay) leaveForPause();
  }, [pauseOn, modal, overlay, leaveForPause]);

  const grant = useCallback(
    async (base: number) => {
      // The reward goes through the same throttle as a run's gems, worked out from the stored count when it is written.
      const k = kidRef.current;
      const delta = {
        gemGrant: { base, learner: learnerOf(k.settings), settings: { gemSpeed: k.settings.gemSpeed, gemFullRate: k.settings.gemFullRate } },
        playedAt: Date.now(),
      };
      try {
        const game = await repo.applyGameDelta(k.id, delta);
        onSynced?.(game);
      } catch (e) {
        reportFailure('A gem from the map was not saved.', e, async () => {
          onSynced?.(await repo.applyGameDelta(k.id, delta));
        });
      }
    },
    [repo, onSynced],
  );

  const changeRegion = useCallback(
    (to: RegionId, from: RegionId) => {
      const map = MAPS[to];
      // Coming back through the gate: stand beside the forward gate of the region we return to. Going on: the start tile.
      const gate = to === PREV_REGION[from] ? findTiles(map, 'gate')[0] : undefined;
      const at = gate ? { x: gate.x - 1, y: gate.y } : heroStart(map);
      const h = hero.current;
      h.x = h.fx = at.x;
      h.y = h.fy = at.y;
      h.moving = null;
      pathRef.current = [];
      touchWorld({ t: 'region', region: to, x: at.x, y: at.y });
      setRegion(to);
      placeEntities();
      refreshHud();
      say({ text: REGION_NAMES[to] });
      void flushWorld();
    },
    [touchWorld, placeEntities, refreshHud, say, flushWorld],
  );

  const openEntity = useCallback((e: Entity) => {
    const r = runnerRef.current!;
    pathRef.current = [];
    heldRef.current = null;
    pausedRef.current = true;
    const graded = r.queue.find((q) => q.id === e.id)!;
    const teach = e.teachId ? r.queue.find((q) => q.id === e.teachId) : undefined;
    setMsg(null);
    setModal({ entry: teach ?? graded, entity: e });
  }, []);

  // ---- lairs ----
  const refreshLair = useCallback(() => {
    const l = lairRef.current;
    if (!l) return;
    const p = lairProgress(l.state.plan, l.done);
    setLairView({ answered: p.answered, total: p.total, cleared: l.cleared, here: { x: hero.current.x, y: hero.current.y } });
  }, []);

  /** The kid's lair logs, for "Beaten N times" on each door. A read that fails leaves the door unlabelled. */
  const loadStats = useCallback(async () => {
    try {
      const logs = await repo.listSessions(kidRef.current.id, 500);
      setStats({ meadow: lairStats(logs, 'meadow'), forest: lairStats(logs, 'forest'), castle: lairStats(logs, 'castle') });
    } catch {
      // The door shows no label until the next read.
    }
  }, [repo]);

  /** A question of the lair is answered: its slot is done, the next room's door opens when the rooms before it are clear. */
  const markDone = useCallback(
    (slot: string) => {
      const l = lairRef.current;
      if (!l || l.done.has(slot)) return;
      l.done.add(slot);
      const before = l.cleared;
      l.cleared = roomsClearedOf(l.state.plan, l.done);
      l.state = { ...l.state, done: [...l.done] };
      saveLair(kidRef.current.id, l.state);
      if (l.cleared !== before) {
        entsRef.current = showRooms(entsRef.current, l.cleared);
        if (l.cleared <= l.def.rooms.length - 1 && l.cleared > before) say({ text: l.cleared === l.def.rooms.length - 1 ? 'The boss door is open!' : 'A door opened!' });
      }
      refreshLair();
    },
    [refreshLair, say],
  );

  /**
   * Builds (or resumes) the lair of the land the hero stands in and puts the hero at its entrance. With `retry` it is the plan after a
   * lost fight: fresh, with 12 room questions.
   */
  const startLair = useCallback(
    (retry = false) => {
      const r = runnerRef.current!;
      const w = worldRef.current!;
      const trip = tripRef.current!;
      const k = kidRef.current;
      const def = LAIRS[w.region];
      const prior = lairRef.current;
      const { state, resumed } = planLair({
        region: w.region,
        cards: liveCards(),
        settings: k.settings,
        learner,
        now: Date.now(),
        rng: Math.random,
        stored: prior ? prior.state : loadLair(k.id),
        tripId: trip.tripId,
        retry,
      });
      // A fight left half done starts over: its slots are asked again.
      const done = new Set(state.done.filter((s) => !s.startsWith('b')));
      const before = new Set(r.queue.map((q) => q.id));
      const build = instantiateLair(r, state.plan, Math.random);
      for (const e of [...build.rooms, ...build.boss]) {
        bossIds.current.add(e.entry.id);
        known.current.add(e.entry.id);
      }
      const teachFor = new Map<string, string>();
      for (const q of r.queue) {
        if (before.has(q.id) || q.kind !== 'teach') continue;
        teachFor.set(q.cardId, q.id);
        bossIds.current.add(q.id);
        known.current.add(q.id);
      }
      const cleared = roomsClearedOf(state.plan, done);
      const opened = new Set(openedSpots(trip));
      const ents = planLairEntities({ def, build, seq: state.seq, rng: Math.random, done, roomsCleared: cleared })
        .filter((e) => !(e.spotId && opened.has(e.spotId)))
        .map((e) => (e.kind === 'chest' && teachFor.has(e.cardId) ? { ...e, teachId: teachFor.get(e.cardId)! } : e));
      const h = hero.current;
      const at = heroStart(def.map);
      lairRef.current = { state: { ...state, done: [...done] }, def, build, done, cleared, back: prior?.back ?? { x: h.x, y: h.y }, overEnts: prior?.overEnts ?? entsRef.current };
      saveLair(k.id, lairRef.current.state);
      entsRef.current = ents;
      h.x = h.fx = at.x;
      h.y = h.fy = at.y;
      h.facing = 'right';
      h.moving = null;
      pathRef.current = [];
      heldRef.current = null;
      intent.current = null;
      markerRef.current = null;
      setInLair(true);
      setCampOpen(false); // placing is overworld only
      refreshLair();
      refreshChestHud();
      refreshHud();
      say(resumed ? { text: 'You are back in the lair.' } : null);
      if (!prior) void loadStats();
    },
    [liveCards, learner, refreshLair, refreshChestHud, refreshHud, say, loadStats],
  );

  const stopFightTimers = useCallback(() => {
    const f = fightRef.current;
    if (!f) return;
    if (f.timer) clearInterval(f.timer);
    f.stopVis();
    fightRef.current = null;
  }, []);

  useEffect(() => () => stopFightTimers(), [stopFightTimers]);

  /** The exit tile: the hero goes back to the overworld beside the door and the place is saved. */
  const leaveLair = useCallback(() => {
    const l = lairRef.current;
    if (!l) return;
    stopFightTimers();
    bossRun.current = null;
    setBossHud(null);
    saveLair(kidRef.current.id, l.state);
    entsRef.current = l.overEnts;
    lairRef.current = null;
    setInLair(false);
    const h = hero.current;
    h.x = h.fx = l.back.x;
    h.y = h.fy = l.back.y;
    h.facing = 'down';
    h.moving = null;
    pathRef.current = [];
    heldRef.current = null;
    intent.current = null;
    markerRef.current = null;
    touchWorld({ t: 'move', x: l.back.x, y: l.back.y, facing: 'down' });
    void flushWorld();
    refreshChestHud();
    refreshHud();
    setMsg(null);
  }, [stopFightTimers, touchWorld, flushWorld, refreshChestHud, refreshHud]);

  /** The fight is over (win, wrong answers or the clock): log it, pay the win once, and show the overlay. */
  const finishFight = useCallback(() => {
    const run = bossRun.current;
    const l = lairRef.current;
    if (!run || !l) return;
    const f = fightRef.current;
    const ms = run.ms ?? (f?.clock ? f.clock.elapsedMs() : Date.now() - run.startedAt);
    bossRun.current = null;
    stopFightTimers();
    setBossHud(null);
    const k = kidRef.current;
    const w = worldRef.current!;
    const win = run.result === 'win';
    // A miss in the fight queued a retry: it stays out of the map.
    for (const q of runnerRef.current!.queue) {
      if (!known.current.has(q.id)) {
        known.current.add(q.id);
        bossIds.current.add(q.id);
      }
    }
    void queueLairLog(repo, k.id, tripRef.current!, { region: w.region, bossWon: win, bossCorrect: run.correct, bossMs: ms });
    setModal(null);
    if (win) {
      // Read the reward before the world records the win: the first win pays 10 gems, a key and the trophy once, a replay pays 3.
      const reward = lairReward(w, w.region, true);
      touchWorld({ t: 'boss', region: w.region });
      setKeys(worldRef.current!.keys);
      if (reward.gems > 0) void grant(reward.gems);
      defeat();
      void flushWorld();
      l.state = { ...l.state, bossDone: true, done: [...l.done] };
      saveLair(k.id, l.state);
      setStats((all) => {
        const prev = all[w.region] ?? NO_STATS;
        return { ...all, [w.region]: { beaten: prev.beaten + 1, bestMs: prev.bestMs === null ? ms : Math.min(prev.bestMs, ms), bestCorrect: Math.max(prev.bestCorrect, run.correct) } };
      });
      setOverlay({ kind: 'win', first: reward.first, gems: reward.gems });
      voice(reward.first ? 'Boss defeated!' : 'You beat the boss again!');
    } else {
      // Driven out: back at the entrance, in a fresh lair of 12 room questions.
      startLair(true);
      setOverlay({ kind: 'lose', why: run.result === 'timeout' ? 'timeout' : 'lose' });
      voice('The boss drove you out!');
    }
    refreshHud();
  }, [repo, stopFightTimers, touchWorld, grant, flushWorld, startLair, refreshHud]);

  const startFight = useCallback(() => {
    const l = lairRef.current;
    if (!l || bossRun.current) return;
    const entries = l.build.boss.map((b) => b.entry);
    if (!entries.length) return say({ text: 'Nothing to fight yet.' });
    if (l.state.bossDone) return say({ text: 'The boss is beaten. The way out is behind you.' });
    const settings = kidRef.current.settings;
    const timerOn = bossTimerOn(settings);
    const budget = timerOn ? bossBudgetMs(entries.map((e) => e.cardId), liveCards(), settings) : 0;
    const clock = timerOn ? new BossClock(budget, () => Date.now() + skew.current) : null;
    clock?.start();
    const stopVis = clock ? watchVisibility(clock) : () => {};
    const timer = clock
      ? setInterval(() => {
          const run = bossRun.current;
          if (!run) return;
          const left = clock.remainingMs();
          setBossHud({ remainingMs: left, budgetMs: budget });
          if (left <= 0 && run.result === 'pending') {
            run.result = 'timeout';
            run.ms = clock.elapsedMs();
            finishFight();
          }
        }, 200)
      : null;
    stopFightTimers();
    fightRef.current = { clock, budget, stopVis, timer };
    bossRun.current = { entries, idx: 0, correct: 0, answered: 0, result: 'pending', startedAt: Date.now(), ms: null };
    pathRef.current = [];
    heldRef.current = null;
    pausedRef.current = true;
    setMsg(null);
    setBossHud(timerOn ? { remainingMs: budget, budgetMs: budget } : null);
    setModal({ entry: entries[0]!, boss: true });
    refreshHud();
  }, [liveCards, say, refreshHud, stopFightTimers, finishFight]);

  const startBoss = useCallback(() => {
    if (lairRef.current) return startFight();
    const w = worldRef.current!;
    const cards = liveCards();
    // A beaten lair stays open for ever; one not yet beaten needs the region's facts ready.
    if (!w.bossesDefeated.includes(w.region) && !bossReady(w.region, cards, kidRef.current.settings)) {
      const p = regionProgress(w.region, cards, kidRef.current.settings);
      // N and the bar use the larger of the two counts (reviewing, steady). A pre-reader gets the icon, the dots and the voice.
      if (learner === 'prereader') {
        voice(LAIR_VOICE);
        return say({ text: '', dots: lairPicture(p.done, p.total) });
      }
      return say({ text: lairMessage(w.region, p.done, p.total, kidRef.current.settings), progress: p.share });
    }
    pathRef.current = [];
    heldRef.current = null;
    startLair();
    void loadStats();
  }, [liveCards, say, learner, startFight, startLair, loadStats]);

  const gateMessage = useCallback(() => {
    const w = worldRef.current!;
    const next = NEXT_REGION[w.region];
    if (!next) {
      // The last region: the gate is a closed door with nothing behind it yet.
      voice(COMING_SOON_VOICE);
      return say({ text: learner === 'prereader' ? 'Coming soon' : 'More lands coming soon' });
    }
    const info = gateInfo(next, liveCards(), kidRef.current.settings, reached());
    say({ text: `The gate to the ${REGION_NAMES[next]} is locked: ${info.label}`, progress: info.total ? info.learned / info.total : 0 });
  }, [liveCards, say, learner, reached]);

  const onArrive = useCallback(() => {
    const w = worldRef.current!;
    const h = hero.current;
    const map = curMap();
    const lair = lairRef.current;
    // Inside a lair the saved place stays the overworld door: the lair's own coordinates never reach the world doc.
    if (!lair) touchWorld({ t: 'move', x: h.x, y: h.y, facing: h.facing });
    else refreshLair();
    const here = entsRef.current.find((e) => e.shown && e.x === h.x && e.y === h.y);
    if (here) return openEntity(here);
    const tile = tileAt(map, h.x, h.y);
    if (lair) {
      if (tile === 'exit') return leaveLair();
    } else if (tile === 'gate') {
      const to = NEXT_REGION[w.region];
      if (to) return changeRegion(to, w.region);
    }
    if (!lair && tile === 'back') {
      const to = PREV_REGION[w.region];
      if (to) return changeRegion(to, w.region);
    }
    if (!lair && tile === 'camp') {
      const r = runnerRef.current!;
      const left = r.pending().filter((e) => e.kind === 'graded' && !bossIds.current.has(e.id)).length;
      if (left === 0) return void finishTrip();
      say({ text: `${left} left to find before the campfire lights.` });
    }
    if (pathRef.current.length === 0 && intent.current) {
      const want = intent.current;
      intent.current = null;
      for (const d of Object.values(DIRS)) {
        const t = tileAt(map, h.x + d.x, h.y + d.y);
        if (want === 'boss' && t === 'boss') return startBoss();
        if (want === 'gate' && t === 'gate') return gateMessage();
      }
    }
  }, [touchWorld, openEntity, changeRegion, finishTrip, say, startBoss, gateMessage, curMap, leaveLair, refreshLair]);

  const resolveEntity = useCallback(
    (entity: Entity, fb: Feedback) => {
      const r = runnerRef.current!;
      entsRef.current = entsRef.current.filter((e) => e.id !== entity.id);
      const lair = lairRef.current;
      if (entity.kind === 'chest') {
        chestSound();
        // Each chest pays once on a trip: the spot is written to the trip first, so a second open of the same spot pays nothing.
        const trip = tripRef.current;
        const claim = entity.spotId && trip ? claimChest(kidRef.current.id, trip, entity.spotId, fb.verdict === 'correct') : null;
        if (claim?.opened) {
          touchWorld({ t: 'chest' });
          if (entity.key && worldRef.current!.keys === 0) {
            touchWorld({ t: 'key' });
            setKeys(worldRef.current!.keys);
          }
          if (claim.gems > 0) void grant(claim.gems);
          refreshChestHud();
        }
      } else if (fb.verdict === 'correct') {
        defeat();
      }
      // A miss queued a retry: it comes back as the same monster within 3 tiles.
      const fresh = r.queue.filter((q) => !known.current.has(q.id));
      for (const q of fresh) {
        known.current.add(q.id);
        entsRef.current.push(
          lair
            ? lairRetryEntity({ prev: entity, entry: q, def: lair.def, taken: entsRef.current, rng: Math.random, cleared: lair.cleared })
            : retryEntity({ prev: entity, entry: q, map: MAPS[worldRef.current!.region], taken: entsRef.current, rng: Math.random, ctx: walkCtx() }),
        );
        if (lair) bossIds.current.add(q.id); // a lair retry is extra practice: it is not one of the trip's questions
      }
      // The answered question's slot is done, and a cleared room opens its door. (After the retry, which stays in the room.)
      const slot = lair?.build.slotOf[entity.id];
      if (slot) markDone(slot);
      revealWaiting();
      refreshHud();
      pausedRef.current = false;
      setModal(null);
    },
    [touchWorld, grant, walkCtx, revealWaiting, refreshHud, refreshChestHud, markDone],
  );

  /** A boss answer was graded: count it, and decide the fight now (not after the feedback), so the clock cannot change a won fight. */
  const onPanelAnswered = useCallback(
    (fb: Feedback) => {
      const m = modalRef.current;
      const run = bossRun.current;
      const l = lairRef.current;
      if (!m?.boss || !run || !l || run.result !== 'pending') return;
      run.answered++;
      if (fb.verdict === 'correct') run.correct++;
      const slot = l.build.slotOf[m.entry.id];
      if (slot) markDone(slot);
      const clock = fightRef.current?.clock ?? null;
      const out = bossOutcome({ correct: run.correct, answered: run.answered, remainingMs: clock ? clock.remainingMs() : null, prereader: learner === 'prereader', timerOn: !!clock });
      if (out !== 'pending') {
        run.result = out;
        run.ms = clock ? clock.elapsedMs() : Date.now() - run.startedAt;
        clock?.pause();
      }
    },
    [markDone, learner],
  );

  /** A boss question is finished (its feedback is done): the next one, or the end of the fight. */
  const resolveBoss = useCallback(
    (fb: Feedback) => {
      const r = runnerRef.current!;
      const run = bossRun.current;
      if (!run) return;
      for (const q of r.queue) {
        if (!known.current.has(q.id)) {
          known.current.add(q.id);
          bossIds.current.add(q.id); // a boss retry stays out of the map
        }
      }
      void fb;
      run.idx++;
      if (run.result === 'pending' && run.idx < run.entries.length) return setModal({ entry: run.entries[run.idx]!, boss: true });
      // The questions ran out with the fight still open (cannot happen with 6 and the rules): count it as a loss.
      if (run.result === 'pending') run.result = 'lose';
      finishFight();
    },
    [finishFight],
  );

  const onPanelResolved = useCallback(
    (fb: Feedback | null) => {
      const m = modal;
      if (!m) return;
      // Every 10 graded answers of the trip is a checkpoint.
      const r0 = runnerRef.current;
      if (r0 && baseRef.current && addRun(baseRef.current, r0.summary()).graded - cpGraded.current >= CHECKPOINT_EVERY) checkpoint();
      if (m.boss) {
        if (fb) resolveBoss(fb);
        return;
      }
      const r = runnerRef.current!;
      if (fb === null) {
        // A teach card was read: the question for the same chest comes next.
        const graded = r.queue.find((q) => q.id === m.entity!.id)!;
        return setModal({ entry: graded, entity: m.entity });
      }
      resolveEntity(m.entity!, fb);
    },
    [modal, resolveBoss, resolveEntity, checkpoint],
  );

  // ---- movement ----
  const beginStep = useCallback(
    (dir: Facing) => {
      const h = hero.current;
      const d = DIRS[dir];
      const to = { x: h.x + d.x, y: h.y + d.y };
      h.facing = dir;
      const map = curMap();
      const t = tileAt(map, to.x, to.y);
      if (t === 'boss') return startBoss();
      if (t === 'gate' && !walkCtx().gateOpen) return gateMessage();
      if (!isWalkable(map, to.x, to.y, walkCtx())) {
        pathRef.current = [];
        return;
      }
      setMsg(null);
      h.moving = { from: { x: h.x, y: h.y }, to, p: 0 };
    },
    [startBoss, gateMessage, walkCtx, curMap],
  );

  const tapTile = useCallback(
    (p: Point) => {
      if (pausedRef.current || !worldRef.current) return;
      unlockSounds();
      const map = curMap();
      const h = hero.current;
      const t = tileAt(map, p.x, p.y);
      intent.current = t === 'boss' ? 'boss' : t === 'gate' ? 'gate' : null;
      const from = h.moving ? h.moving.to : { x: h.x, y: h.y };
      const path = approach(map, from, p, walkCtx());
      markerRef.current = p;
      if (!path) return say({ text: "You can't walk there." });
      pathRef.current = path;
      heldRef.current = null;
      if (path.length === 0 && intent.current === 'boss') startBoss();
      else if (path.length === 0 && intent.current === 'gate') gateMessage();
    },
    [walkCtx, say, startBoss, gateMessage, curMap],
  );

  // The animation loop. It stops moving the world while a question is open or the trip is ending.
  useEffect(() => {
    if (!loaded) return;
    let raf = 0;
    let last = performance.now();
    let time = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      time += dt;
      const h = hero.current;
      if (!pausedRef.current && worldRef.current) {
        if (h.moving) {
          const speed = walkSpeed(gearRef.current.boots);
          h.moving.p += dt * speed;
          h.frame = Math.floor(h.moving.p * 2) % 2;
          if (h.moving.p >= 1) {
            h.x = h.fx = h.moving.to.x;
            h.y = h.fy = h.moving.to.y;
            h.moving = null;
            onArrive();
          } else {
            h.fx = h.moving.from.x + (h.moving.to.x - h.moving.from.x) * h.moving.p;
            h.fy = h.moving.from.y + (h.moving.to.y - h.moving.from.y) * h.moving.p;
          }
        }
        if (!h.moving && !pausedRef.current) {
          const nextTile = pathRef.current.shift();
          if (nextTile) {
            const dx = nextTile.x - h.x;
            const dy = nextTile.y - h.y;
            beginStep(dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up');
          } else if (heldRef.current) beginStep(heldRef.current);
          else h.frame = 0;
        }
      }
      draw(time);
      raf = requestAnimationFrame(loop);
    };
    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = (time: number) => {
      const canvas = canvasRef.current;
      const w = worldRef.current;
      if (!canvas || !w) return;
      const g = canvas.getContext('2d');
      if (!g) return;
      const map = curMap();
      const lair = lairRef.current;
      const h = hero.current;
      const dpr = canvas.width / Math.max(1, canvas.clientWidth);
      // Tile size in CSS pixels: about 14 tiles across, never fewer than 11 by 7 in view (shrink the tiles before the buttons).
      const want = Math.max(2, Math.min(6, Math.round(canvas.clientWidth / (TILE * 14))));
      const fit = Math.max(1, Math.floor(Math.min(canvas.clientWidth / (11 * TILE), canvas.clientHeight / (7 * TILE))));
      const scale = Math.min(want, fit) * Math.round(dpr);
      canvas.dataset.tile = String(TILE * Math.min(want, fit)); // CSS px per tile, for the layout tests
      const k = kidRef.current.game;
      const worn = k.equipped?.pet;
      const scene: Scene = {
        map,
        hero: { x: h.fx, y: h.fy, facing: h.facing, frame: h.frame },
        heroSprite: k.hero,
        ...(worn ? { petSprite: worn } : {}),
        entities: entsRef.current,
        gateOpen: lair ? false : walkCtxCache(),
        campLit: lair ? false : hudLit.current,
        bossDefeated: lair ? lair.state.bossDone : w.bossesDefeated.includes(w.region),
        hasKey: hasKey(),
        hasBridgeKit: gearRef.current.bridge,
        openedChests: lair ? openedLairSpots(openedSpots(tripRef.current!), lair.def.region, lair.state.seq) : openedHere(),
        ...(lair ? { roomsCleared: lair.cleared } : {}),
        ...(!lair && w.bossesDefeated.includes(w.region) ? { trophy: true } : {}),
        ...(!lair ? { camp: campRef.current.placed.filter((c) => c.region === w.region) } : {}),
        lantern: gearRef.current.lantern,
        time,
        marker: markerRef.current,
        still: reducedMotion,
      };
      drawScene(g, canvas.width, canvas.height, scale, scene);
      viewScale.current = scale;
      // The door label rides above the lair door in the world (never inside a lair).
      const label = doorRef.current;
      const door = lair ? undefined : BOSS_DOOR[w.region];
      if (label && door) {
        const v = viewFor(canvas.width, canvas.height, scale, { x: h.fx, y: h.fy }, map);
        label.style.transform = `translate(${((door.x + 0.5) * v.t - v.left) / dpr}px, ${(door.y * v.t - v.top) / dpr}px) translate(-50%, -100%)`;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, beginStep, onArrive, curMap]);

  const viewScale = useRef(4);
  const hudLit = useRef(false);
  hudLit.current = hud.lit;
  // The voice says once, when the camp first lights, where to go next.
  const campSpoken = useRef(false);
  useEffect(() => {
    if (!hud.lit || campSpoken.current) return;
    campSpoken.current = true;
    voice(CAMP_VOICE);
  }, [hud.lit]);
  const gateCache = useRef({ at: 0, open: false });
  const walkCtxCache = (): boolean => {
    const now = performance.now();
    if (now - gateCache.current.at > 400) gateCache.current = { at: now, open: worldRef.current ? walkCtx().gateOpen : false };
    return gateCache.current.open;
  };

  /** What the Playwright specs read about the lair the hero is in: the plan, the rooms cleared, the fight and its clock. */
  const lairState = useCallback(() => {
    const l = lairRef.current;
    if (!l) return null;
    const run = bossRun.current;
    const f = fightRef.current;
    const p = lairProgress(l.state.plan, l.done);
    return {
      region: l.def.region,
      seq: l.state.seq,
      size: l.state.plan.size,
      roomItems: l.state.plan.rooms.map((r) => r.items.length),
      bossItems: l.state.plan.boss.length,
      forms: l.state.plan.boss.filter((b) => b.form).length,
      cleared: l.cleared,
      done: [...l.done],
      answered: p.answered,
      total: p.total,
      bossDone: l.state.bossDone,
      timerOn: bossTimerOn(kidRef.current.settings),
      fight: run ? { idx: run.idx, correct: run.correct, answered: run.answered, result: run.result } : null,
      budgetMs: f?.budget ?? null,
      remainingMs: f?.clock ? f.clock.remainingMs() : null,
      boss: l.build.boss.map((b) => ({ id: b.entry.id, cardId: b.entry.cardId, form: b.form ?? null })),
      back: l.back,
    };
  }, []);

  // A read and drive hook for the Playwright specs. It exists only in the dev server (import.meta.env.DEV), never in a build.
  useEffect(() => {
    if (!loaded || !import.meta.env.DEV) return;
    const w = window as unknown as { __ow?: unknown };
    w.__ow = {
      state: () => ({
        region: worldRef.current!.region,
        hero: { x: hero.current.x, y: hero.current.y },
        moving: !!hero.current.moving || pathRef.current.length > 0,
        entities: entsRef.current.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, shown: e.shown, cardId: e.cardId, ...(e.spotId ? { spotId: e.spotId } : {}), ...(e.key ? { key: true } : {}), ...(e.room !== undefined ? { room: e.room } : {}), ...(e.guard ? { guard: true } : {}), ...(e.trap ? { trap: true } : {}) })),
        lair: lairState(),
        stats: stats,
        world: worldRef.current,
        camp: campRef.current,
        trip: tripRef.current ? { tripId: tripRef.current.tripId, opened: openedSpots(tripRef.current) } : null,
        spots: spotsHere().map((s) => ({ id: s.id, x: s.x, y: s.y, key: s.key, ...(s.power ? { power: s.power } : {}) })),
        lifetime: lifetimeChests(worldRef.current!.openedChests),
        paused: pausedRef.current,
      }),
      answerOf: (id: string) => {
        const a = runnerRef.current!.queue.find((q) => q.id === id)?.problem.answer;
        return a && a.kind === 'int' ? a.value : null;
      },
      modalAnswer: () => {
        const a = modalRef.current?.entry.problem.answer;
        return a && a.kind === 'int' ? a.value : null;
      },
      tapTile: (x: number, y: number) => tapTile({ x, y }),
      /** Dev only: pushes the running boss clock forward by `ms` (a lost fight without waiting for it). */
      fastForwardBoss: (ms: number) => {
        skew.current += ms;
      },
      /** Dev only: the answer of the question the boss fight is on, or null. */
      bossAnswer: () => {
        const run = bossRun.current;
        const a = run?.entries[run.idx]?.problem.answer;
        return a && a.kind === 'int' ? a.value : null;
      },
      teleport: (x: number, y: number) => {
        const h = hero.current;
        h.x = h.fx = x;
        h.y = h.fy = y;
        h.moving = null;
        pathRef.current = [];
      },
      clientOf: (x: number, y: number) => {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        const ratio = canvas.width / rect.width;
        const h = hero.current;
        const { t, left, top } = viewFor(canvas.width, canvas.height, viewScale.current, { x: h.fx, y: h.fy }, curMap());
        return { x: rect.left + ((x + 0.5) * t - left) / ratio, y: rect.top + ((y + 0.5) * t - top) / ratio };
      },
    };
    return () => {
      delete w.__ow;
    };
  }, [loaded, tapTile, curMap, lairState, stats]);

  // Size the canvas to its box.
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const size = () => {
      const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
      canvas.width = Math.max(1, Math.round(stage.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(stage.clientHeight * dpr));
    };
    size();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null;
    ro?.observe(stage);
    window.addEventListener('resize', size);
    window.addEventListener('orientationchange', size);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', size);
      window.removeEventListener('orientationchange', size);
    };
  }, [loaded]);

  // Arrow keys and WASD walk; a question open means the keys belong to the keypad.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const dir = KEYS[e.key];
      if (!dir || pausedRef.current) return;
      e.preventDefault();
      pathRef.current = [];
      heldRef.current = dir;
    };
    const up = (e: KeyboardEvent) => {
      const dir = KEYS[e.key];
      if (dir && heldRef.current === dir) heldRef.current = null;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onCanvasTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const w = worldRef.current;
    if (!canvas || !w) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = canvas.width / rect.width;
    const map = curMap();
    const h = hero.current;
    const { t, left, top } = viewFor(canvas.width, canvas.height, viewScale.current, { x: h.fx, y: h.fy }, map);
    const tile = { x: Math.floor(((e.clientX - rect.left) * ratio + left) / t), y: Math.floor(((e.clientY - rect.top) * ratio + top) / t) };
    if (campOpenRef.current && !pausedRef.current) {
      markerRef.current = tile;
      campTap(tile);
      bump((n) => n + 1);
      return;
    }
    tapTile(tile);
    bump((n) => n + 1);
  };

  const hold = (dir: Facing | null) => () => {
    if (pausedRef.current) return;
    unlockSounds();
    pathRef.current = [];
    heldRef.current = dir;
  };

  if (error) {
    return (
      <div className="screen center">
        <div className="panel">
          <p className="error">Could not load your adventure: {error}</p>
          <button type="button" className="btn" onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }
  if (!loaded) return <div className="screen center"><p className="pixel blink">Loading adventure…</p></div>;

  const r = runnerRef.current!;
  const waiting = r.pending().filter((e) => e.kind === 'graded' && !bossIds.current.has(e.id));
  const adventureItems = items.filter((i) => i.startsWith('a-'));
  const lairNow = inLair ? lairRef.current : null;
  const won = worldRef.current!.bossesDefeated.includes(region);
  const doorLines = lairNow ? [] : doorLabel(stats[region] ?? NO_STATS, won);

  return (
    <div className={`screen overworld${learner === 'prereader' ? ' ow-pre' : ''}`} data-testid="overworld" data-region={region}>
      <div className="ow-hud">
        <HoldButton onHold={() => void finishTrip()} ms={CAMP_HOLD_MS} label="Hold to go to camp">
          <PixelIcon name="house" size={44} />
        </HoldButton>
        {lairNow ? null : (
          <button type="button" className={`icon-btn ow-camp-btn${campOpen ? ' is-on' : ''}`} data-testid="camp-btn" aria-label="Decorate your camp" aria-pressed={campOpen} onClick={() => setCampOpen((o) => !o)}>
            <PixelIcon name="tent" size={44} />
          </button>
        )}
        <span className="ow-hearts" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i}><PixelHeart size={24} /></i>)}</span>
        <span className="ow-stat" aria-label={`${kid.game.gems} gems`}><PixelIcon name="gem" size={30} /><b>{kid.game.gems}</b></span>
        <span className="ow-stat" aria-label={`${keys} keys`} data-testid="ow-keys"><KeyIcon /><b>{keys}</b></span>
        <span className="ow-stat ow-chests" aria-label={`${chestHud.open} of ${chestHud.total} chests opened`} data-testid="ow-chests"><PixelIcon name="chest" size={30} /><b>{learner === 'prereader' ? `${chestHud.open}/${chestHud.total}` : `${chestHud.open} of ${chestHud.total}`}</b></span>
        {lairNow ? (
          <LairHud answered={lairView.answered} total={lairView.total} {...miniMap(lairNow.def, lairView.cleared, lairView.here)} />
        ) : (
          <span className="ow-remaining" role="status" aria-label={`${waiting.length} questions left`} data-testid="ow-left">
            {waiting.slice(0, 8).map((e) => <Sprite key={e.id} name={entsRef.current.find((x) => x.id === e.id)?.look ?? 'slime'} size={26} />)}
            {waiting.length > 8 ? <b>+{waiting.length - 8}</b> : null}
            {waiting.length === 0 ? <span className="ow-camp-lit" data-testid="camp-lit"><PixelIcon name="flame" size={30} /> Camp is lit!</span> : null}
          </span>
        )}
        {adventureItems.map((id) => <Sprite key={id} name={id} size={28} className="ow-item" />)}
        <MuteButton muted={mute.muted} locked={mute.locked} onToggle={mute.toggle} chimesOnly={mute.chimesOnly} />
      </div>
      <div className="ow-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="ow-canvas" data-testid="ow-canvas" onPointerUp={onCanvasTap} aria-label="The map. Tap a tile to walk there." role="img" />
        {campOpen && !lairNow ? (
          <div className="ow-camp-tray" role="group" aria-label="Your camp" data-testid="camp-tray">
            <button type="button" className={`icon-btn${campTool === 'tent' ? ' is-on' : ''}`} data-testid="camp-tent" aria-label="Tent" aria-pressed={campTool === 'tent'} onClick={() => setCampTool('tent')}>
              <PixelIcon name="tent" size={40} />
              <i className="ow-camp-dots" aria-hidden="true"><b className={tentOf(camp.placed, region) ? 'on' : ''} /></i>
            </button>
            <button type="button" className={`icon-btn${campTool === 'flag' ? ' is-on' : ''}`} data-testid="camp-flag" aria-label={`Flag, ${flagsIn(camp.placed, region)} of ${MAX_FLAGS} in this land`} aria-pressed={campTool === 'flag'} onClick={() => setCampTool('flag')}>
              <PixelIcon name="flag" size={40} />
              <i className="ow-camp-dots" aria-hidden="true">{Array.from({ length: MAX_FLAGS }, (_, i) => <b key={i} className={i < flagsIn(camp.placed, region) ? 'on' : ''} />)}</i>
            </button>
            <button type="button" className={`icon-btn${campTool === 'pick' ? ' is-on' : ''}`} data-testid="camp-pick" aria-label="Pick up" aria-pressed={campTool === 'pick'} onClick={() => setCampTool('pick')}>
              <UiIcon name="close" size={36} />
            </button>
            <button type="button" className="icon-btn ow-camp-done" data-testid="camp-done" aria-label="Done" onClick={() => setCampOpen(false)}>
              <UiIcon name="check" size={36} />
            </button>
          </div>
        ) : null}
        <DoorLabel ref={doorRef} lines={doorLines} prereader={learner === 'prereader'} count={Math.max((stats[region] ?? NO_STATS).beaten, won ? 1 : 0)} />
        {msg ? (
          <div className="ow-msg" role="status" data-testid="ow-msg">
            <div className="ow-msg-body">
            {msg.dots ? (
              <div className="ow-lair" data-testid="ow-lair-dots" role="img" aria-label={msg.dots.count.replace('/', ' of ')}>
                <Sprite name="boss" size={44} />
                <span className="ow-dots">
                  {Array.from({ length: msg.dots.tokens }, (_, i) => <i key={i} className={i < msg.dots!.lit ? 'on' : ''} />)}
                </span>
                <b className="ow-count" data-testid="ow-lair-count">{msg.dots.count}</b>
              </div>
            ) : null}
            {msg.text ? <p>{msg.text}</p> : null}
            {msg.progress !== undefined ? <div className="progress"><div className="progress-fill" style={{ width: `${msg.progress * 100}%` }} /></div> : null}
            </div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setMsg(null)}><UiIcon name="close" size={24} /></button>
          </div>
        ) : null}
      </div>
      {/* The pad sits over the world; a pre-reader's 3 big choices reach the left edge, so the pad hides while one is open. It also hides while the camp tray is open, so every tile can be tapped. */}
      {learner === 'prereader' && (modal || (campOpen && !lairNow)) ? null : (
        <div className="ow-dpad" role="group" aria-label="Walk">
          {(['up', 'left', 'down', 'right'] as Facing[]).map((d) => (
            <button
              key={d}
              type="button"
              className={`ow-dir ow-${d}`}
              aria-label={`Walk ${d}`}
              onPointerDown={hold(d)}
              onPointerUp={hold(null)}
              onPointerLeave={hold(null)}
              onPointerCancel={hold(null)}
            >
              <UiIcon name="arrow-down" size={32} />
            </button>
          ))}
        </div>
      )}
      {modal ? (
        <QuestionPanel
          key={modal.entry.id}
          runner={r}
          entry={modal.entry}
          kid={kid}
          repo={repo}
          learner={learner}
          display="modal"
          onAnswered={onPanelAnswered}
          onResolved={onPanelResolved}
        />
      ) : null}
      {bossHud && modal?.boss ? <BossBar remainingMs={bossHud.remainingMs} budgetMs={bossHud.budgetMs} prereader={learner === 'prereader'} /> : null}
      {overlay ? (
        <div className="question-modal ow-overlay" role="dialog" aria-modal="true" data-testid={`boss-${overlay.kind}`}>
          <PixelFrame tone={overlay.kind === 'win' ? 'gold' : 'neutral'} className="ow-overlay-frame">
            <Sprite name="boss" size={120} />
            <h2 className="pixel">{overlay.kind === 'win' ? (overlay.first ? 'Boss defeated!' : 'Boss beaten again!') : 'The boss drove you out!'}</h2>
            {learner === 'prereader' ? null : (
              <p>
                {overlay.kind === 'win'
                  ? overlay.first
                    ? 'You won a key, a trophy for your camp and gems.'
                    : 'You won gems.'
                  : overlay.why === 'timeout'
                    ? 'Time ran out. The rooms are new. Try again!'
                    : 'Too many wrong answers. The rooms are new. Try again!'}
              </p>
            )}
            <PixelButton
              tone="go"
              size={learner === 'prereader' ? 'prereader' : 'big'}
              data-testid="boss-continue"
              onClick={() => {
                setOverlay(null);
                if (overlay.kind === 'win') leaveLair();
                pausedRef.current = false;
              }}
            >
              {overlay.kind === 'win' ? 'Leave the lair' : 'Try again'}
            </PixelButton>
          </PixelFrame>
        </div>
      ) : null}
    </div>
  );
}

function KeyIcon() {
  return <PixelIcon name="key" size={30} />;
}

