import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs module without type declarations
import { allowlistProblems, envAllowlist, rulesAllowlist } from './allowlist.mjs';

const rules = (list: string, comment = '') => `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function allowedAccount() {
${comment}      return request.auth.token.email_verified == true
        && request.auth.token.email in [${list}];
    }
  }
}
`;
const REAL = "'mom@family.test', 'dad@family.test'";
const ENV = 'ALLOWED_EMAILS=mom@family.test,dad@family.test\n';

describe('deploy allowlist guard', () => {
  it('accepts real, matching lists', () => {
    expect(allowlistProblems(rules(REAL), ENV)).toEqual([]);
    expect(allowlistProblems(rules(REAL), null)).toEqual([]);
  });

  it('reads the active list and skips a commented-out example list (the 11-17 lockout)', () => {
    const text = rules(REAL, "    //     && request.auth.token.email in ['someone@else.test'];\n");
    expect(rulesAllowlist(text)).toEqual(['mom@family.test', 'dad@family.test']);
  });

  it('rejects the numbered placeholders that locked the parent out on 11-17', () => {
    const p = allowlistProblems(
      rules("'parent1@example.com', 'parent2@example.com'"),
      'ALLOWED_EMAILS=parent1@example.com,parent2@example.com\n',
    );
    expect(p.length).toBeGreaterThan(0);
    expect(p.join(' ')).toMatch(/placeholder|@example/);
  });

  it('rejects any @example address, even in a comment', () => {
    const text = rules(REAL, "    //     && request.auth.token.email in ['parent1@example.com'];\n");
    expect(allowlistProblems(text, ENV).join(' ')).toMatch(/@example/);
  });

  it('rejects the original single placeholder', () => {
    expect(allowlistProblems(rules("'parent@example.com'"), null).length).toBeGreaterThan(0);
  });

  it('rejects an empty or missing ALLOWED_EMAILS and an empty rules list', () => {
    expect(envAllowlist('OTHER=1\n')).toEqual([]);
    expect(allowlistProblems(rules(REAL), 'ALLOWED_EMAILS=\n').join(' ')).toMatch(/ALLOWED_EMAILS/);
    expect(allowlistProblems(rules(''), null).join(' ')).toMatch(/no address/);
  });

  it('rejects rules and env lists that differ', () => {
    const p = allowlistProblems(rules(REAL), 'ALLOWED_EMAILS=mom@family.test\n');
    expect(p.join(' ')).toMatch(/different addresses/);
  });
});
