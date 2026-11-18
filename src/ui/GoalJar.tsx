import { itemById } from '../game/shop/catalog';
import { goalProgress } from '../game/shop/shopState';
import { HEROES } from '../engine/game';
import type { KidGame } from '../engine/models';
import { Sprite, UiIcon } from './sprites';

interface Props {
  game: Pick<KidGame, 'goal' | 'gems' | 'items' | 'heroes'>;
  /** pre-reader: pictures and numerals only. reader: adds the name and the gems still needed. */
  learner: 'prereader' | 'reader';
  onClick?: () => void;
}

/** The goal name for the voice and the label. */
export function goalName(id: string): string {
  return itemById(id)?.name ?? HEROES.find((h) => h.id === id)?.name ?? id;
}

/** The savings jar: the item the kid picked, a jar that fills with gems, and the numbers. Nothing when no goal is pinned. */
export function GoalJar({ game, learner, onClick }: Props) {
  const g = goalProgress(game);
  if (!g) return null;
  const pct = Math.round(g.fraction * 100);
  const label = `Saving for ${goalName(g.id)}: ${g.have} of ${g.cost} gems`;
  const body = (
    <>
      <span className="jar" aria-hidden="true">
        <span className="jar-fill" style={{ height: `${pct}%` }} />
        <Sprite name={g.id} size={learner === 'prereader' ? 64 : 44} className="jar-item" />
      </span>
      <span className="jar-nums">
        <UiIcon name="gem" size={learner === 'prereader' ? 36 : 22} />
        <span className="tally-num">{g.have}</span>
        <span className="jar-of">/{g.cost}</span>
      </span>
      {learner === 'reader' ? (
        <span className="jar-text">{g.reached ? `You can buy the ${goalName(g.id)}!` : `${g.need} more gems for the ${goalName(g.id)}`}</span>
      ) : null}
    </>
  );
  return (
    <button type="button" className={`goal-jar goal-jar-${learner} ${g.reached ? 'is-ready' : ''}`} data-goal={g.id} data-pct={pct} aria-label={label} onClick={onClick}>
      {body}
    </button>
  );
}
