# worktree-guard

A Claude Code plugin that stops Claude from changing anything on `main` or `master`. Claude has to work in a git worktree on its own branch instead, so several sessions can run at once without clashing.

## Install

```
/plugin install worktree-guard --marketplace devnazir/worktree-guard
```

Press `y`, then Enter. The repo is private, so you need access to it and a GitHub login on your machine (`gh auth login`, then `gh auth setup-git`).

## What it blocks

On a protected branch, Claude can't:

- edit or create files
- run shell commands that write (commits, `rm`, `npm install`, `>` and so on)

Read-only commands (`git status`, `ls`, `grep` …) still work, and so do `git worktree` and `git fetch`, so Claude can make its own worktree.

## Settings

In `/config`, under **worktree-guard**:

- **Protected branches**: default `main,master`. A trailing `*` matches a prefix, e.g. `release/*`.
- **Allowed shell commands**: default `git worktree,git fetch`.

## Using worktrees

```bash
git worktree add ../myrepo-task -b feature/task
cd ../myrepo-task && claude
```

Or start Claude with `claude -w`.

## License

MIT
