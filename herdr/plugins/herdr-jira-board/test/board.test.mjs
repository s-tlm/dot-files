import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify, stripVTControlCharacters } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Input, CURSOR_MARKER, visibleWidth } from '@mariozechner/pi-tui';
import { BoardView, browse, sortIssues, SORTS } from '../lib/board.mjs';
import { measureBoard } from '../lib/board-layout.mjs';

const exec = promisify(execFile);
const issue = (number, fields = {}) => ({
  key: `DATA-${number}`,
  fields: { summary: `Ticket ${number}`, status: { name: 'Open' }, assignee: { displayName: 'Sam' },
    description: Array.from({ length: 100 }, (_, row) => `Description line ${row}`).join('\n'), ...fields },
});
const issues = Array.from({ length: 40 }, (_, index) => issue(index + 1));
const plain = lines => lines.map(stripVTControlCharacters);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
function model(t, options = {}, state = {}) {
  const actions = [], errors = [], closes = [], renders = [];
  const view = new BoardView(issues, state, {
    terminal: { columns: 120, rows: 24 }, filter: async source => source,
    requestRender: () => renders.push(true), onAction: value => actions.push(value),
    onClose: () => closes.push(true), onError: error => errors.push(error), ...options,
  });
  t.after(() => view.dispose());
  return { view, actions, errors, closes, renders };
}

test('sortIssues orders assignee, created and status descending with stable missing values last', () => {
  const people = [issue(1, { assignee: { displayName: 'alex' } }), issue(2, { assignee: null }), issue(3, { assignee: { displayName: 'Zoe' } }), issue(4, { assignee: { displayName: 'Alex' } })];
  assert.deepEqual(sortIssues(people, 'assignee').map(item => item.key), ['DATA-3', 'DATA-1', 'DATA-4', 'DATA-2']);
  const dates = [issue(1, { created: '2026-01-01T00:00:00.000+1100' }), issue(2), issue(3, { created: '2026-11-13T00:00:00.000+1100' }), issue(4, { created: 'bad' })];
  assert.deepEqual(sortIssues(dates, 'created').map(item => item.key), ['DATA-3', 'DATA-1', 'DATA-2', 'DATA-4']);
  const status = (name, key) => ({ status: { name, statusCategory: { key } } });
  const states = [issue(1, status('To Do', 'new')), issue(2, status('Done', 'done')), issue(3, status('In Review', 'indeterminate')), issue(4, status('In Progress', 'indeterminate')), issue(5, { status: null })];
  assert.deepEqual(sortIssues(states, 'status').map(item => item.key), ['DATA-2', 'DATA-3', 'DATA-4', 'DATA-1', 'DATA-5']);
  assert.equal(sortIssues(states, null), states);
  assert.deepEqual(states.map(item => item.key), ['DATA-1', 'DATA-2', 'DATA-3', 'DATA-4', 'DATA-5']);
  const keys = [issue(9), issue(10), { key: 'bad', fields: {} }, issue(2)];
  assert.deepEqual(sortIssues(keys, 'key').map(item => item.key), ['DATA-10', 'DATA-9', 'DATA-2', 'bad']);
  const names = [issue(1, { summary: 'apple' }), issue(2, { summary: 'Zebra' }), issue(3, { summary: undefined }), issue(4, { summary: 'Mango' })];
  assert.deepEqual(sortIssues(names, 'name').map(item => item.key), ['DATA-2', 'DATA-4', 'DATA-1', 'DATA-3']);
  assert.deepEqual(SORTS, ['key', 'created', 'name', 'status', 'assignee']);
});

test('f cycles sorts, keeps the selected ticket and returns the sort with actions', async t => {
  const source = [issue(1, { assignee: { displayName: 'Amy' }, created: '2026-03-01T00:00:00.000Z', status: { name: 'Done', statusCategory: { key: 'done' } } }),
    issue(2, { assignee: { displayName: 'Zed' }, created: '2026-01-01T00:00:00.000Z', status: { name: 'To Do', statusCategory: { key: 'new' } } }),
    issue(3, { assignee: { displayName: 'Max' }, created: '2026-02-01T00:00:00.000Z', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } })];
  const { view, actions } = model(t, { filter: async items => items }, { selected: 'DATA-3' });
  await view.ready;
  view.issues = source;
  view.matches = source;
  view.selectedIndex = 2;
  const order = () => view.matches.map(item => item.key);
  for (const [sort, keys, label] of [['key', ['DATA-3', 'DATA-2', 'DATA-1'], 'Ticket ID'], ['created', ['DATA-1', 'DATA-3', 'DATA-2']],
    ['name', ['DATA-3', 'DATA-2', 'DATA-1'], 'Name'], ['status', ['DATA-1', 'DATA-3', 'DATA-2']], ['assignee', ['DATA-2', 'DATA-3', 'DATA-1']], ['key', ['DATA-3', 'DATA-2', 'DATA-1'], 'Ticket ID']]) {
    view.handleInput('f');
    assert.equal(view.sort, sort);
    assert.deepEqual(order(), keys);
    assert.equal(view.matches[view.selectedIndex].key, 'DATA-3');
    assert.ok(plain(view.render(120))[3].includes(`${label ?? `${sort[0].toUpperCase()}${sort.slice(1)}`} ▼`));
  }
  assert.deepEqual(actions, []);
  view.handleInput('d');
  assert.deepEqual(actions, [{ query: '', action: 'd', selected: 'DATA-3', sort: 'key' }]);
});

test('a saved sort applies on reopen and after searches, while f types in search mode', async t => {
  const { view } = model(t, {}, { sort: 'created' });
  await view.ready;
  assert.equal(view.sort, 'created');
  const { view: invalid } = model(t, {}, { sort: 'priority' });
  assert.equal(invalid.sort, null);
  view.handleInput('/');
  view.handleInput('f');
  await view.ready;
  assert.equal(view.input.getValue(), 'f');
  assert.equal(view.sort, 'created');
});

class FakeTerminal {
  columns = 120;
  rows = 24;
  kittyProtocolActive = false;
  output = [];
  starts = 0;
  stops = 0;
  raw = false;
  cursorVisible = true;
  start(onInput, onResize) {
    this.starts++;
    this.raw = true;
    this.onInput = onInput;
    this.onResize = onResize;
    if (this.startError) throw this.startError;
  }
  stop() { this.stops++; this.raw = false; }
  async drainInput() {}
  write(data) { this.output.push(data); }
  moveBy(lines) { this.write(`\x1b[${Math.abs(lines)}${lines < 0 ? 'A' : 'B'}`); }
  hideCursor() { this.cursorVisible = false; this.write('\x1b[?25l'); }
  showCursor() { this.cursorVisible = true; this.write('\x1b[?25h'); }
  clearLine() { this.write('\x1b[2K'); }
  clearFromCursor() { this.write('\x1b[J'); }
  clearScreen() { this.write('\x1b[2J'); }
  setTitle() {}
  setProgress() {}
}

const listenerEvents = ['SIGINT', 'SIGTERM', 'exit', 'uncaughtExceptionMonitor'];
const listeners = () => listenerEvents.map(event => process.listeners(event));
function restored(terminal) {
  assert.equal(terminal.starts, 1);
  assert.equal(terminal.stops, 1);
  assert.equal(terminal.raw, false);
  assert.equal(terminal.cursorVisible, true);
  const output = terminal.output.join('');
  assert.equal(output.split('\x1b[?1049h').length - 1, 1);
  assert.equal(output.split('\x1b[?1049l').length - 1, 1);
  assert.ok(output.endsWith('\x1b[?1049l'));
}

test('ready waits for the initial filter and blocks stale selection and write actions', async t => {
  const pending = deferred();
  let signal;
  const { view, actions, renders } = model(t, { filter: (source, query, options) => {
    assert.equal(source, issues);
    assert.equal(query, 'initial');
    signal = options.signal;
    return pending.promise;
  } }, { query: 'initial', selected: 'DATA-2' });
  assert.equal(view.busy, true);
  assert.ok(view.ready instanceof Promise);
  assert.ok(signal instanceof AbortSignal);
  assert.ok(renders.length > 0);
  assert.match(plain(view.render(120))[2], /Searching/);
  for (const key of ['d', 's', 'p', 'c', 'j', '\x1b[B']) view.handleInput(key);
  assert.deepEqual(actions, []);
  assert.equal(view.selectedIndex, 1);
  pending.resolve([issues[2], issues[1]]);
  await view.ready;
  assert.equal(view.busy, false);
  assert.equal(view.matches[view.selectedIndex], issues[1]);
  assert.doesNotMatch(plain(view.render(120))[2], /Searching/);
});

for (const key of ['d', 's', 'p', 'c', 'a', 'r']) {
  test(`navigation ${key} returns the original key once`, async t => {
    const original = issue(1);
    original.key = 'DATA-12345678901234567890';
    const { view, actions, closes } = model(t, { filter: async () => [original] }, { query: 'Ticket' });
    await view.ready;
    assert.match(plain(view.render(80))[5], /…/);
    view.handleInput(key);
    view.handleInput(key);
    view.handleInput('q');
    assert.deepEqual(actions, [{ query: 'Ticket', action: key, selected: original.key, sort: null }]);
    assert.deepEqual(closes, []);
    assert.equal(view.closed, true);
  });
}

for (const key of ['q', '\x1b', '\x03']) {
  test(`navigation ${JSON.stringify(key)} closes once without dispatch`, async t => {
    const { view, closes, actions } = model(t);
    await view.ready;
    view.handleInput(key);
    view.handleInput(key);
    assert.equal(closes.length, 1);
    assert.deepEqual(actions, []);
  });
}

for (const exit of ['\r', '\n', '\x1b', '\x03']) {
  test(`search action letters stay text and ${JSON.stringify(exit)} returns to navigation`, async t => {
    const queries = [];
    const { view, actions, closes } = model(t, { filter: async (source, query) => {
      queries.push(query);
      return source;
    } });
    await view.ready;
    view.handleInput('/');
    assert.equal(view.searchMode, true);
    assert.ok(view.input instanceof Input);
    for (const letter of 'dspcarqjk/') {
      view.handleInput(letter);
      await view.ready;
      assert.deepEqual(actions, []);
      assert.deepEqual(closes, []);
    }
    assert.equal(view.input.getValue(), 'dspcarqjk/');
    assert.equal(queries.at(-1), 'dspcarqjk/');
    view.handleInput(exit);
    assert.equal(view.searchMode, false);
    assert.equal(view.closed, false);
    assert.deepEqual(actions, []);
    view.handleInput('d');
    assert.deepEqual(actions, [{ query: 'dspcarqjk/', action: 'd', selected: 'DATA-1', sort: null }]);
  });
}

test('the query editor handles Unicode graphemes, editing, long queries and cursor focus', async t => {
  const { view, errors } = model(t);
  await view.ready;
  view.focused = true;
  assert.doesNotMatch(view.render(80)[0], new RegExp(CURSOR_MARKER));
  view.handleInput('/');
  view.handleInput('東京e\u0301🙂');
  await view.ready;
  view.handleInput('\x7f');
  await view.ready;
  assert.equal(view.input.getValue(), '東京e\u0301');
  view.handleInput('\x1b[D');
  view.handleInput('X');
  await view.ready;
  assert.equal(view.input.getValue(), '東京Xe\u0301');
  view.handleInput('\x05');
  view.handleInput('界'.repeat(4096));
  await view.ready;
  assert.equal(view.input.getValue(), `東京Xe\u0301${'界'.repeat(4096)}`);
  const rendered = view.render(80);
  assert.equal(view.input.focused, true);
  assert.ok(rendered[0].includes(CURSOR_MARKER));
  assert.equal(visibleWidth(rendered[0]), 80);
  view.focused = false;
  assert.ok(!view.render(80)[0].includes(CURSOR_MARKER));
  assert.equal(view.input.focused, false);
  assert.deepEqual(errors, []);
});

test('bracketed paste in search sanitises controls without dispatching', async t => {
  const { view, actions, closes } = model(t);
  await view.ready;
  view.handleInput('/');
  view.handleInput('\x1b[200~dspcarq\n東京\t\x1b[31mred\x1b[0m\x07\u202e\x1b[201~');
  await view.ready;
  assert.equal(view.input.getValue(), 'dspcarq東京    red');
  assert.equal(view.searchMode, true);
  assert.deepEqual(actions, []);
  assert.deepEqual(closes, []);
  assert.doesNotMatch(view.input.getValue(), /[\x00-\x1f\x7f-\x9f\u202e]/);
});

test('navigation ignores bracketed paste rather than interpreting pasted actions', async t => {
  const { view, actions, closes } = model(t);
  await view.ready;
  view.handleInput('\x1b[200~dspcarq\x03\r\x1b[201~');
  assert.deepEqual(actions, []);
  assert.deepEqual(closes, []);
  assert.equal(view.input.getValue(), '');
  assert.equal(view.selectedIndex, 0);
  assert.equal(view.closed, false);
});

test('navigation ignores split bracketed paste events from a custom terminal', async t => {
  const { view, actions, closes } = model(t);
  await view.ready;
  for (const chunk of ['\x1b[200~', 'd', 'q', '\x1b[201~']) view.handleInput(chunk);
  assert.deepEqual(actions, []);
  assert.deepEqual(closes, []);
  assert.equal(view.closed, false);
});

test('split search pastes keep newlines and action letters inside the editor', async t => {
  const { view, actions, closes } = model(t);
  await view.ready;
  view.handleInput('/');
  for (const chunk of ['\x1b[200~', '\r', 'd', 'q', '\x03', '\x1b[201~']) view.handleInput(chunk);
  await view.ready;
  assert.equal(view.searchMode, true);
  assert.equal(view.input.getValue(), 'dq');
  assert.deepEqual(actions, []);
  assert.deepEqual(closes, []);
});

test('j/k, arrow keys and page keys move and clamp the selection', async t => {
  const { view } = model(t);
  await view.ready;
  for (const [key, expected] of [['k', 0], ['j', 1], ['\x1b[B', 2], ['\x1b[A', 1],
    ['\x1b[6~', 18], ['\x1b[5~', 1], ['\x1b[5~', 0]]) {
    view.handleInput(key);
    assert.equal(view.selectedIndex, expected);
  }
  for (let i = 0; i < 10; i++) view.handleInput('\x1b[6~');
  assert.equal(view.selectedIndex, issues.length - 1);
  view.handleInput('/');
  view.handleInput('\x1b[A');
  assert.equal(view.selectedIndex, issues.length - 2);
  assert.equal(view.input.getValue(), '');
});

test('preview keys scroll independently and reset or clamp after selection and resize', async t => {
  const { view } = model(t);
  await view.ready;
  view.render(120);
  assert.ok(view.previewLimit > 0);
  view.handleInput('\x1b[1;2B');
  assert.equal(view.previewOffset, 1);
  view.handleInput('\x1bj');
  assert.equal(view.previewOffset, 18);
  view.handleInput('\x1b[1;2A');
  assert.equal(view.previewOffset, 17);
  view.handleInput('\x1bk');
  assert.equal(view.previewOffset, 0);
  for (let i = 0; i < 20; i++) view.handleInput('\x1bj');
  assert.equal(view.previewOffset, view.previewLimit);
  assert.equal(view.selectedIndex, 0);
  view.handleInput('j');
  view.render(120);
  assert.equal(view.previewOffset, 0);
  view.handleInput('\x1bj');
  view.terminal.rows = 200;
  assert.equal(view.render(120).length, 200);
  assert.equal(view.previewLimit, 0);
  assert.equal(view.previewOffset, 0);
  view.terminal.rows = 12;
  view.render(120);
  view.handleInput('\x1bj');
  assert.equal(view.previewOffset, 5);
  view.terminal.columns = 60;
  view.render(60);
  assert.equal(view.previewOffset, 0);
});

test('filtering preserves a surviving selection and resets the preview when it disappears', async t => {
  const { view } = model(t, { filter: async (source, query) => query === 'x' ? [source[2], source[1]] : query === 'xy' ? [source[3]] : source }, { selected: 'DATA-2' });
  await view.ready;
  view.render(120);
  view.handleInput('\x1bj');
  view.handleInput('/');
  view.handleInput('x');
  await view.ready;
  assert.equal(view.matches[view.selectedIndex].key, 'DATA-2');
  view.handleInput('y');
  await view.ready;
  view.render(120);
  assert.equal(view.matches[view.selectedIndex].key, 'DATA-4');
  assert.equal(view.previewOffset, 0);
});

test('returned query and selected key restore state across board instances', async t => {
  const first = model(t, {}, { query: 'Ticket', selected: 'DATA-3' });
  await first.view.ready;
  first.view.handleInput('j');
  first.view.handleInput('r');
  const state = first.actions[0];
  const second = model(t, { filter: async source => [...source].reverse() }, state);
  await second.view.ready;
  assert.equal(second.view.input.getValue(), 'Ticket');
  assert.equal(second.view.matches[second.view.selectedIndex].key, 'DATA-4');
});

for (const action of ['a', 'r']) {
  test(`empty matches allow ${action} but block ticket actions`, async t => {
    const { view, actions } = model(t, { filter: async () => [] });
    await view.ready;
    for (const key of ['d', 's', 'p', 'c', 'j', 'k', '\x1b[6~']) view.handleInput(key);
    assert.deepEqual(actions, []);
    assert.match(plain(view.render(120))[5], /No tickets match/);
    view.handleInput(action);
    assert.deepEqual(actions, [{ query: '', action, selected: undefined, sort: null }]);
  });
}

for (const [columns, rows] of [[37, 24], [120, 7], [0, 0]]) {
  test(`a ${columns}x${rows} terminal blocks ticket writes`, async t => {
    const { view, actions } = model(t, { terminal: { columns, rows } });
    await view.ready;
    for (const key of ['d', 's', 'p', 'c']) view.handleInput(key);
    assert.deepEqual(actions, []);
    assert.equal(view.closed, false);
    assert.equal(view.render(columns).length, rows);
  });
}

test('stale asynchronous successes and failures cannot replace newer matches', async t => {
  const calls = [];
  const { view, actions } = model(t, { filter: (source, query, { signal }) => {
    const pending = deferred();
    calls.push({ query, signal, ...pending });
    return pending.promise;
  } });
  const initialReady = view.ready;
  view.handleInput('/');
  view.handleInput('a');
  const staleReady = view.ready;
  view.handleInput('b');
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, true);
  calls[2].resolve([issues[3]]);
  await view.ready;
  calls[0].resolve([issues[0]]);
  calls[1].reject(new Error('stale failure'));
  await Promise.all([initialReady, staleReady]);
  assert.deepEqual(view.matches, [issues[3]]);
  assert.equal(view.error, '');
  assert.equal(view.busy, false);
  view.handleInput('\r');
  view.handleInput('s');
  assert.equal(actions[0].selected, 'DATA-4');
});

test('cancellation ignores a late filter completion and requests no further renders', async t => {
  const pending = deferred();
  let signal;
  const { view, actions, closes, renders } = model(t, { filter: (source, query, options) => {
    signal = options.signal;
    return pending.promise;
  } });
  view.handleInput('q');
  const renderCount = renders.length;
  assert.equal(signal.aborted, true);
  pending.resolve([issues[9]]);
  await view.ready;
  view.handleInput('d');
  assert.equal(renders.length, renderCount);
  assert.equal(closes.length, 1);
  assert.deepEqual(actions, []);
  assert.notDeepEqual(view.matches, [issues[9]]);
});

test('a late rejected filter is ignored after cancellation', async t => {
  const pending = deferred();
  const { view, actions, errors, closes, renders } = model(t, { filter: () => pending.promise });
  view.handleInput('q');
  const count = renders.length;
  pending.reject(new Error('late failure'));
  await view.ready;
  assert.equal(view.error, '');
  assert.equal(renders.length, count);
  assert.deepEqual(actions, []);
  assert.deepEqual(errors, []);
  assert.equal(closes.length, 1);
});

test('initial state sanitises unsafe query and header text', async t => {
  const { view } = model(t, {}, { query: '\x1b[31m東京\x1b[0m\nnext\titem\x07\u202e', header: '\x1b[31mBoard\x1b[0m\nheading\x07' });
  await view.ready;
  assert.equal(view.input.getValue(), '東京 next item');
  const rows = view.render(120);
  assert.match(plain(rows)[2], /Board heading/);
  assert.doesNotMatch(rows.join(''), /\x1b\[31m|\x07|\u202e/);
});

for (const action of ['a', 'r']) {
  test(`${action} remains available during a pending search`, async t => {
    const search = deferred();
    let signal;
    const { view, actions } = model(t, { filter: (source, query, options) => {
      signal = options.signal;
      return search.promise;
    } });
    view.handleInput(action);
    assert.deepEqual(actions, [{ query: '', action, selected: 'DATA-1', sort: null }]);
    assert.equal(signal.aborted, true);
    search.resolve([]);
    await view.ready;
  });
}

test('filter failures clear stale matches and status, block actions and permit recovery', async t => {
  let fail = false;
  const { view, actions, errors } = model(t, { filter: async source => {
    if (fail) throw new Error('fzf failed');
    return source;
  } });
  await view.ready;
  fail = true;
  view.handleInput('/');
  view.handleInput('x');
  await view.ready;
  assert.deepEqual(view.matches, []);
  assert.equal(view.busy, false);
  const text = plain(view.render(120));
  assert.match(text[2], /Fuzzy search failed/);
  assert.doesNotMatch(text[2], /Searching/);
  assert.match(text[5], /No tickets match/);
  view.handleInput('\r');
  for (const key of ['d', 's', 'p', 'c']) view.handleInput(key);
  assert.deepEqual(actions, []);
  assert.deepEqual(errors, []);
  fail = false;
  view.handleInput('/');
  view.handleInput('\x7f');
  await view.ready;
  assert.equal(view.error, '');
  assert.equal(view.matches.length, issues.length);
});

for (const [width, height] of [[80, 24], [120, 40]]) {
  test(`the real model fills ${width}x${height}, retains five headings and spans the table and any preview with its footer`, async t => {
    const { view, errors } = model(t, { terminal: { columns: width, rows: height } }, { header: 'My board' });
    await view.ready;
    const rows = view.render(width);
    assert.equal(rows.length, height);
    for (const row of rows) {
      assert.equal(visibleWidth(row), width);
      assert.doesNotMatch(row, /[\r\n\t]/);
    }
    const text = plain(rows);
    assert.match(text[3], width >= 120 ? /Ticket ID.*Created.*Name.*Status.*Assignee.*Preview/ : /Ticket ID.*Created.*Name.*Status.*Assignee\s*$/);
    assert.match(text[height - 1], /esc quit.*1\/40\s*$/);
    assert.ok(visibleWidth(text[height - 1].trimEnd()) > measureBoard(width, height).tableWidth);
    assert.deepEqual(errors, []);
  });
}

test('a height-only resize updates row count, page movement and preview bounds', async t => {
  const { view } = model(t);
  await view.ready;
  assert.equal(view.render(120).length, 24);
  view.terminal.rows = 12;
  assert.equal(view.render(120).length, 12);
  view.handleInput('\x1b[6~');
  assert.equal(view.selectedIndex, 5);
  view.terminal.rows = 40;
  assert.equal(view.render(120).length, 40);
  view.handleInput('\x1b[6~');
  assert.equal(view.selectedIndex, 38);
});

test('render failures report one error and return bounded fallback rows', async t => {
  const { view, errors, actions } = model(t);
  await view.ready;
  assert.deepEqual(view.render(-1), Array(24).fill(''));
  await Promise.resolve();
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /render/);
  view.render(-1);
  view.handleInput('d');
  await Promise.resolve();
  assert.equal(errors.length, 1);
  assert.deepEqual(actions, []);
});

test('input failures close the model and report one error', async t => {
  const { view, errors, actions } = model(t);
  await view.ready;
  view.terminal.rows = -1;
  view.handleInput('d');
  view.handleInput('d');
  assert.equal(view.closed, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /input/);
  assert.deepEqual(actions, []);
});

test('browse lifecycle', { concurrency: false, timeout: 10000 }, async t => {
  for (const key of ['q', '\x1b', '\x03', 'd', 's', 'p', 'c', 'a', 'r']) {
    await t.test(`restores the terminal and listeners after ${JSON.stringify(key)}`, async () => {
      const before = listeners();
      const terminal = new FakeTerminal();
      const pending = browse(issues, { query: '', selected: 'DATA-2' }, { terminal, filter: async source => source });
      const result = pending.then(value => value);
      try {
        assert.equal(typeof terminal.onInput, 'function');
        assert.equal(typeof terminal.onResize, 'function');
        await delay(160);
        const writes = terminal.output.length;
        terminal.rows = 30;
        terminal.onResize();
        await delay(40);
        assert.ok(terminal.output.length > writes, 'A height-only resize must repaint');
        terminal.onInput(key);
        terminal.onInput('d');
        terminal.onInput('q');
        assert.deepEqual(await result, ['q', '\x1b', '\x03'].includes(key) ? null : { query: '', action: key, selected: 'DATA-2', sort: null });
      } finally {
        terminal.onInput('q');
        await pending;
      }
      restored(terminal);
      assert.deepEqual(listeners(), before);
    });
  }
  await t.test('cancellation aborts an unfinished startup search', async () => {
    const before = listeners();
    const terminal = new FakeTerminal();
    const search = deferred();
    let signal;
    const pending = browse(issues, {}, { terminal, filter: (source, query, options) => {
      signal = options.signal;
      return search.promise;
    } });
    terminal.onInput('q');
    assert.equal(await pending, null);
    assert.equal(signal.aborted, true);
    const writes = terminal.output.length;
    search.resolve(issues);
    await delay(25);
    assert.equal(terminal.output.length, writes);
    restored(terminal);
    assert.deepEqual(listeners(), before);
  });
  await t.test('input failure restores raw mode, alternate mode and listeners', async () => {
    const before = listeners();
    const terminal = new FakeTerminal();
    const pending = browse(issues, {}, { terminal, filter: async source => source });
    const rejection = assert.rejects(pending, /Could not handle board input/);
    await delay(160);
    terminal.rows = -1;
    terminal.onInput('d');
    await rejection;
    restored(terminal);
    assert.deepEqual(listeners(), before);
  });
  await t.test('startup failure restores partially entered raw and alternate modes', async () => {
    const before = listeners();
    const terminal = new FakeTerminal();
    terminal.startError = new Error('terminal startup failed');
    await assert.rejects(browse(issues, {}, { terminal, filter: async source => source }), /terminal startup failed/);
    restored(terminal);
    assert.deepEqual(listeners(), before);
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`browse restores the terminal and listeners on ${signal} in an isolated child`, { timeout: 5000 }, async () => {
    const code = `
      import assert from 'node:assert/strict';
      import { setTimeout as delay } from 'node:timers/promises';
      import { browse } from ${JSON.stringify(new URL('../lib/board.mjs', import.meta.url).href)};
      ${FakeTerminal.toString()}
      const events = ${JSON.stringify(listenerEvents)};
      const before = events.map(event => process.listeners(event));
      const terminal = new FakeTerminal();
      let signal;
      const pending = browse([], {}, { terminal, filter: (source, query, options) => {
        signal = options.signal;
        return new Promise(() => {});
      } });
      await delay(160);
      const watchdog = setTimeout(() => { throw new Error('Signal did not close the board'); }, 2000);
      try {
        process.kill(process.pid, ${JSON.stringify(signal)});
        assert.equal(await pending, null);
      } finally {
        clearTimeout(watchdog);
      }
      assert.equal(signal.aborted, true);
      (${restored.toString()})(terminal);
      assert.deepEqual(events.map(event => process.listeners(event)), before);
      process.stdout.write('restored');
    `;
    const { stdout, stderr } = await exec(process.execPath, ['--input-type=module', '-e', code], { timeout: 4000 });
    assert.equal(stdout, 'restored');
    assert.equal(stderr, '');
  });
}
