// Usernames a grown-up may not claim. Two lists, both checked by claimUsername() in core.ts.
//
// IMPERSONATION: a name that, with digits and underscores removed, equals one of these (admin, admin_01, Teacher7)
// or contains MQ_BRAND would let a player pose as staff on a printed card or a portal list.
// OFFENSIVE: a short list of words that must not show up on a child's sign-in card. Matching runs on the name
// after look-alike digits become letters (b00b -> boob) and underscores go, and it matches inside a word, so a
// few harmless names are refused too. A refused name costs a grown-up one retry, and a missed word costs a child's card.

export const IMPERSONATION = ['admin', 'administrator', 'teacher', 'grownup', 'grownups', 'parent', 'parents', 'moderator', 'mod', 'staff', 'support', 'root', 'system', 'owner', 'guest', 'anonymous', 'null', 'undefined'];

export const MQ_BRAND = 'mathquest';

export const OFFENSIVE = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'penis', 'vagina', 'boob', 'tits', 'whore', 'slut', 'bastard', 'asshole',
  'piss', 'nazi', 'hitler', 'rapist', 'porn', 'nigg', 'fagg', 'retard', 'suicide', 'dildo',
];

const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's' };

/** Lowercase, look-alike digits to letters, underscores out. */
export function foldLookalikes(lower: string): string {
  return [...lower].map((ch) => LOOKALIKE[ch] ?? ch).filter((ch) => ch !== '_').join('');
}

/** Why a lowercased username is refused, or null when it is allowed. */
export function reservedReason(lower: string): 'impersonation' | 'offensive' | null {
  const lettersOnly = lower.replace(/[0-9_]/g, '');
  if (IMPERSONATION.includes(lettersOnly) || foldLookalikes(lower).includes(MQ_BRAND) || lettersOnly.includes(MQ_BRAND)) return 'impersonation';
  const folded = foldLookalikes(lower);
  if (OFFENSIVE.some((w) => folded.includes(w) || lettersOnly.includes(w))) return 'offensive';
  return null;
}
