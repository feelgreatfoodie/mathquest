# Security notes

## Rules for this public repo

- No real names, kid doc ids or family ids in code, tests, fixtures, filenames, commit messages or PR text. Use made-up values.
- Real card or session copies live only in the gitignored `.private-eval/`, under generic filenames.
- CI runs `scripts/check-private-ids.mjs` on every PR. It compares SHA-256 hashes of added lines, paths and commit
  messages with `scripts/private-id-hashes.txt` (hashes only) and fails on a match.

## Known exposures

- **11-18, a dangling commit.** An early push of the coverage-1 branch (PR 17) named a test data file after two real
  kid document ids. The commit was replaced within minutes by an amended commit on the same branch. The old commit
  is no longer on any branch or in the PR, but GitHub can still serve it by its hash to anyone who knows the hash,
  and it may remain cached. Decision: no GitHub Support request. What the commit exposes: two random kid document
  ids (no names, no pin data, no game data). A kid doc id is not a credential: Firestore rules need a signed-in
  parent of that family or a kid token for that exact kid. The ids are not repeated here.
- **A first name in an old test.** `functions/test/kidpin.test.ts` uses a real first name as test data. It predates
  these rules. Replace it with a made-up name in a later change; the CI check only looks at lines a PR adds.
