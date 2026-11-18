import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { learnerOf, type CardMap, type Kid } from '../../engine/models';
import type { Entry, Feedback, SessionRunner } from '../../engine/session';
import { finishRun } from '../../ui/finishRun';
import { reportFailure } from '../../ui/failures';
import { loadRunner, type SaveExtra } from '../../ui/runShared';
import { newId } from '../../data/repo';
import { CHECKPOINT_EVERY, addRun, loadTrip, resolveTrip, saveTrip, type TripState, type TripTotals } from './trip';
import { queueCheckpoint } from './tripWrite';
import { HoldButton } from '../../ui/early/HoldButton';
import { chest as chestSound, defeat, unlockSounds } from '../../ui/early/sounds';
import { speak, unlockSpeech } from '../../ui/early/useSpeech';
import { MuteButton, useMute } from '../../ui/MuteButton';
import { Sprite, UiIcon } from '../../ui/sprites';
import { QuestionPanel } from '../QuestionPanel';
import { ownedItems } from '../shop/shopState';
import type { GameModeProps } from '../modes/types';
import { BOSS_WIN, bossPlan, bossReady, bossReward } from './boss';
import { TILE, drawScene, viewFor, type Scene } from './draw';
import { MAX_VISIBLE, planEntities, retryEntity, type Entity } from './encounters';
import { MAPS, findTiles, heroStart, isWalkable, tileAt, type Point, type RegionId, type WalkCtx } from './maps';
import { approach } from './pathfind';
import { NEXT_REGION, PREV_REGION, REGION_NAMES, gateInfo, lairMessage, regionProgress } from './regions';
import { fromDoc, settleHero, toDoc, worldReducer, type Facing, type WorldAction, type WorldState } from './worldState';

const SPEED = 4; // tiles a second
const BOOT_SPEED = 6;
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

interface Msg {
  text: string;
  progress?: number;
  /** A pre-reader's lair message: a dragon icon and one dot per card, filled for the ready ones. No sentence. */
  dots?: { done: number; total: number };
}

/** The voice. `speak` stays silent while the kid is muted or a parent set voice off. */
function voice(text: string) {
  void speak(text);
}

export const CAMP_VOICE = 'Walk to the campfire to finish your trip!';
export const COMING_SOON_VOICE = 'More lands are coming soon!';
export const LAIR_VOICE = 'Wake the dragon! Answer the facts.';

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
  const entsRef = useRef<Entity[]>([]);
  const known = useRef(new Set<string>());
  const bossIds = useRef(new Set<string>());
  const bossRun = useRef<{ entries: Entry[]; idx: number; correct: number } | null>(null);
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
  const [overlay, setOverlay] = useState<null | 'win' | 'lose'>(null);
  const [hud, setHud] = useState<Hud>({ left: 0, lit: false });
  const [keys, setKeys] = useState(0);
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

  const walkCtx = useCallback((): WalkCtx => {
    const w = worldRef.current!;
    const next = NEXT_REGION[w.region];
    return { gateOpen: next ? gateInfo(next, liveCards(), kidRef.current.settings).open : false, hasKey: gearRef.current.key, hasBridgeKit: gearRef.current.bridge };
  }, [liveCards]);

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
  const placeEntities = useCallback(() => {
    const r = runnerRef.current!;
    const w = worldRef.current!;
    const pendingIds = new Set(r.pending().map((e) => e.id));
    const entries = r.queue.filter((e) => (e.kind === 'teach' ? r.queue.some((g) => g.kind === 'graded' && g.cardId === e.cardId && pendingIds.has(g.id)) : pendingIds.has(e.id)));
    entsRef.current = planEntities({
      entries,
      map: MAPS[w.region],
      hero: { x: hero.current.x, y: hero.current.y },
      openedChests: w.openedChests,
      rng: Math.random,
      ctx: walkCtx(),
      skip: [...bossIds.current],
    });
    for (const q of r.queue) known.current.add(q.id);
  }, [walkCtx]);

  const revealWaiting = useCallback(() => {
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
        const w0 = fromDoc(stored, Date.now());
        const w = settleHero(w0);
        runnerRef.current = runner;
        // The trip: resume an open one under 24 h old, else start a new one (and close the expired one as 'left').
        const { trip, close } = resolveTrip(loadTrip(kidRef.current.id), Date.now(), newId);
        tripRef.current = trip;
        baseRef.current = trip.totals;
        cpAnswered.current = trip.totals.answered;
        cpGraded.current = trip.totals.graded;
        if (close) sendCheckpoint(close, close.totals, w0.region, 'left');
        saveTrip(kidRef.current.id, trip);
        cardsRef.current = cards;
        startedAt.current = at;
        worldRef.current = w;
        hero.current = { ...hero.current, x: w.x, y: w.y, fx: w.x, fy: w.y, facing: w.facing };
        setRegion(w.region);
        setKeys(w.keys);
        placeEntities();
        refreshHud();
        setLoaded(true);
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

  const startBoss = useCallback(() => {
    const r = runnerRef.current!;
    const w = worldRef.current!;
    const cards = liveCards();
    if (w.bossesDefeated.includes(w.region)) return say({ text: 'The lair is quiet. You already won here.' });
    if (!bossReady(w.region, cards)) {
      const p = regionProgress(w.region, cards);
      // N and the bar use the larger of the two counts (reviewing, steady). A pre-reader gets the icon, the dots and the voice.
      if (learner === 'prereader') {
        voice(LAIR_VOICE);
        return say({ text: '', dots: { done: p.done, total: p.total } });
      }
      return say({ text: lairMessage(w.region, p.done, p.total), progress: p.share });
    }
    const plan = bossPlan({ region: w.region, cards, now: Date.now(), rng: Math.random });
    if (!plan.length) return say({ text: 'Nothing to fight yet.' });
    const entries = r.append(plan).filter((e) => e.kind !== 'teach');
    for (const e of entries) {
      bossIds.current.add(e.id);
      known.current.add(e.id);
    }
    bossRun.current = { entries, idx: 0, correct: 0 };
    pathRef.current = [];
    heldRef.current = null;
    pausedRef.current = true;
    setMsg(null);
    setModal({ entry: entries[0]!, boss: true });
    refreshHud();
  }, [liveCards, say, refreshHud, learner]);

  const gateMessage = useCallback(() => {
    const w = worldRef.current!;
    const next = NEXT_REGION[w.region];
    if (!next) {
      // The last region: the gate is a closed door with nothing behind it yet.
      voice(COMING_SOON_VOICE);
      return say({ text: learner === 'prereader' ? 'Coming soon' : 'More lands coming soon' });
    }
    const info = gateInfo(next, liveCards(), kidRef.current.settings);
    say({ text: `The gate to the ${REGION_NAMES[next]} is locked: ${info.label}`, progress: info.total ? info.learned / info.total : 0 });
  }, [liveCards, say, learner]);

  const onArrive = useCallback(() => {
    const w = worldRef.current!;
    const h = hero.current;
    const map = MAPS[w.region];
    touchWorld({ t: 'move', x: h.x, y: h.y, facing: h.facing });
    const here = entsRef.current.find((e) => e.shown && e.x === h.x && e.y === h.y);
    if (here) return openEntity(here);
    const tile = tileAt(map, h.x, h.y);
    if (tile === 'gate') {
      const to = NEXT_REGION[w.region];
      if (to) return changeRegion(to, w.region);
    }
    if (tile === 'back') {
      const to = PREV_REGION[w.region];
      if (to) return changeRegion(to, w.region);
    }
    if (tile === 'camp') {
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
  }, [touchWorld, openEntity, changeRegion, finishTrip, say, startBoss, gateMessage]);

  const resolveEntity = useCallback(
    (entity: Entity, fb: Feedback) => {
      const r = runnerRef.current!;
      entsRef.current = entsRef.current.filter((e) => e.id !== entity.id);
      const entry = r.queue.find((q) => q.id === entity.id)!;
      if (entity.kind === 'chest') {
        touchWorld({ t: 'chest', cardId: entity.cardId });
        chestSound();
        if (fb.verdict === 'correct' && entry.kind === 'graded') void grant(1);
      } else if (fb.verdict === 'correct') {
        defeat();
      }
      // A miss queued a retry: it comes back as the same monster within 3 tiles.
      const fresh = r.queue.filter((q) => !known.current.has(q.id));
      for (const q of fresh) {
        known.current.add(q.id);
        entsRef.current.push(
          retryEntity({ prev: entity, entry: q, map: MAPS[worldRef.current!.region], taken: entsRef.current, rng: Math.random, ctx: walkCtx() }),
        );
      }
      revealWaiting();
      refreshHud();
      pausedRef.current = false;
      setModal(null);
    },
    [touchWorld, grant, walkCtx, revealWaiting, refreshHud],
  );

  const resolveBoss = useCallback(
    (fb: Feedback) => {
      const r = runnerRef.current!;
      const run = bossRun.current!;
      if (fb.verdict === 'correct') run.correct++;
      for (const q of r.queue) {
        if (!known.current.has(q.id)) {
          known.current.add(q.id);
          bossIds.current.add(q.id); // a boss retry stays out of the map
        }
      }
      run.idx++;
      if (run.idx < run.entries.length) return setModal({ entry: run.entries[run.idx]!, boss: true });
      bossRun.current = null;
      const needed = Math.min(BOSS_WIN, run.entries.length);
      const win = run.correct >= needed;
      const w = worldRef.current!;
      if (win) {
        // Read the reward before the world records the win: a lair already on the list pays 0 gems.
        const reward = bossReward(w, w.region);
        touchWorld({ t: 'boss', region: w.region });
        setKeys(worldRef.current!.keys);
        if (reward.gems > 0) void grant(reward.gems);
        defeat();
        void flushWorld();
      }
      refreshHud();
      setModal(null);
      setOverlay(win ? 'win' : 'lose');
    },
    [touchWorld, grant, flushWorld, refreshHud],
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
      const w = worldRef.current!;
      const h = hero.current;
      const d = DIRS[dir];
      const to = { x: h.x + d.x, y: h.y + d.y };
      h.facing = dir;
      const map = MAPS[w.region];
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
    [startBoss, gateMessage, walkCtx],
  );

  const tapTile = useCallback(
    (p: Point) => {
      if (pausedRef.current || !worldRef.current) return;
      unlockSounds();
      const w = worldRef.current;
      const map = MAPS[w.region];
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
    [walkCtx, say, startBoss, gateMessage],
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
          const speed = gearRef.current.boots ? BOOT_SPEED : SPEED;
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
    const draw = (time: number) => {
      const canvas = canvasRef.current;
      const w = worldRef.current;
      if (!canvas || !w) return;
      const g = canvas.getContext('2d');
      if (!g) return;
      const map = MAPS[w.region];
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
        gateOpen: walkCtxCache(),
        campLit: hudLit.current,
        bossDefeated: w.bossesDefeated.includes(w.region),
        hasKey: gearRef.current.key,
        hasBridgeKit: gearRef.current.bridge,
        lantern: gearRef.current.lantern,
        time,
        marker: markerRef.current,
      };
      drawScene(g, canvas.width, canvas.height, scale, scene);
      viewScale.current = scale;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, beginStep, onArrive]);

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

  // A read and drive hook for the Playwright specs. It exists only in the dev server (import.meta.env.DEV), never in a build.
  useEffect(() => {
    if (!loaded || !import.meta.env.DEV) return;
    const w = window as unknown as { __ow?: unknown };
    w.__ow = {
      state: () => ({
        region: worldRef.current!.region,
        hero: { x: hero.current.x, y: hero.current.y },
        moving: !!hero.current.moving || pathRef.current.length > 0,
        entities: entsRef.current.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, shown: e.shown, cardId: e.cardId })),
        world: worldRef.current,
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
        const { t, left, top } = viewFor(canvas.width, canvas.height, viewScale.current, { x: h.fx, y: h.fy }, MAPS[worldRef.current!.region]);
        return { x: rect.left + ((x + 0.5) * t - left) / ratio, y: rect.top + ((y + 0.5) * t - top) / ratio };
      },
    };
    return () => {
      delete w.__ow;
    };
  }, [loaded, tapTile]);

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
    const map = MAPS[w.region];
    const h = hero.current;
    const { t, left, top } = viewFor(canvas.width, canvas.height, viewScale.current, { x: h.fx, y: h.fy }, map);
    const tile = { x: Math.floor(((e.clientX - rect.left) * ratio + left) / t), y: Math.floor(((e.clientY - rect.top) * ratio + top) / t) };
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

  return (
    <div className={`screen overworld${learner === 'prereader' ? ' ow-pre' : ''}`} data-testid="overworld" data-region={region}>
      <div className="ow-hud">
        <HoldButton onHold={() => void finishTrip()} ms={CAMP_HOLD_MS} label="Hold to go to camp">
          <UiIcon name="house" size={44} />
        </HoldButton>
        <span className="ow-hearts" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i}>♥</i>)}</span>
        <span className="ow-stat" aria-label={`${kid.game.gems} gems`}><UiIcon name="gem" size={30} /><b>{kid.game.gems}</b></span>
        <span className="ow-stat" aria-label={`${keys} keys`} data-testid="ow-keys"><KeyIcon /><b>{keys}</b></span>
        <span className="ow-remaining" role="status" aria-label={`${waiting.length} questions left`} data-testid="ow-left">
          {waiting.slice(0, 8).map((e) => <Sprite key={e.id} name={entsRef.current.find((x) => x.id === e.id)?.look ?? 'slime'} size={26} />)}
          {waiting.length > 8 ? <b>+{waiting.length - 8}</b> : null}
          {waiting.length === 0 ? <span className="ow-camp-lit" data-testid="camp-lit"><UiIcon name="flame" size={30} /> Camp is lit!</span> : null}
        </span>
        {adventureItems.map((id) => <Sprite key={id} name={id} size={28} className="ow-item" />)}
        <MuteButton muted={mute.muted} locked={mute.locked} onToggle={mute.toggle} chimesOnly={mute.chimesOnly} />
      </div>
      <div className="ow-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="ow-canvas" data-testid="ow-canvas" onPointerUp={onCanvasTap} aria-label="The map. Tap a tile to walk there." role="img" />
        {msg ? (
          <div className="ow-msg" role="status" data-testid="ow-msg">
            {msg.dots ? (
              <div className="ow-lair" data-testid="ow-lair-dots" role="img" aria-label={`${msg.dots.done} of ${msg.dots.total} ready`}>
                <Sprite name="boss" size={44} />
                <span className="ow-dots">
                  {Array.from({ length: msg.dots.total }, (_, i) => <i key={i} className={i < msg.dots!.done ? 'on' : ''} />)}
                </span>
              </div>
            ) : null}
            {msg.text ? <p>{msg.text}</p> : null}
            {msg.progress !== undefined ? <div className="progress"><div className="progress-fill" style={{ width: `${msg.progress * 100}%` }} /></div> : null}
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setMsg(null)}><UiIcon name="close" size={24} /></button>
          </div>
        ) : null}
      </div>
      {/* The pad sits over the world; a pre-reader's 3 big choices reach the left edge, so the pad hides while one is open. */}
      {learner === 'prereader' && modal ? null : (
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
          onResolved={onPanelResolved}
        />
      ) : null}
      {overlay ? (
        <div className="question-modal ow-overlay" role="dialog" aria-modal="true" data-testid={`boss-${overlay}`}>
          <div className="panel">
            <Sprite name="boss" size={120} />
            <h2 className="pixel">{overlay === 'win' ? 'Boss defeated!' : 'Not this time'}</h2>
            <p>{overlay === 'win' ? 'You won a key and some gems.' : 'The boss keeps its lair. Try again on your next trip.'}</p>
            <button
              type="button"
              className="btn btn-big"
              onClick={() => {
                setOverlay(null);
                pausedRef.current = false;
              }}
            >
              Keep exploring
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function KeyIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="12" r="4.5" fill="#facc15" stroke="#a16207" strokeWidth="1.5" />
      <path d="M12 12h10v4M18 12v3" fill="none" stroke="#a16207" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

