import { execFileSync } from 'node:child_process';

export function git(root, args, opts = {}) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

export function isRepo(root) {
  try { git(root, ['rev-parse', '--is-inside-work-tree']); return true; } catch { return false; }
}

export function headShort(root) {
  try { return git(root, ['rev-parse', '--short', 'HEAD']); } catch { return null; }
}

/** Stage everything and commit (allowing empty commits so every approval is recorded). */
export function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '--allow-empty', '-q', '-m', message]);
  return headShort(root);
}

export function tag(root, name, message) {
  git(root, ['tag', '-a', name, '-m', message || name]);
}

export function tagExists(root, name) {
  try { git(root, ['rev-parse', '-q', '--verify', `refs/tags/${name}`]); return true; } catch { return false; }
}

export function listTags(root, pattern) {
  try { return git(root, ['tag', '--list', pattern || '*', '--sort=creatordate']).split('\n').filter(Boolean); } catch { return []; }
}

/** Restore paths to their state at `ref` (worktree + index). Missing paths at ref are removed. */
export function restorePaths(root, ref, paths) {
  for (const p of paths) {
    let existsAtRef = true;
    try { git(root, ['cat-file', '-e', `${ref}:${p}`]); } catch { existsAtRef = false; }
    if (existsAtRef) git(root, ['restore', `--source=${ref}`, '--staged', '--worktree', '--', p]);
    else {
      try { git(root, ['rm', '-r', '-q', '--ignore-unmatch', '--', p]); } catch { /* not tracked */ }
    }
  }
}
