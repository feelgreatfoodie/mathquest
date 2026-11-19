# Math Quest PDR: item powers, gifting, selling and the trophy room

Approved by Flynn on 2026-11-18. Builds on shop-2 (#24), the gem economy (#23), purchase-backed gem drops (#16), Adventure (#29 and later) and the lairs (m8lX).

## 1. Rules for every item power
1. **Nothing makes the math easier.** No power skips a question, shows an answer, adds time or changes grading. Powers change movement, discovery, looks and fun.
2. **Gems stay honest.** Any gem a power produces goes through `gemGrant` and the daily throttle. Every gem drop has a purchase or sale record in the same write (#16).
3. **Owned items only.** Each power works only while its item is owned. Pets and wearables work only while equipped.
4. **Pre-readers get every power** with voice lines (respecting mute), picture cues and targets of 120 px or more.
5. **Original art only.**

## 2. Powers
- **Dog (pet):** sniffs out 1 hidden bonus chest per trip. The dog runs ahead and barks near it. The chest uses the chests-every-trip fill order.
- **Owl (pet):** shows lair readiness on the map. A ring around each lair door fills as the region's facts reach the lair rule. Read-only; uses `bossReady` progress.
- **Beetle (pet):** digs up 1 gem per trip at a random grass tile, through `gemGrant` and the throttle.
- **Dragon Pup (pet):** breathes fire on the boss after each right boss answer, with a special animation. It cheers at combos of 5, 10 and 20. Animation only.
- **Key (adventure):** opens locked side rooms (`D` door tiles) in regions and lairs. The rooms hold 1 to 2 chests or a shortcut. `a-key` already feeds `walkCtx.hasKey`. Each region gets at least 1 door.
- **Lantern:** lights dark rooms in the Castle lair. One dark room hides a secret room with a chest. Without the lantern the room is dark but walkable, and the chest stays hidden.
- **Bridge Kit:** builds the bridge to the pond island (`bb` tiles) and its chest in each region. `a-bridge` already feeds `walkCtx.hasBridgeKit`.
- **Fast Boots:** walks 1.5 times faster on maps. The question clock runs only while a question shows, so speed never touches timing.
- **Bow (weapon):** tap a monster up to 3 tiles away to start the encounter without walking to it.
- **Boomerang (weapon):** on a 5-answer streak, the next right answer also clears 1 nearby monster. That monster's question is still asked next; it saves walking, not questions.
- **Sword, Wand, Hammer:** keep distinct strike animations and sounds on right answers (already in shop-2).
- **Cape, Helm, Wizard Hat, Dino Hood:** change the hero's look on the map, in the lair and on Home. The Dino Hood adds a roar on boss wins.
- **Golden Dragon Armor, Crystal Staff:** a glowing hero, and a title shown on Home and the end screen. Owning either unlocks a title, for example "Sir <kid display name>" or "Archmage <kid display name>". Never hard-code the boys' names; use the kid's display name at runtime.

## 3. Gifting
- A kid can buy an item from the shop as a gift for a sibling in the same family.
- The giver pays the price. The item goes into the receiver's `owned` with `giftFrom: kidId`.
- One transaction: a purchase record on the giver (`kind: 'gift'`, `to`, `itemId`, `cost`) and a gift record on the receiver.
- The receiver sees a wrapped present on their next Home load: "A gift from <sibling>!" (voice for pre-readers).
- It can't be gifted if the receiver already owns the item.
- Parent setting per family: gifting on or off (default on). The parent area shows the gift history.
- Rules: the cross-kid write is allowed only within the same family uid, only for a catalog item and only with a matching purchase record. Add emulator tests.

## 4. Selling back
- Any owned shop item can be sold back for half its price, rounded down. Heroes and legendary items can't be sold.
- One confirm step: "Sell the Bow for 27 gems?" Pre-readers see a big gem-and-check confirm.
- It writes a sale record (`kind: 'sale'`, `itemId`, `refund`) in the same transaction. The gem rise and the removal from `owned` are legal only with that record. (The heroes-never-shrink rule from #13 stays for heroes.)
- The item is unequipped first. A gifted item can't be sold for 7 days.
- Selling never counts toward the daily gem throttle.
- Parent setting: selling on or off (default on).

## 5. Trophy room
- A "Trophy room" screen off Home shows:
  - lair trophies (one per region, from the first boss win), with the win count and best time
  - every owned item grouped by category, with empty silhouettes for unowned ones (no prices here)
  - titles earned
  - the counts of chests opened, bosses beaten and facts reaching Fluent
- Read-only. A pre-reader version uses pictures and voice.

## 6. Delivery (separate PRs, each deployable)
1. **item-powers-map:** key doors, the bridge-kit island and Fast Boots in the regions. The lantern dark rooms ship with the lairs (m8lX).
2. **item-powers-pets:** Dog, Owl, Beetle, Dragon Pup.
3. **item-powers-weapons-looks:** Bow range, Boomerang, wearables on the hero sprite, legendary glow and titles.
4. **gifting:** rules, UI and parent setting (needs the 3-reviewer security check).
5. **sell-back:** rules, UI and parent setting (needs the 3-reviewer security check).
6. **trophy-room.**

Each PR includes engine and rules tests, Playwright at 820×1180, 1024×768 and 393×852, the golden profile, the PR-text name scan, and a RESULT to TENSOR with screenshots.

## 7. Order in the queue
After the current fixes (F8yj fit, 96Gt mute, PvLo every answer counts, XF1S chests) and after the lairs (m8lX) and map camp (ZKvZ). Before or alongside the Lightning Round (1Chbh), at VECTOR's judgment.
