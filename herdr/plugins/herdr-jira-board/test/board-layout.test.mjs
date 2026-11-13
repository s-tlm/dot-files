import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { visibleWidth } from '@mariozechner/pi-tui';
import { measureBoard, renderBoardFrame, createdDate } from '../lib/board-layout.mjs';

const issue = (index, fields = {}) => ({
  key: `DATA-${index}`,
  fields: { summary: `Ticket ${index}`, status: { name: 'Open' }, assignee: { displayName: 'Sam' }, ...fields },
});
const plain = lines => lines.map(stripVTControlCharacters);
function frame(width = 120, height = 40, options = {}) {
  const layout = measureBoard(width, height);
  const lines = renderBoardFrame({ layout, searchLine: '❯ Search tickets…', header: 'My board', issues: [issue(1)], ...options });
  assert.equal(lines.length, height);
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= width, `Overflow at ${width}x${height}: ${line}`);
    assert.doesNotMatch(line, /[\n\r\t]/);
  }
  return { layout, lines, text: plain(lines) };
}

test('measures the agreed dimensions and preview thresholds', () => {
  assert.deepEqual(measureBoard(120, 40), {
    width: 120, height: 40, padding: 1, innerWidth: 118, tableWidth: 80,
    previewWidth: 35, bodyHeight: 33, tooSmall: false,
  });
  assert.deepEqual(measureBoard(80, 24), {
    width: 80, height: 24, padding: 1, innerWidth: 78, tableWidth: 78,
    previewWidth: 0, bodyHeight: 17, tooSmall: false,
  });
  assert.equal(measureBoard(60, 15).previewWidth, 0);
  assert.equal(measureBoard(104, 24).previewWidth, 0);
  assert.equal(measureBoard(105, 24).previewWidth, 30);
  assert.equal(measureBoard(105, 24).tableWidth, 70);
  assert.equal(measureBoard(300, 24).previewWidth, 48);
  assert.equal(measureBoard(56, 8).tooSmall, false);
  assert.equal(measureBoard(55, 8).tooSmall, true);
  assert.equal(measureBoard(120, 7).previewWidth, 0);
  assert.equal(measureBoard(3, 0).padding, 0);
  assert.equal(measureBoard(4, 0).padding, 1);
  for (const value of [-1, 0.5, NaN, Infinity, -Infinity, '80', null, undefined]) {
    assert.throws(() => measureBoard(value, 24), RangeError);
    assert.throws(() => measureBoard(80, value), RangeError);
  }
});

test('renders exact column widths and aligned rows at the target sizes', () => {
  for (const [width, height] of [[120, 40], [80, 24], [60, 15]]) {
    const { layout, lines, text } = frame(width, height, { issues: [issue(1), issue(2)] });
    const widths = layout.tableWidth >= 70 ? [12, 10, layout.tableWidth - 59, 11, 14] : [9, 10, layout.tableWidth - 45, 6, 8];
    const positions = widths.slice(0, 4).map((_, column) => 1 + widths.slice(0, column + 1).reduce((sum, value) => sum + value, 0) + column * 3 + 1);
    for (const row of [3, 5, 6]) {
      const separators = [...text[row].matchAll(/│/g)].map(match => visibleWidth(text[row].slice(0, match.index)));
      assert.deepEqual(separators.slice(0, 4), positions);
    }
    assert.match(text[3], /Ticket ID.*Created.*Name.*Status.*Assignee/);
    assert.match(text[5], /› DATA-1/);
    assert.doesNotMatch(text[6], /›/);
    assert.match(lines[5], /\x1b\[48;5;237m/);
    assert.match(lines[3], /\x1b\[1;38;5;8m/);
    for (const row of [1, height - 2]) assert.equal(text[row], ` ${'─'.repeat(layout.innerWidth)} `);
    assert.equal(visibleWidth(lines[0]), width);
    assert.equal(text[7].trim().replace('│', '').trim(), '');
  }
});

test('bounds every tiny width and height without negative padding', () => {
  for (let width = 0; width <= 55; width++) {
    for (let height = 0; height <= 35; height++) frame(width, height);
  }
  for (let height = 0; height < 8; height++) frame(120, height);
  assert.match(frame(55, 8).text[0], /Widen pane/);
});

test('created dates render after the ticket ID and the sorted column shows a marker', () => {
  const { text } = frame(120, 15, { sort: 'created', issues: [issue(1, { created: '2026-11-13T09:30:00.000+1100' }), issue(2, { created: 'bad' }), issue(3)] });
  assert.match(text[3], /Ticket ID\s*│ Created ▼\s*│ Name/);
  assert.match(text[5], /DATA-1\s*│ 2026-11-13 │ Ticket 1/);
  assert.match(text[6], /DATA-2\s*│\s{12}│ Ticket 2/);
  for (const [sort, label] of [['key', 'Ticket ID ▼'], ['name', 'Name ▼'], ['assignee', 'Assignee ▼'], ['status', 'Status ▼']]) assert.ok(frame(120, 15, { sort }).text[3].includes(label));
  assert.doesNotMatch(frame(120, 15).text[3], /▼/);
  assert.equal(createdDate(undefined), '');
  assert.equal(createdDate('2026-01-02'), '2026-01-02');
});

test('sanitises Jira and state text while preserving trusted search formatting', () => {
  const unsafe = '\x1b[31mDanger\x1b[0m\nnext\tcell\rline\x07\u202e';
  const searchLine = '\x1b[32m❯ Search\x1b[0m';
  const source = issue(1, { summary: unsafe, status: { name: unsafe }, assignee: { displayName: unsafe } });
  source.key = unsafe;
  const { lines, text } = frame(120, 40, { issues: [source], header: unsafe, error: unsafe, searchLine });
  assert.ok(lines[0].includes(searchLine));
  assert.doesNotMatch(lines.slice(1).join(''), /\x1b\[31m|\x07|\u202e/);
  assert.match(text[2], /Danger next cell line/);
  assert.match(text[5], /Danger/);
  assert.equal(source.key, unsafe);
});

test('fits Unicode, combining text, long names and unassigned tickets', () => {
  for (const width of [56, 60, 80, 120]) {
    const { text } = frame(width, 15, {
      issues: [issue(1, { summary: '東京 👩🏽‍💻 e\u0301 '.repeat(30), assignee: { displayName: '長い名前👨‍👩‍👧‍👦'.repeat(20) } }), issue(2, { assignee: null }), { key: 'X' }],
    });
    assert.match(text[5], /…/);
    assert.match(text[6], width >= 80 ? /Unassigned/ : /Unassig…/);
    assert.ok(text[7].includes('X'));
  }
});

test('prioritises loading and errors over a long scope heading', () => {
  assert.match(frame(80, 24, { header: 'A'.repeat(200), error: 'Request failed' }).text[2], /^\s*Request failed/);
  assert.match(frame(80, 24, { header: 'A'.repeat(200), busy: true }).text[2], /^\s*Searching…/);
});

test('renders empty, busy and error states', () => {
  const empty = frame(120, 40, { issues: [] });
  assert.match(empty.text[5], /No tickets match.*\(No ticket selected\)/);
  assert.match(empty.text[39], /0\/0\s*$/);
  assert.match(frame(80, 24, { busy: true }).text[2], /Searching…/);
  assert.match(frame(80, 24, { busy: true, error: 'Request failed' }).text[2], /Searching….*Request failed/);
  assert.match(frame(60, 15, { error: 'Request failed' }).text[2], /Request failed/);
  const alerted = frame(120, 40, { alert: 'Dispatch failed', header: 'Sprint' });
  assert.match(alerted.text[2], /Dispatch failed\s+Sprint/);
  assert.ok(alerted.lines[2].includes('\x1b[1;31mDispatch failed'));
  assert.ok(!frame(120, 40, { header: 'Sprint' }).lines[2].includes('\x1b[1;31m'));
});

test('centres and clamps the selected viewport and scrolls the preview independently', () => {
  const issues = Array.from({ length: 100 }, (_, index) => issue(index));
  for (const [selectedIndex, first, selectedRow, counter] of [[0, 0, 5, '1/100'], [50, 46, 9, '51/100'], [99, 92, 12, '100/100'], [-4, 0, 5, '1/100'], [200, 92, 12, '100/100']]) {
    const { text } = frame(120, 15, { issues, selectedIndex, previewLines: ['zero', 'one', 'two'], previewOffset: 1 });
    assert.match(text[5], new RegExp(`DATA-${first}\\s`));
    assert.match(text[selectedRow], /› DATA-/);
    assert.ok(text[14].trimEnd().endsWith(counter));
    assert.match(text[5], /one\s*$/);
    assert.match(text[6], /two\s*$/);
  }
  assert.match(frame(120, 15, { previewLines: ['zero'], previewOffset: -1 }).text[5], /zero\s*$/);
  assert.doesNotMatch(frame(120, 15, { previewLines: ['zero'], previewOffset: 99 }).text[5], /zero/);
});

test('fits whole footer hints, reserves the counter and retains escape', () => {
  for (let width = 16; width <= 180; width++) {
    const { text, lines } = frame(width, 15);
    const footer = text[14].trim();
    assert.ok(footer.endsWith('1/1'));
    assert.match(footer, /esc quit/);
    const hints = footer.slice(0, -3).trim().split(/ {2,}/).filter(Boolean);
    for (const hint of hints) assert.match(hint, /^(↑↓ move|\/ search|f sort|d peon|s status|p points|c comment|a assignee|r refresh|⇧↑↓ preview|esc quit)$/);
    assert.match(lines[14], /\x1b\[38;5;249m/);
    assert.match(lines[14], /\x1b\[38;5;8m/);
  }
  const wide = frame(190, 15);
  assert.match(wide.text[14], /↑↓ move  \/ search  f sort  d peon  s status  p points  c comment  a assignee  r refresh  ⇧↑↓ preview  esc quit/);
  assert.ok(visibleWidth(wide.text[14].trimEnd()) > wide.layout.tableWidth);
  const search = frame(120, 40, { searchMode: true });
  assert.match(search.text[39], /↑↓ move  Enter navigate  Esc navigate  ⇧↑↓ preview/);
  assert.doesNotMatch(search.text[39], /peon|quit/);
  assert.match(frame(56, 8, { searchMode: true }).text[7], /Esc navigate/);
});

test('clips long keys and preview lines without changing source data', () => {
  const source = issue(1);
  source.key = 'DATA-12345678901234567890';
  const issues = [source];
  const previewLines = ['東京👩🏽‍💻'.repeat(60)];
  const before = structuredClone({ issues, previewLines });
  const { text } = frame(120, 24, { issues, previewLines });
  assert.match(text[5], /› DATA-1234…/);
  assert.ok(text[5].includes('東京'));
  assert.ok(text[5].trimEnd().endsWith('…'));
  assert.deepEqual({ issues, previewLines }, before);
});
