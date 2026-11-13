import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { filterIssues } from '../lib/fuzzy.mjs';

const exec = promisify(execFile);
const issue = (key, summary, status = 'Open', assignee = 'Sam') => ({
  key, fields: { summary, status: { name: status },
    assignee: assignee === null ? null : { displayName: assignee },
    description: 'hidden-description-only', reporter: { displayName: 'hidden-reporter-only' } },
});
const issues = [
  issue('DATA-101', 'Repair deployment pipeline', 'In Progress', 'Alice Nguyen'),
  issue('OPS-202', 'Rotate warehouse credentials', 'Blocked', 'Bob Jones'),
  issue('DATA-303', '東京 café résumé', '完了', 'Zoë Müller'),
  issue('DATA-404', 'Investigate missing events', 'Open', null),
];
const keys = matches => matches.map(match => match.key).sort();

function originalMatches(matches, source) {
  for (const match of matches) assert.ok(source.includes(match), 'Return the original scoped issue object');
}

test('an empty query bypasses fzf and returns the original snapshot', async () => {
  assert.equal(await filterIssues(issues, ''), issues);
  const empty = [];
  assert.equal(await filterIssues(empty, ''), empty);
  const code = `
    import assert from 'node:assert/strict';
    import { filterIssues } from ${JSON.stringify(new URL('../lib/fuzzy.mjs', import.meta.url).href)};
    const issues = [{ key: 'DATA-1', fields: { summary: 'Ticket' } }];
    assert.equal(await filterIssues(issues, ''), issues);
  `;
  await exec(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, PATH: '' }, timeout: 5000 });
});

for (const [field, query, expected] of [
  ['summary', 'rdpl', 'DATA-101'],
  ['status', 'blckd', 'OPS-202'],
  ['assignee', 'alcng', 'DATA-101'],
  ['key', 'dt101', 'DATA-101'],
  ['unassigned fallback', 'unassigned', 'DATA-404'],
  ['Unicode summary', '東京', 'DATA-303'],
  ['Unicode assignee', 'Müll', 'DATA-303'],
  ['Unicode status', '完了', 'DATA-303'],
  ['lowercase smart-case summary', 'repair', 'DATA-101'],
]) {
  test(`installed fzf matches the ${field} without opening a picker`, { timeout: 5000 }, async () => {
    const before = structuredClone(issues);
    const matches = await filterIssues(issues, query);
    assert.deepEqual(keys(matches), [expected]);
    originalMatches(matches, issues);
    assert.deepEqual(issues, before);
  });
}

test('fzf keeps its default uppercase smart-case behaviour', { timeout: 5000 }, async () => {
  assert.deepEqual(await filterIssues(issues, 'REPAIR'), []);
  assert.deepEqual(await filterIssues(issues, 'Repair'), [issues[0]]);
});

test('a nonempty query with no matches returns an empty list', { timeout: 5000 }, async () => {
  assert.deepEqual(await filterIssues(issues, 'zzzz-no-such-ticket-99999'), []);
  assert.deepEqual(await filterIssues([], 'anything'), []);
});

for (const query of ['$HOME', '$(id)', '`id`', ';touch', '&whoami', '>owned', '"quoted"', '--help', '[brackets]']) {
  test(`shell characters stay argument data: ${JSON.stringify(query)}`, { timeout: 5000 }, async () => {
    const source = [issue('DATA-1', `Literal ${query} marker`), issue('DATA-2', 'Unrelated record')];
    const matches = await filterIssues(source, query);
    assert.deepEqual(matches, [source[0]]);
    originalMatches(matches, source);
  });
}

test('filtering never widens the supplied scope or searches preview-only fields', { timeout: 5000 }, async () => {
  const scoped = [issues[0]];
  assert.deepEqual(await filterIssues(scoped, 'OPS-202'), []);
  assert.deepEqual(await filterIssues(scoped, 'hidden-description-only'), []);
  assert.deepEqual(await filterIssues(scoped, 'hidden-reporter-only'), []);
  const matches = await filterIssues(scoped, 'repair');
  assert.deepEqual(matches, scoped);
  originalMatches(matches, scoped);
});

test('tabs, newlines and terminal controls in fields cannot create extra result records', { timeout: 5000 }, async () => {
  const source = [issue('DATA-1', '\x1b[31mNeedle\x1b[0m\nFAKE-2\tOther\r\x07\u202e'), issue('DATA-2', 'Other')];
  const before = structuredClone(source);
  assert.deepEqual(await filterIssues(source, 'needle'), [source[0]]);
  assert.deepEqual(await filterIssues(source, 'FAKE-2'), [source[0]]);
  assert.deepEqual(source, before);
});

test('an already aborted signal rejects even for an empty query', async () => {
  const controller = new AbortController();
  controller.abort();
  for (const query of ['', 'repair']) {
    await assert.rejects(filterIssues(issues, query, { signal: controller.signal }), { name: 'AbortError' });
  }
});

test('aborting an active fzf child rejects without returning stale matches', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  const pending = filterIssues(issues, 'repair', { signal: controller.signal });
  const rejection = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejection;
});

test('user fzf defaults cannot add filters, reorder the scope or open a CLI window', { timeout: 5000 }, async () => {
  const code = `
    import assert from 'node:assert/strict';
    import { filterIssues } from ${JSON.stringify(new URL('../lib/fuzzy.mjs', import.meta.url).href)};
    const source = ${JSON.stringify(issues)};
    assert.deepEqual((await filterIssues(source, 'repair')).map(issue => issue.key), ['DATA-101']);
  `;
  const { stdout, stderr } = await exec(process.execPath, ['--input-type=module', '-e', code], {
    timeout: 4000,
    env: { ...process.env, FZF_DEFAULT_OPTS: '--filter=definitely-not-present --no-sort', FZF_DEFAULT_OPTS_FILE: '/nonexistent/herdr-fzf-options' },
  });
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});
