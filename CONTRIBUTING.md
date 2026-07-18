# Contributing

Short conventions for anyone — human or AI agent — working in this repo. See
`CLAUDE.md` for architecture and how the app is built.

## Branches

- **`main` is the source of truth** and is protected. It auto-deploys to Vercel
  production, so anything merged to `main` ships.
- **Always branch from the latest `main`** for new work. Never start from, or
  build on top of, another feature branch.
- **One branch per change.** Give it a short, descriptive name
  (`feature/…`, `fix/…`, `chore/…`). Agent sessions use `claude/…` names.

## Don't reuse a merged branch

Once a branch's PR is merged, that branch is **done** — treat it as
frozen history.

- Do **not** push new commits to an already-merged branch. Those commits get
  stranded (they're not on `main`, and a fresh PR from the stale branch shows a
  misleading "revert everything" diff). Start a new branch from `main` instead.
- If you need to recover work that was stranded on a merged branch,
  cherry-pick the specific commits onto a fresh branch off `main` and open a
  new PR — don't PR the stale branch directly.

## Keep branches from piling up

- **Repo setting (one-time):** Settings → General → Pull Requests →
  enable **"Automatically delete head branches."** This deletes each PR's
  branch on merge, which prevents most leftover branches (including per-session
  agent branches).
- **Delete manually** if auto-delete is ever off:
  `git push origin --delete <branch>` (or the trash icon on the Branches page).
- **Prune locally** now and then: `git fetch --prune` clears remote-tracking
  refs for branches that were deleted on the server.

## Pull requests

- Open PRs into `main`. Don't create a PR unless a change is meant to ship.
- Keep the PR's diff limited to the change at hand (a clean diff = a safe merge,
  regardless of merge strategy).
- **Verify before merging:** `npm run build` (static export + type check) must
  pass, and `npx tsx evals/run.ts` should be green (see `EVALS.md`). There is no
  unit-test framework — the build and the eval suites are the checks.
