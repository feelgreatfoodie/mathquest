import { PixelIcon, PixelMap, PixelPlay } from '../pixel';
import { useState } from 'react';
import { GoalJar, goalName } from '../GoalJar';
import { CampScene } from '../CampScene';
import { TitleBadge } from '../TitleBadge';
import { ShopMathEntry } from '../ShopMathCard';
import type { Repo } from '../../data/repo';
import type { Kid, KidGame } from '../../engine/models';
import { modesOnOf } from '../../engine/models';
import type { GameModeId } from '../../game/modes/types';
import { HeroShop, type OnGame } from '../HeroShop';
import { UiIcon } from '../sprites';
import { looksReady, owedOf, vaultOn } from '../../game/vault';
import { useDeposits, type VaultApi } from '../vaultApi';
import type { GiftApi } from '../giftApi';
import { GiftPresent } from '../GiftUi';
import { HoldButton } from './HoldButton';
import { unlockSounds } from './sounds';
import { speak, unlockSpeech } from './useSpeech';
import { MuteButton, useMute } from '../MuteButton';

const MAX_FLAMES = 7;

/** Home for a pre-reader: the hero, a huge Play triangle, and streak flames. No reading needed. */
export function PrereaderHome({ kid, repo, onStart, onBack, onGame, onTipGame, vault, gift }: { kid: Kid; repo: Repo; onStart: (mode: GameModeId) => void; onBack: () => void; onGame: OnGame; onTipGame?: (game: KidGame) => void; vault?: VaultApi; gift?: GiftApi }) {
  const mute = useMute(kid);
  const [shop, setShop] = useState(false);
  const [shopVault, setShopVault] = useState(false);
  const hasVault = !!vault && vaultOn(kid.settings);
  const dep = useDeposits(vault, hasVault, kid.game.gems);
  const ready = hasVault && dep.deposits.some((d) => (d.status !== 'active' && owedOf(d) > 0) || looksReady(d, Date.now()));
  if (shop) return <HeroShop kid={kid} learner="prereader" onGame={onGame} vault={vault} gift={gift} openVault={shopVault} onClose={() => { setShop(false); setShopVault(false); }} />;
  const adventure = modesOnOf(kid.settings).overworld;
  const flames = Math.min(MAX_FLAMES, kid.game.streakDays);
  return (
    <div className="screen center early-home" aria-label={`${kid.name}'s home`}>
      <div className="early-home-top">
        <HoldButton onHold={onBack}><PixelIcon name="house" size={44} /></HoldButton>
      </div>
      <div className="early-home-mute"><MuteButton muted={mute.muted} locked={mute.locked} onToggle={mute.toggle} big chimesOnly={mute.chimesOnly} /></div>
      <GiftPresent api={gift} learner="prereader" />
      <CampScene game={kid.game} size={200} className="px-camp-wide" />
      <TitleBadge game={kid.game} name={kid.name} picture />
      <div className="early-home-info">
        <GoalJar game={kid.game} learner="prereader" onClick={() => void speak(`Saving for the ${goalName(kid.game.goal ?? '')}! You have ${kid.game.gems}.`)} />
        <ShopMathEntry kid={kid} repo={repo} onGame={onTipGame ?? (() => undefined)} />
      </div>
      <div className="early-home-row">
        <button
          type="button"
          className="play-btn"
          aria-label="Play"
          data-mode="prereader"
          onClick={() => {
            // Audio unlocks inside this tap, so the first question can be spoken.
            unlockSounds();
            unlockSpeech();
            onStart('prereader');
          }}
        >
          <PixelPlay size={150} />
        </button>
        {adventure ? (
          <button
            type="button"
            className="shop-btn adventure-btn"
            aria-label="Adventure"
            data-testid="home-adventure"
            data-mode="overworld"
            onClick={() => {
              unlockSounds();
              unlockSpeech();
              void speak('Adventure!');
              onStart('overworld');
            }}
          >
            <PixelMap size={120} />
          </button>
        ) : null}
        {modesOnOf(kid.settings).lightning ? (
          <button
            type="button"
            className="shop-btn lightning-btn"
            aria-label="Lightning Round"
            data-testid="home-lightning"
            data-mode="lightning"
            onClick={() => {
              unlockSounds();
              unlockSpeech();
              void speak('Lightning!');
              onStart('lightning');
            }}
          >
            <PixelIcon name="bolt" size={96} />
          </button>
        ) : null}
        {ready ? (
          <button
            type="button"
            className="shop-btn vault-glow"
            aria-label="Vault ready"
            data-testid="home-vault-ready"
            onClick={() => {
              unlockSounds();
              unlockSpeech();
              void speak('Your vault is ready!');
              setShopVault(true);
              setShop(true);
            }}
          >
            <PixelIcon name="chest" size={96} />
            <span className="pv-glow" aria-hidden="true"><UiIcon name="sparkle" size={44} /><UiIcon name="sparkle" size={32} /></span>
          </button>
        ) : null}
        <button
          type="button"
          className="shop-btn"
          aria-label="Hero shop"
          onClick={() => {
            unlockSounds();
            unlockSpeech();
            setShopVault(false);
            setShop(true);
          }}
        >
          <PixelIcon name="chest" size={96} />
          <span className="shop-btn-gems"><PixelIcon name="gem" size={36} /><span className="tally-num">{kid.game.gems}</span></span>
        </button>
      </div>
      <div className="flames" role="img" aria-label={`${kid.game.streakDays} day streak`}>
        {Array.from({ length: flames }, (_, i) => <PixelIcon key={i} name="flame" size={44} />)}
        {kid.game.streakDays > MAX_FLAMES ? <span className="flame-count">{kid.game.streakDays}</span> : null}
      </div>
    </div>
  );
}
