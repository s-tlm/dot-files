import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { SORTS } from './board-layout.mjs';

// Account IDs are opaque Jira strings such as 712020:0f1e... or a 24-digit hex ID.
const ASSIGNEE = /^[A-Za-z0-9:_-]{1,128}$/;

export const viewPath = (env = process.env) =>
  join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'herdr-jira-board', 'view.json');

// Each value is checked on its own, so one bad value never discards the others or blocks opening.
export async function loadView(path = viewPath()) {
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); } catch { return {}; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const view = {};
  if (SORTS.includes(value.sort)) view.sort = value.sort;
  if (typeof value.previewHidden === 'boolean') view.previewHidden = value.previewHidden;
  if (typeof value.assignee === 'string' && ASSIGNEE.test(value.assignee)) view.assignee = value.assignee;
  return view;
}

// Writes a private temporary file, then renames it, so a crash never leaves a partial view. Failures are ignored by design.
export async function saveView({ sort, previewHidden, assignee }, path = viewPath()) {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const view = { sort: SORTS.includes(sort) ? sort : null, previewHidden: previewHidden === true,
      assignee: typeof assignee === 'string' && ASSIGNEE.test(assignee) ? assignee : 'all' };
    await writeFile(temp, `${JSON.stringify(view)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } catch {
    await rm(temp, { force: true }).catch(() => {});
  }
}
