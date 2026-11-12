# worktree-guard

A Claude Code plugin that stops Claude from editing files on protected branches (by default `main` and `master`). When Claude tries, the edit is blocked and Claude is told to create a git worktree on its own branch first.

This lets you run several Claude sessions at once (for example in separate Warp tabs) without them overwriting each other's files or committing onto the same branch.

## Install

The repository is private, so you need read access to it, plus a git credential for github.com on your machine (an SSH key, or `gh auth login` followed by `gh auth setup-git`).

At the prompt of a Claude Code terminal session:

```
/plugin install worktree-guard --marketplace devnazir/worktree-guard
```

Answer `y` to add the marketplace, then pick a scope (Enter picks **user**, so it applies to every project).

From a shell instead:

```
claude plugin install worktree-guard --marketplace devnazir/worktree-guard
```

It needs a recent Claude Code version that supports hooks modules (`hooks/hooks.json` with `modules`).

## What it does

Before every `Edit`, `Write` and `NotebookEdit` call, the plugin runs `git symbolic-ref --short HEAD` in the file's folder:

- If the folder is not in a git repo, or HEAD is detached, the edit goes ahead.
- If the branch is not protected, the edit goes ahead. This covers any feature branch, in the main folder or in a worktree.
- If the branch is protected, the edit is blocked. Claude gets a message telling it to run `git worktree add ../<repo>-<task> -b feature/<task>` and work there.

If the branch check itself fails, the edit is blocked to be safe.

## Configure the protected branches

Open `/config` and find **worktree-guard → Protected branches**. The value is a comma-separated list. A trailing `*` matches a prefix:

```
main,master,develop,release/*
```

The default is `main,master`.

## Working with worktrees

```bash
# new task on its own branch, in a sibling folder
git worktree add ../myrepo-cart-drawer -b feature/cart-drawer main
cd ../myrepo-cart-drawer && claude

# after merging
git worktree remove ../myrepo-cart-drawer
```

`claude --worktree` (or `-w`) also starts a session in a fresh worktree.

## Limits

- It guards Claude's file-editing tools. A shell command run through Bash (`sed -i`, `echo >`) is not checked.
- Commits made with Bash on a protected branch are not blocked either. Use branch protection on GitHub for that.

## Develop

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .   # run a session with the local copy loaded
```

## License

MIT
