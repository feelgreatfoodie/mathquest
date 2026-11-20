import type { KidGame } from '../engine/models';
import { titleFor } from '../game/shop/looks';
import { PixelIcon } from './pixel';
import { speak } from './early/useSpeech';

/**
 * The title a legendary item earns ("Sir <name>", "Archmage <name>"), built from the kid's display name at runtime. Nothing shows
 * without a legendary item. A pre-reader gets a star picture in a 120 px button that says the title aloud (silent while muted).
 */
export function TitleBadge({ game, name, picture, className }: { game: Pick<KidGame, 'items' | 'equipped'>; name: string; picture?: boolean; className?: string }) {
  const title = titleFor(game, name);
  if (!title) return null;
  if (picture) {
    return (
      <button type="button" className={`kid-title kid-title-pic ${className ?? ''}`} data-testid="kid-title" aria-label={title} onClick={() => void speak(`${title}!`)}>
        <PixelIcon name="star" size={72} />
      </button>
    );
  }
  return (
    <p className={`pixel kid-title ${className ?? ''}`} data-testid="kid-title">
      <PixelIcon name="star" size={22} /> {title}
    </p>
  );
}
