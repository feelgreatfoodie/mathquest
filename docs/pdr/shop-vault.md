# PDR: Hero Shop 2.0 and the Gem Vault
It builds on data-safety (`applyGameDelta`) and the parent-stats and pre-reader shop PR.

## 1. Goal
Give gems more meaningful uses, and teach saving and simple interest. No gambling mechanics and no pressure loops.

## 2. Hero Shop 2.0
### 2.1 Catalog (`src/game/shop/catalog.ts`)
| Category | Examples | What it does | Price range |
| --- | --- | --- | --- |
| Heroes (exists) | knight, wizard, ranger, robot, dragon rider | Changes the avatar | 0 to 100 |
| Weapons | sword, magic wand, bow, hammer, boomerang | Changes the attack animation on a correct answer | 20 to 80 |
| Gear | knight helm, wizard hat, dino hood, cape | Worn on the hero sprite | 10 to 40 |
| Pets | dragon pup, dog, beetle, owl | Follows the hero; cheers on a combo | 60 to 150 |
| Adventure items | lantern (dark forest), boots (walk faster), bridge kit (secret island), keys | Overworld only (Phase 1b) | 30 to 120 |
| Camp decorations | tents, banners, campfire styles, flags | Shown at camp and on home | 10 to 60 |
| Legendary | golden dragon armor, crystal staff | Changes the look | about 300 |

Tiers are tuned to about 8 gems a round: 10–30 is a few rounds, 60–150 about a day, about 300 about a week.

### 2.2 Rules (non-negotiable)
- Nothing for sale makes math easier or changes grading. Help (hints, peek, read-aloud) is always free.
- No random rewards or loot boxes, no time-limited items or sales, no real money, no ads.
- Every price is fixed and shown up front. Gems come only from playing.
- All art is original pixel art. No outside franchise characters or items.

### 2.3 Shop experience
- Tabs (icons only for pre-readers): Heroes, Weapons, Gear, Pets, Adventure, Camp, Vault.
- **Savings goal:** "Save for this" pins an item, and a jar on home shows progress, with voice for pre-readers.
- **Shop math (optional):** "You have 47. The bow costs 60. How many more?" It's a practice card, so the schedule is untouched. A correct answer gives a 1-gem tip. Pre-readers get the same idea with dots, within 10.
- **Equip screen:** slots for hero, weapon, gear and pet. Equipping is free and instant.
- **Buying:** one confirm, then a sparkle and a voice line. Purchases go through `applyGameDelta` and write a purchases log entry.

### 2.4 Data
- `game.owned: string[]`, `game.equipped: {hero, weapon?, gear?, pet?}`.
- Rules:
  - `owned` never loses an entry (it extends the #13 monotonic guard).
  - A gems drop is allowed only with an `owned` addition and a purchases log entry in the same transaction.
- Migration: `heroes` becomes `owned`, and `hero` becomes `equipped.hero`.

## 3. Gem Vault (savings)
### 3.1 How it works
| Term | Bonus | Example |
| --- | --- | --- |
| 3 days | 1 extra for every 10 saved | 30 in, 33 back |
| 7 days | 3 extra for every 10 | 50 in, 65 back |
| 14 days | 7 extra for every 10 | 100 in, 170 back |

- Bonus is rounded down per full 10. Minimum deposit 10, at most 3 deposits active.
- **Break early:** allowed with a picture-and-voice confirm. The gems put in always come back; only the bonus is lost.
- **Calendar days:** the bonus grows whether or not he plays, so there's no pressure to play daily.
- **Matured deposits:** a glowing vault chest on home. Collecting plays a coin shower and the voice line "Your 50 gems grew to 65!"
- **Math tie-in:** an optional deposit question for the older kid ("You save 40 for 7 days, 3 extra for every 10. How many extra?"). Pre-readers get a 3-day vault, "Put in 5, get back 6", shown with dots.

### 3.2 Parent controls
- Vault on or off per kid, with editable rates (defaults as above).
- Optional **Parent match:** the parent adds bonus gems to a deposit.
- Deposit history. The vault balance shows in the stats row next to gems and XP.

### 3.3 Data and integrity
- Path: `families/{uid}/kids/{kidId}/vault/{depositId}`.
- Document: `{amount, termDays, ratePer10, bonus, createdAt (server), maturesAt (server time plus term), status: active|collected|broken, collectedAt}`.
- **Kids change iPad clocks.** Every time check uses `request.time` and server timestamps, never the device clock.
  - A deposit can be collected only if `request.time >= maturesAt`.
  - `bonus == floor(amount/10) * ratePer10`, using the parent's rate at deposit time.
- **Deposit:** one transaction that lowers `game.gems` and creates the vault doc. The gems-drop rule requires the vault doc in the same transaction.
- **Collect:** one transaction that adds amount plus bonus (amount only if broken) and updates the status.
- Rules tests:
  - Collecting early is denied, even with the client clock set forward.
  - A wrong bonus is denied.
  - A gems drop without a vault doc is denied.
  - Breaking early returns exactly the amount.

## 4. Tests and acceptance
- **Unit:** bonus math and rounding; catalog prices within their tiers; migration.
- **Emulator:** an atomic purchase with its log entry; the deposit and drop pairing; early collect denied; break returns the principal; collect after maturity adds the bonus.
- **Playwright, 820×1180, reader and pre-reader:**
  - Buy and equip a weapon, and the attack animation changes.
  - Pin a goal, and the jar updates after a round.
  - Deposit, break, then deposit and collect after an emulator fast-forward.
  - Targets at least 48 px (reader) or 120 px (pre-reader).
- **Manual iPad:** the shop is clear for the younger kid with voice only, and the older kid can explain the 7-day bonus.

## 5. Delivery
- Two PRs: shop-2 (catalog, equip, goal jar, shop math), then vault (vault, parent controls, rules).
- Each ships behind a per-kid parent setting and is turned on for both boys after Flynn's OK.
- Send TENSOR a RESULT with screenshots after each PR.
