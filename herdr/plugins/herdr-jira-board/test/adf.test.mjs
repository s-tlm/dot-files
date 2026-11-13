import test from 'node:test';
import assert from 'node:assert/strict';
import { description, preview } from '../lib/browser.mjs';
import { commentDocument } from '../lib/jira.mjs';
const text = value => ({ type: 'text', text: value });
const paragraph = (...content) => ({ type: 'paragraph', content });
const doc = (...content) => ({ type: 'doc', version: 1, content });

test('multiline comments preserve Unicode, blank lines, spaces and literal Markdown as ADF', () => {
  const input = 'Café **literal**\r\n\r\n  漢字\rLast\n';
  assert.deepEqual(commentDocument(input), doc(
    paragraph(text('Café **literal**')), paragraph(), paragraph(text('  漢字')), paragraph(text('Last')), paragraph(),
  ));
  assert.equal(description(commentDocument('One\n\nTwo')), 'One\n\nTwo\n');
  for (const input of ['', ' \n\t', null, 1, {}]) assert.throws(() => commentDocument(input), /cannot be blank/);
});

test('ADF blocks and hard breaks retain boundaries without fetching metadata', () => {
  const value = doc(
    { type: 'heading', content: [text('A heading')] },
    paragraph(text('One'), { type: 'hardBreak' }, text('Two')),
    { type: 'codeBlock', attrs: { language: 'sql' }, content: [text('select 1;\n  select 2;')] },
    { type: 'panel', content: [paragraph(text('Nested'))] },
  );
  assert.equal(description(value), 'A heading\nOne\nTwo\nselect 1;\n  select 2;\nNested\n');
  assert.deepEqual(value.content[2].content, [text('select 1;\n  select 2;')]);
});

test('mentions, emoji, statuses, cards and media retain meaningful plain text', () => {
  const leaves = [
    { type: 'mention', attrs: { id: 'account', text: '@Person' } },
    { type: 'mention', attrs: { id: 'not-a-display-name' } },
    { type: 'emoji', attrs: { shortName: ':smile:' } },
    { type: 'emoji', attrs: { shortName: ':smile:', text: '🙂' } },
    { type: 'status', attrs: { text: 'Blocked', color: 'red' } },
    { type: 'inlineCard', attrs: { url: 'https://example.invalid/path' } },
    { type: 'blockCard', attrs: { data: { privateMetadata: 'not rendered' } } },
    { type: 'media', attrs: { type: 'file', id: 'not-a-filename', alt: 'A diagram' } },
    { type: 'media', attrs: { type: 'file', id: 'not-a-filename' } },
  ];
  const output = description(doc(...leaves.map(leaf => paragraph(leaf))));
  assert.equal(output, '@Person\n[mention]\n:smile:\n🙂\nBlocked\nhttps://example.invalid/path\n[link]\nA diagram\n[media]\n');
  assert.doesNotMatch(output, /not-a-display-name|not-a-filename|privateMetadata/);
});

test('ADF lists preserve an explicit zero start and tables use readable cell separators', () => {
  const item = value => ({ type: 'listItem', content: [paragraph(text(value))] });
  const cell = (type, value) => ({ type, content: [paragraph(text(value))] });
  assert.equal(description(doc({ type: 'orderedList', attrs: { order: 0 }, content: [item('Zero'), item('One')] })), '0. Zero\n1. One\n');
  assert.equal(description(doc({ type: 'bulletList', content: [item('First'), item('Second')] })), '- First\n- Second\n');
  assert.equal(description(doc({ type: 'table', content: [
    { type: 'tableRow', content: [cell('tableHeader', 'Key'), cell('tableHeader', 'Value')] },
    { type: 'tableRow', content: [cell('tableCell', 'A'), cell('tableCell', '漢字')] },
  ] })), 'Key | Value\nA | 漢字\n');
});

test('ADF content is terminal-safe, long text is retained and input is not rewritten', () => {
  const value = doc(paragraph(text('\x1b[31mCafé\x1b[0m\x1b]0;title\x07\u202e')));
  const before = JSON.stringify(value);
  assert.equal(description(value), 'Café\n');
  const issue = { key: 'DATA-1', fields: { summary: 'A ticket', points: 0, description: value } };
  assert.match(preview(issue), /Points: 0/);
  assert.match(preview(issue), /Café/);
  assert.equal(JSON.stringify(value), before);
  assert.equal(description(doc(paragraph(text('字'.repeat(100000))))).length, 100001);
});

test('missing, empty, malformed or excessively nested ADF has a controlled outcome', () => {
  assert.equal(description(null), '(No description)');
  assert.equal(description(doc()), '(No description)');
  assert.equal(description(doc(paragraph())), '(No description)');
  for (const value of [1, [], {}, { type: 'doc', content: {} }, { type: 'text', text: null }, doc(null)]) {
    assert.throws(() => description(value), /Malformed ADF/);
  }
  let deep = paragraph(text('End'));
  for (let i = 0; i < 102; i++) deep = { type: 'panel', content: [deep] };
  assert.throws(() => description(deep), /Malformed ADF/);
});
