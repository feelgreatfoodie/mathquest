import { useCallback, useEffect, useState } from 'react';
import type { Repo } from '../data/repo';
import type { CardMap, Kid, Learner, SessionLog } from '../engine/models';
import type { WorldState } from '../game/overworld/worldState';
import type { RegionId } from '../game/overworld/maps';
import { buildTrophyRoom, type TrophyItem, type TrophyRoomModel } from '../game/trophyRoom';
import { LEGENDARY_ARMOR } from '../game/shop/looks';
import { speak } from './early/useSpeech';
import { useMute } from './MuteButton';
import { PixelIcon, PixelButton } from './pixel';
import { Sprite, UiIcon } from './sprites';

// The trophy room (item powers PDR section 5). Read-only: it reads sessions, the world save and the cards, and writes nothing. A
// load that fails shows a retry line, never a zero. No price shows anywhere. A pre-reader gets pictures, numerals and a voice line
// on every tap (silent while muted or while a parent turned the voice off), each target 120 px or more.

interface Loaded {
  logs: SessionLog[];
  world: WorldState | null;
  cards: CardMap;
}

type Load = { s: 'loading' } | { s: 'error' } | { s: 'ready'; d: Loaded };

function useTrophyData(repo: Repo, kidId: string): { load: Load; retry: () => void } {
  const [load, setLoad] = useState<Load>({ s: 'loading' });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setLoad({ s: 'loading' });
    void Promise.all([repo.listSessions(kidId, 500), repo.loadWorld(kidId), repo.loadCards(kidId)])
      .then(([logs, world, cards]) => live && setLoad({ s: 'ready', d: { logs, world, cards } }))
      .catch(() => live && setLoad({ s: 'error' }));
    return () => {
      live = false;
    };
  }, [repo, kidId, n]);
  return { load, retry: useCallback(() => setN((v) => v + 1), []) };
}

const REGION_NAME: Record<RegionId, string> = { meadow: 'Meadow', forest: 'Forest', castle: 'Castle' };
const CUP_TONE: Record<RegionId, { c: string; d: string }> = {
  meadow: { c: '#4ade80', d: '#15803d' },
  forest: { c: '#22c55e', d: '#14532d' },
  castle: { c: '#c084fc', d: '#6b21a8' },
};

/** A lair trophy: a stand, and a cup on it from the first boss win. Original 12x12 pixel art. */
export function TrophyCup({ region, earned, size }: { region: RegionId; earned: boolean; size: number }) {
  const t = CUP_TONE[region];
  const cup = ['..cccccccc..', '.dcCCCCCCcd.', 'dd.cCCCCc.dd', 'd..cCCCCc..d', '...ccCCcc...', '....cccc....', '.....cc.....', '.....cc.....'];
  const stand = ['....kkkk....', '...kKKKKk...', '..kKKKKKKk..', '.kkkkkkkkkk.'];
  const rows = earned ? [...cup, ...stand] : ['............', '............', '............', '............', '............', '............', '............', '............', ...stand];
  const pal: Record<string, string> = { c: t.c, C: '#ffffff55', d: t.d, k: '#374151', K: '#6b7280' };
  return (
    <svg className={`trophy-cup ${earned ? 'is-earned' : 'is-empty'}`} width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) => (pal[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={pal[ch]} /> : null)),
      )}
    </svg>
  );
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function lairLine(l: TrophyRoomModel['lairs'][number]): string {
  if (!l.earned) return `The ${REGION_NAME[l.region]} lair is not beaten yet.`;
  const times = `${l.beaten} ${l.beaten === 1 ? 'time' : 'times'}`;
  return `${REGION_NAME[l.region]} lair. Beaten ${times}.${l.bestMs ? ` Best time ${Math.round(l.bestMs / 1000)} seconds.` : ''}`;
}

function ItemTile({ item, learner }: { item: TrophyItem; learner: Learner }) {
  const label = item.owned ? item.name : `${item.name}, not yours yet`;
  const body = (
    <>
      <Sprite name={item.id} size={learner === 'prereader' ? 88 : 48} className={item.owned ? undefined : 'trophy-silhouette'} />
      {learner === 'prereader' ? (item.owned ? <UiIcon name="check" size={32} /> : null) : <span className="trophy-item-name">{item.owned ? item.name : '?'}</span>}
    </>
  );
  if (learner === 'prereader') {
    return (
      <button type="button" className={`trophy-item ${item.owned ? 'is-owned' : 'is-empty'}`} data-item={item.id} data-owned={item.owned ? 'yes' : 'no'} aria-label={label} onClick={() => void speak(item.owned ? `${item.name}!` : `A ${item.name}. You do not have it yet.`)}>
        {body}
      </button>
    );
  }
  return (
    <li className={`trophy-item ${item.owned ? 'is-owned' : 'is-empty'}`} data-item={item.id} data-owned={item.owned ? 'yes' : 'no'} aria-label={label}>
      {body}
    </li>
  );
}

type PSection = 'lairs' | 'things' | 'counts';

export function TrophyRoom({ kid, repo, learner, onClose }: { kid: Kid; repo: Repo; learner: Learner; onClose: () => void }) {
  useMute(kid); // applies the parent's voice and sound settings to speak()
  const { load, retry } = useTrophyData(repo, kid.id);
  const [cat, setCat] = useState(0);
  const [section, setSection] = useState<PSection>('lairs');
  const pre = learner === 'prereader';
  const room = load.s === 'ready' ? buildTrophyRoom({ game: kid.game, name: kid.name, settings: kid.settings, world: load.d.world, logs: load.d.logs, cards: load.d.cards }) : null;
  const category = room?.categories[cat] ?? room?.categories[0];

  const back = pre ? (
    <button type="button" className="trophy-back" aria-label="Home" data-testid="trophy-back" onClick={onClose}><UiIcon name="house" size={72} /></button>
  ) : (
    <PixelButton className="btn trophy-back" data-testid="trophy-back" onClick={onClose}>Home</PixelButton>
  );

  const status =
    load.s === 'loading' ? (
      <p className="trophy-status muted" role="status" data-testid="trophy-loading">{pre ? '…' : 'Loading your trophies…'}</p>
    ) : load.s === 'error' ? (
      <div className="trophy-status" role="alert" data-testid="trophy-error">
        {pre ? null : <p>Could not load your trophies.</p>}
        <button type="button" className={pre ? 'trophy-retry' : 'btn trophy-retry'} aria-label="Try again" data-testid="trophy-retry" onClick={() => { retry(); if (pre) void speak('Try again.'); }}>
          {pre ? <UiIcon name="refresh" size={72} /> : 'Try again'}
        </button>
      </div>
    ) : null;

  const lairs = room ? (
    <div className="trophy-lairs" data-testid="trophy-lairs">
      {room.lairs.map((l) => {
        const inner = (
          <>
            <TrophyCup region={l.region} earned={l.earned} size={pre ? 88 : 64} />
            {pre ? (l.earned ? <span className="tally-num">×{l.beaten}</span> : null) : (
              <>
                <span className="pixel small">{REGION_NAME[l.region]}</span>
                <span className="trophy-lair-line">{l.earned ? `Beaten ${l.beaten} ${l.beaten === 1 ? 'time' : 'times'}` : 'Not beaten yet'}</span>
                {l.earned && l.bestMs ? <span className="trophy-lair-line muted">Best time {seconds(l.bestMs)}</span> : null}
              </>
            )}
          </>
        );
        return pre ? (
          <button key={l.region} type="button" className={`trophy-lair ${l.earned ? 'is-earned' : 'is-empty'}`} data-region={l.region} data-earned={l.earned ? 'yes' : 'no'} aria-label={lairLine(l)} onClick={() => void speak(lairLine(l))}>{inner}</button>
        ) : (
          <div key={l.region} className={`trophy-lair px-frame ${l.earned ? 'is-earned' : 'is-empty'}`} data-region={l.region} data-earned={l.earned ? 'yes' : 'no'}>{inner}</div>
        );
      })}
    </div>
  ) : null;

  const counts = room ? (
    <div className="trophy-counts" data-testid="trophy-counts">
      {(
        [
          { id: 'chests', n: room.counts.chests, label: 'Chests opened', say: `You opened ${room.counts.chests} ${room.counts.chests === 1 ? 'chest' : 'chests'}.`, icon: <PixelIcon name="chest" size={pre ? 64 : 28} /> },
          { id: 'bosses', n: room.counts.bosses, label: 'Bosses beaten', say: `You beat ${room.counts.bosses} ${room.counts.bosses === 1 ? 'boss' : 'bosses'}.`, icon: <Sprite name="skeleton" size={pre ? 64 : 28} /> },
          { id: 'fluent', n: room.counts.fluent, label: 'Facts at Fluent', say: `${room.counts.fluent} ${room.counts.fluent === 1 ? 'fact' : 'facts'} you know fast.`, icon: <PixelIcon name="star" size={pre ? 64 : 28} /> },
        ] as const
      ).map((c) =>
        pre ? (
          <button key={c.id} type="button" className="trophy-count" data-count={c.id} data-value={c.n} aria-label={`${c.label}: ${c.n}`} onClick={() => void speak(c.say)}>
            {c.icon}<span className="tally-num">{c.n}</span>
          </button>
        ) : (
          <div key={c.id} className="trophy-count px-frame" data-count={c.id} data-value={c.n}>
            {c.icon}<span className="stat-value">{c.n}</span><span className="stat-label">{c.label}</span>
          </div>
        ),
      )}
    </div>
  ) : null;

  const titles = room && room.titles.length ? (
    <div className="trophy-titles" data-testid="trophy-titles">
      {room.titles.map((t) =>
        pre ? (
          <button key={t} type="button" className="trophy-title kid-title-pic" data-testid="trophy-title" aria-label={t} onClick={() => void speak(`${t}!`)}>
            <PixelIcon name="star" size={64} />
            <Sprite name={t.startsWith('Sir ') ? LEGENDARY_ARMOR : 'w-crystalstaff'} size={64} />
          </button>
        ) : (
          <p key={t} className="pixel kid-title trophy-title" data-testid="trophy-title"><PixelIcon name="star" size={22} /> {t}</p>
        ),
      )}
    </div>
  ) : null;

  const tabs = room ? (
    <div className="trophy-tabs" role="tablist" aria-label="Trophy items">
      {room.categories.map((c, i) => {
        const own = c.items.filter((x) => x.owned).length;
        return (
          <button key={c.category} type="button" role="tab" aria-selected={cat === i} aria-label={`${c.label}, ${own} of ${c.items.length}`} data-tab={c.category} className={`trophy-tab ${cat === i ? 'is-on' : ''}`} onClick={() => { setCat(i); if (pre) void speak(c.label); }}>
            {pre ? <CategoryPicture id={c.items[0]!.id} /> : <><span>{c.label}</span><span className="muted trophy-tab-n">{own}/{c.items.length}</span></>}
          </button>
        );
      })}
    </div>
  ) : null;

  const items = category ? (
    pre ? (
      <div className="trophy-items" role="tabpanel" data-testid="trophy-items">{category.items.map((i) => <ItemTile key={i.id} item={i} learner={learner} />)}</div>
    ) : (
      <ul className="trophy-items" role="tabpanel" data-testid="trophy-items">{category.items.map((i) => <ItemTile key={i.id} item={i} learner={learner} />)}</ul>
    )
  ) : null;

  if (pre) {
    const secs: { id: PSection; icon: React.ReactNode; say: string }[] = [
      { id: 'lairs', icon: <TrophyCup region="forest" earned size={72} />, say: 'Lairs' },
      { id: 'things', icon: <Sprite name="w-sword" size={72} />, say: 'Your things' },
      { id: 'counts', icon: <PixelIcon name="star" size={72} />, say: 'Your numbers' },
    ];
    return (
      <div className="screen center trophy trophy-pre" data-testid="trophy-room" aria-label="Trophy room">
        <div className="trophy-rail">
          {back}
          <div className="trophy-sections" role="tablist" aria-label="Trophy room sections">
            {secs.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={section === s.id} aria-label={s.say} data-section={s.id} className={`trophy-section ${section === s.id ? 'is-on' : ''}`} onClick={() => { setSection(s.id); void speak(s.say); }}>
                {s.icon}
              </button>
            ))}
          </div>
        </div>
        <div className="trophy-body">
          {status}
          {room && section === 'lairs' ? lairs : null}
          {room && section === 'things' ? <>{tabs}{items}</> : null}
          {room && section === 'counts' ? <>{counts}{titles}</> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="screen center trophy trophy-reader" data-testid="trophy-room" aria-label="Trophy room">
      <div className="trophy-bar">
        {back}
        <h1 className="pixel">Trophy room</h1>
      </div>
      <div className="trophy-body">
        {status}
        {room ? (
          <>
            {lairs}
            {titles}
            {counts}
            {tabs}
            {items}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The first item of a category, as its tab picture. */
function CategoryPicture({ id }: { id: string }) {
  return <Sprite name={id} size={72} />;
}
