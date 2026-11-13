#!/usr/bin/env node
import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadCredentials } from '../lib/credentials.mjs';
import { Jira } from '../lib/jira.mjs';
import { Herdr, captureOrigin } from '../lib/herdr.mjs';
import { POINTS, choose, confirm, editComment, assignees, filtered, safeText } from '../lib/browser.mjs';
import { browse } from '../lib/board.mjs';

async function main() {
  const command = process.argv[2];
  if (command === 'open') {
    const origin = captureOrigin();
    await new Herdr().open(origin);
    return;
  }
  if (command && !['auth', 'check'].includes(command)) throw new Error('Usage: herdr-jira-board [open|auth|check]');
  const origin = ['auth', 'check'].includes(command) ? null : captureOrigin({ ...process.env,
    HERDR_PLUGIN_CONTEXT_JSON: process.env.JIRA_BOARD_ORIGIN_JSON || process.env.HERDR_PLUGIN_CONTEXT_JSON });
  process.stderr.write('Loading Jira credentials from Keychain...\n');
  const config = await loadCredentials();
  const jira = await new Jira(config).init();
  if (command === 'auth') {
    const scope = await jira.scope();
    process.stdout.write(`Jira credential verified for your identity, board, filter and sprints. ${safeText(scope.state ?? scope.sprint.name)}\n`);
    return;
  }
  process.stderr.write('Loading the active board sprint...\n');
  let snapshot = await jira.snapshot();
  if (command === 'check') {
    process.stdout.write(`${safeText(snapshot.state)}: ${snapshot.issues.length} scoped tickets\n`);
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'herdr-jira-board-'));
  await chmod(dir, 0o700);
  const cleanup = async () => { await rm(dir, { recursive: true, force: true }); };
  const signal = () => { cleanup().finally(() => process.exit(130)); };
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    const herdr = new Herdr();
    let state = { assignee: 'all', query: '', selected: undefined, header: snapshot.state };
    while (true) {
      const issues = filtered(snapshot.issues, state.assignee);
      state.header = `${safeText(state.header)}\n${issues.length} tickets · ${safeText(assignees(snapshot.issues, jira.me.accountId).find(([id]) => id === state.assignee)?.[1] ?? state.assignee)}`;
      const action = await browse(issues, state);
      state.header = snapshot.state;
      state.alert = '';
      if (!action) break;
      state = { ...state, ...action };
      let writeAccepted = false;
      try {
        if (action.action === 'a') {
          const selected = await choose('Assignee', assignees(snapshot.issues, jira.me.accountId));
          if (selected) state.assignee = selected;
          continue;
        }
        if (action.action === 'r') {
          process.stderr.write('Refreshing the board and active sprint...\n');
          snapshot = await jira.snapshot();
          state.header = snapshot.state;
          continue;
        }
        const key = action.selected;
        if (!key || !issues.some(i => i.key === key)) continue;
        if (action.action === 'd') {
          process.stderr.write(`${key}: checking scope and starting peon...\n`);
          await jira.assertScope(key);
          const dispatched = await herdr.dispatch(key, origin, { cwd: origin.focused_pane_cwd, site: config.site, project: config.project });
          state.header = `${key}: peon started${dispatched?.branch ? ` in ${dispatched.branch} (Herdr worktree)` : ''}. Plan approval is still required.`;
        } else if (action.action === 's') {
          process.stderr.write(`${key}: loading available transitions...\n`);
          const transitions = await jira.transitions(key);
          const selected = await choose(`${key}: choose a workflow transition`, transitions.map(t => [t.id, `${t.name} -> ${t.to?.name ?? t.name}`]));
          if (selected && await confirm(`${key}: submit status change?`, transitions.find(t => t.id === selected)?.name ?? selected, dir)) {
            process.stderr.write(`${key}: submitting status change...\n`);
            await jira.transition(key, selected);
            writeAccepted = true;
            snapshot = await jira.snapshot();
            state.header = `${key}: status updated.`;
          }
        } else if (action.action === 'p') {
          const selected = await choose(`${key}: story points`, POINTS.map(p => [String(p), String(p)]));
          if (selected !== null && await confirm(`${key}: submit story points?`, `${key}: story points -> ${selected}`, dir)) {
            process.stderr.write(`${key}: updating and confirming story points...\n`);
            await jira.points(key, Number(selected));
            writeAccepted = true;
            snapshot = await jira.snapshot();
            state.header = `${key}: story points confirmed as ${selected}.`;
          }
        } else if (action.action === 'c') {
          const body = await editComment(key, dir);
          if (await confirm(`${key}: submit comment?`, body, dir)) {
            process.stderr.write(`${key}: submitting comment...\n`);
            await jira.comment(key, body);
            writeAccepted = true;
            await rm(join(dir, `${key}.draft`), { force: true });
            state.header = `${key}: comment added.`;
          } else state.header = `${key}: comment cancelled. Draft retained until you close the browser.`;
        }
      } catch (error) {
        state.alert = `${writeAccepted ? `${state.selected}: update accepted, but a follow-up failed. Check Jira before repeating. ` : ''}${safeText(error.message)}`;
      }
    }
  } finally {
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
    await cleanup();
  }
}
main().catch(async error => {
  process.stderr.write(`${safeText(error.message)}\n`);
  if (process.env.JIRA_BOARD_ORIGIN_JSON && process.stdin.isTTY) {
    const input = createInterface({ input: process.stdin, output: process.stderr });
    try { await input.question('Press Enter to close.'); } finally { input.close(); }
  }
  process.exitCode = 1;
});
