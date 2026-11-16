import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadView, saveView, viewPath } from '../lib/view.mjs';

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'jira-view-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('the view lives in the user state directory', () => {
  assert.equal(viewPath({ XDG_STATE_HOME: '/state' }), '/state/herdr-jira-board/view.json');
  assert.match(viewPath({}), /\/\.local\/state\/herdr-jira-board\/view\.json$/);
});

test('saves privately and restores the preview, sort and assignee', async t => {
  const path = join(await scratch(t), 'nested', 'view.json');
  await saveView({ sort: 'status', previewHidden: true, assignee: '712020:0f1e-ab', query: 'secret', selected: 'DATA-1' }, path);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { sort: 'status', previewHidden: true, assignee: '712020:0f1e-ab' });
  assert.deepEqual(await loadView(path), { sort: 'status', previewHidden: true, assignee: '712020:0f1e-ab' });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(path, '..'))).mode & 0o777, 0o700);
  await saveView({ sort: null, previewHidden: false, assignee: 'all' }, path);
  assert.deepEqual(await loadView(path), { previewHidden: false, assignee: 'all' });
  assert.deepEqual(await readdir(join(path, '..')), ['view.json'], 'no temporary file is left behind');
});

test('missing, broken and partly invalid files fall back value by value', async t => {
  const dir = await scratch(t);
  const path = join(dir, 'view.json');
  assert.deepEqual(await loadView(path), {});
  for (const body of ['{', '[]', 'null', '"text"', '7']) {
    await writeFile(path, body);
    assert.deepEqual(await loadView(path), {}, body);
  }
  await writeFile(path, JSON.stringify({ sort: 'priority', previewHidden: 'yes', assignee: 'me', query: 'x', extra: 1 }));
  assert.deepEqual(await loadView(path), { assignee: 'me' });
  await writeFile(path, JSON.stringify({ sort: 'key', previewHidden: true, assignee: '\x1b[31mbad' }));
  assert.deepEqual(await loadView(path), { sort: 'key', previewHidden: true });
  await writeFile(path, JSON.stringify({ assignee: 'a'.repeat(129) }));
  assert.deepEqual(await loadView(path), {});
});

test('saving fails quietly and never writes invalid values', async t => {
  const dir = await scratch(t);
  const blocker = join(dir, 'file');
  await writeFile(blocker, '');
  await assert.doesNotReject(saveView({ sort: 'key' }, join(blocker, 'view.json')));
  const path = join(dir, 'view.json');
  await saveView({ sort: 'priority', previewHidden: 'yes', assignee: '../x' }, path);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { sort: null, previewHidden: false, assignee: 'all' });
});
