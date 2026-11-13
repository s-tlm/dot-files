import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeText, description, preview, assignees, filtered, POINTS, shellQuote, run, editComment } from '../lib/browser.mjs';
const issue = (key, assignee = null, points = null) => ({ key, fields: { summary: 'Café 漢字', assignee, points } });
test('preview preserves Unicode and zero, handles nulls and missing descriptions', () => {
  assert.match(preview(issue('DATA-1', null, 0)), /Points: 0/);
  assert.match(preview(issue('DATA-1')), /Points: Not set/);
  assert.match(preview(issue('DATA-1')), /Unassigned/);
  assert.match(preview(issue('DATA-1')), /Café 漢字/);
  assert.match(description(null), /No description/);
  assert.equal(description({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }), 'Hello\n');
  assert.equal(description('a'.repeat(100000)).length, 100000);
});
test('terminal controls and directional overrides are removed', () => {
  assert.equal(safeText('\x1b[31mred\x1b[0m\x1b]0;bad\x07\r\u202eevil'), 'redevil');
  assert.equal(safeText('a\x00b\t\nc'), 'ab\t\nc');
});
test('assignee IDs disambiguate names and never widen the snapshot', () => {
  const issues = [issue('DATA-1', { accountId: 'x', displayName: 'Same' }), issue('DATA-2', { accountId: 'y', displayName: 'Same' }), issue('DATA-3')];
  assert.equal(assignees(issues, 'x').length, 5);
  assert.equal(filtered(issues, 'all').length, 3);
  assert.deepEqual(filtered(issues, 'x').map(i => i.key), ['DATA-1']);
  assert.deepEqual(filtered(issues, 'unassigned').map(i => i.key), ['DATA-3']);
  assert.equal(filtered(issues, 'missing').length, 0);
});
test('points scale contains zero and no negative or fractional values', () => {
  assert.ok(POINTS.includes(0));
  assert.ok(POINTS.every(x => Number.isInteger(x) && x >= 0));
});
test('shell quoting preserves hostile local paths', async () => {
  const path = "/tmp/a'b $(false)";
  const { output } = await run('/bin/sh', ['-c', `printf %s ${shellQuote(path)}`]);
  assert.equal(output, path);
});
test('missing subprocess is a controlled failure', async () => {
  await assert.rejects(run('/does/not/exist', []), /ENOENT/);
});
test('multiline comment drafts survive editor errors and blank comments are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jira-editor-test-'));
  const saved = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
  const editor = join(dir, 'editor');
  delete process.env.VISUAL;
  process.env.EDITOR = editor;
  try {
    await writeFile(editor, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    await assert.rejects(editComment('DATA-1', dir), /cannot be blank/);
    await writeFile(join(dir, 'DATA-1.draft'), 'First line\nSecond line\n');
    assert.equal(await editComment('DATA-1', dir), 'First line\nSecond line\n');
    await writeFile(editor, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    await assert.rejects(editComment('DATA-1', dir), /draft is retained/);
    assert.equal(await readFile(join(dir, 'DATA-1.draft'), 'utf8'), 'First line\nSecond line\n');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
