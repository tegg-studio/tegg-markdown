# Tegg Markdown repository instructions

Read [docs/releasing.md](docs/releasing.md) before Git or release work.

- This is the public `tegg-studio/tegg-markdown` SDK repository. Verify Git root,
  branch, status and origin before mutations; stop to investigate mismatches.
- Shared parsing, rendering, editing, adapters and their tests belong here.
  Native app implementations, private history, customer documents, credentials,
  signing files and internal business material do not. Never merge an app Git
  history into this repository or use branches to separate public/private code.
- Use `main` plus short `codex/<task>` branches. Preserve existing user changes,
  stage named task files and inspect the staged diff and commit text. Public
  commits describe behavior without customer names, internal paths or discussions.
- Run `npm run check`; distribution changes also require independent packed
  consumers and browser checks. Keep source tests in Git, outside npm archives.
- Push only within user authorization. Git push, GitHub release, npm publication
  and native application distribution are separate actions. Do not publish npm,
  move tags or rewrite history as a side effect of a source push.
- Keep exact versions, immutable tags, lockfiles and artifact integrity records.
  Update current documentation without rewriting historical validation claims.
