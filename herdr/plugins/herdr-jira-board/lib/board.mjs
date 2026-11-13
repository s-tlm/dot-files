import { Input, Key, ProcessTerminal, Text, TUI, matchesKey, truncateToWidth, visibleWidth } from '@mariozechner/pi-tui';
import { setTimeout as delay } from 'node:timers/promises';
import { preview, safeText } from './browser.mjs';
import { filterIssues } from './fuzzy.mjs';
import { measureBoard, renderBoardFrame } from './board-layout.mjs';

// Follows the column order, left to right.
export const SORTS = ['key', 'created', 'name', 'status', 'assignee'];
const STATUS_RANK = { done: 3, indeterminate: 2, new: 1 };
const byText = (a, b) => (b ?? '').localeCompare(a ?? '', undefined, { sensitivity: 'base' });
// Each order is descending; missing values sort last and ties keep the incoming order.
const keyNumber = issue => Number(/-(\d+)$/.exec(issue.key ?? '')?.[1] ?? NaN);
const COMPARE = {
  key: (a, b) => {
    const [x, y] = [a, b].map(keyNumber);
    return (Number.isNaN(x) - Number.isNaN(y)) || (Number.isNaN(x) ? 0 : y - x);
  },
  name: (a, b) => byText(a.fields?.summary, b.fields?.summary),
  assignee: (a, b) => (!a.fields?.assignee - !b.fields?.assignee)
    || byText(a.fields?.assignee?.displayName, b.fields?.assignee?.displayName),
  created: (a, b) => {
    const [x, y] = [a, b].map(issue => Date.parse(issue.fields?.created ?? ''));
    return (Number.isNaN(x) - Number.isNaN(y)) || (Number.isNaN(x) ? 0 : y - x);
  },
  status: (a, b) => ((STATUS_RANK[b.fields?.status?.statusCategory?.key] ?? 0) - (STATUS_RANK[a.fields?.status?.statusCategory?.key] ?? 0))
    || byText(a.fields?.status?.name, b.fields?.status?.name),
};
export const sortIssues = (issues, sort) => (COMPARE[sort] ? issues.toSorted(COMPARE[sort]) : issues);

class BoardTerminal extends ProcessTerminal {
  // Keep ticket descriptions out of inherited terminal debug logs.
  write(data) { process.stdout.write(data); }
}

export class BoardView {
  constructor(issues, state, { terminal, filter = filterIssues, requestRender = () => {}, onAction = () => {}, onClose = () => {}, onError = () => {} }) {
    this.issues = issues;
    this.matches = issues;
    this.terminal = terminal;
    this.filter = filter;
    this.requestRender = requestRender;
    this.onAction = onAction;
    this.onClose = onClose;
    this.onError = onError;
    this.sort = SORTS.includes(state.sort) ? state.sort : null;
    this.matches = sortIssues(issues, this.sort);
    this.header = state.header ?? '';
    this.alert = state.alert ?? '';
    this.input = new Input();
    this.input.setValue(safeText(state.query ?? '').replace(/[\r\n\t]/g, ' '));
    this.input.handleInput('\x05');
    this.selectedIndex = Math.max(0, this.matches.findIndex(issue => issue.key === state.selected));
    this.searchMode = false;
    this.focused = false;
    this.previewOffset = 0;
    this.previewLimit = 0;
    this.details = new Text('', 0, 0);
    this.closed = false;
    this.error = '';
    this.ready = this.updateMatches();
  }
  invalidate() { this.input.invalidate(); this.details.invalidate(); }
  async updateMatches() {
    this.searchController?.abort();
    const controller = new AbortController();
    this.searchController = controller;
    const selected = this.matches[this.selectedIndex]?.key;
    this.busy = true;
    this.error = '';
    this.requestRender();
    try {
      const matches = await this.filter(this.issues, this.input.getValue(), { signal: controller.signal });
      if (this.closed || controller.signal.aborted) return;
      this.matches = sortIssues(matches, this.sort);
      this.selectedIndex = Math.max(0, matches.findIndex(issue => issue.key === selected));
    } catch {
      if (this.closed || controller.signal.aborted) return;
      this.matches = [];
      this.selectedIndex = 0;
      this.error = 'Fuzzy search failed. Check that fzf is installed, then refresh or edit your query.';
    } finally {
      if (!this.closed && !controller.signal.aborted) {
        this.busy = false;
        this.requestRender();
      }
    }
  }
  move(amount) {
    if (this.busy) return;
    this.selectedIndex = Math.max(0, Math.min(this.matches.length - 1, this.selectedIndex + amount));
  }
  dispose() { this.closed = true; this.searchController?.abort(); this.pasteBuffer = undefined; }
  editQuery(data) {
    const before = this.input.getValue();
    this.input.handleInput(data);
    const cleaned = safeText(this.input.getValue()).replace(/[\r\n\t]/g, ' ');
    if (cleaned !== this.input.getValue()) this.input.setValue(cleaned);
    if (cleaned !== before) this.ready = this.updateMatches();
  }
  handleInput(data) {
    if (this.closed) return;
    try { this.processInput(data); }
    catch { this.dispose(); this.onError(new Error('Could not handle board input.')); }
  }
  processInput(data) {
    if (this.pasteBuffer !== undefined || data.includes('\x1b[200~')) {
      if (this.pasteBuffer === undefined) { this.pasteBuffer = ''; this.pasteInSearch = this.searchMode; }
      this.pasteBuffer += data;
      if (this.pasteBuffer.includes('\x1b[201~')) {
        const paste = this.pasteBuffer;
        this.pasteBuffer = undefined;
        if (this.pasteInSearch) this.editQuery(paste);
        this.requestRender();
      }
      return;
    }
    const layout = measureBoard(this.terminal.columns, this.terminal.rows);
    const page = Math.max(1, layout.bodyHeight);
    if (matchesKey(data, Key.shift('down')) || matchesKey(data, Key.alt('j'))) {
      this.previewOffset = Math.min(this.previewLimit, this.previewOffset + (matchesKey(data, Key.alt('j')) ? page : 1));
    } else if (matchesKey(data, Key.shift('up')) || matchesKey(data, Key.alt('k'))) {
      this.previewOffset = Math.max(0, this.previewOffset - (matchesKey(data, Key.alt('k')) ? page : 1));
    } else if (matchesKey(data, Key.up)) this.move(-1);
    else if (matchesKey(data, Key.down)) this.move(1);
    else if (matchesKey(data, Key.pageUp)) this.move(-page);
    else if (matchesKey(data, Key.pageDown)) this.move(page);
    else if (this.searchMode) {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === '\n' || matchesKey(data, Key.ctrl('c'))) {
        this.searchMode = false;
      } else this.editQuery(data);
    } else if (matchesKey(data, '/')) this.searchMode = true;
    else if (matchesKey(data, Key.escape) || matchesKey(data, 'q') || matchesKey(data, Key.ctrl('c'))) {
      this.dispose();
      this.onClose();
    } else if (matchesKey(data, 'j')) this.move(1);
    else if (matchesKey(data, 'k')) this.move(-1);
    else if (matchesKey(data, 'f')) {
      const selected = this.matches[this.selectedIndex]?.key;
      this.sort = SORTS[(SORTS.indexOf(this.sort) + 1) % SORTS.length];
      this.matches = sortIssues(this.matches, this.sort);
      this.selectedIndex = Math.max(0, this.matches.findIndex(issue => issue.key === selected));
    } else {
      const action = ['a', 'd', 's', 'p', 'c', 'r'].find(key => matchesKey(data, key));
      const selected = this.matches[this.selectedIndex]?.key;
      if (action && (['a', 'r'].includes(action) || (!this.busy && !layout.tooSmall && selected))) {
        const result = { query: this.input.getValue(), action, selected, sort: this.sort };
        this.dispose();
        this.onAction(result);
      }
    }
    if (!this.closed) this.requestRender();
  }
  render(width) {
    try {
      const layout = measureBoard(width, this.terminal.rows);
      this.input.focused = this.focused && this.searchMode;
      let searchLine;
      if (this.searchMode && layout.innerWidth >= 3) {
        searchLine = this.input.render(layout.innerWidth)[0].replace(/^> /, '\x1b[94m❯\x1b[0m ');
      } else {
        searchLine = `\x1b[94m❯\x1b[0m ${this.input.getValue() || '\x1b[90m/ to search tickets…\x1b[0m'}`;
      }
      searchLine = truncateToWidth(searchLine, layout.innerWidth, '');
      const issue = this.matches[this.selectedIndex];
      if (issue?.key !== this.previewKey) {
        this.previewKey = issue?.key;
        this.previewOffset = 0;
        this.details.setText(issue ? preview(issue) : '(No ticket selected)');
      }
      const previewLines = layout.previewWidth ? this.details.render(layout.previewWidth) : [];
      this.previewLimit = Math.max(0, previewLines.length - layout.bodyHeight);
      this.previewOffset = Math.min(this.previewOffset, this.previewLimit);
      const frame = renderBoardFrame({ layout, searchLine, header: this.header, issues: this.matches,
        selectedIndex: this.selectedIndex, previewLines, previewOffset: this.previewOffset,
        searchMode: this.searchMode, busy: this.busy, error: this.error, alert: this.alert, sort: this.sort });
      if (frame.length !== layout.height || frame.some(line => visibleWidth(line) > width)) throw new Error('Invalid board frame.');
      return frame;
    } catch {
      if (!this.closed) {
        this.dispose();
        queueMicrotask(() => this.onError(new Error('Could not render the ticket board.')));
      }
      return Array.from({ length: Math.max(0, this.terminal.rows) }, () => '');
    }
  }
}

export async function browse(issues, state, { terminal, filter } = {}) {
  if (!terminal && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('Open the Jira board in an interactive terminal.');
  const screen = terminal ?? new BoardTerminal();
  const tui = new TUI(screen, true);
  let resolve, reject;
  const result = new Promise((done, fail) => { resolve = done; reject = fail; });
  let finished = false, started = false, restored = false;
  const finish = (value, error) => {
    if (finished) return;
    finished = true;
    view.dispose();
    if (error) reject(error); else resolve(value);
  };
  const view = new BoardView(issues, state, { terminal: screen, filter,
    requestRender: () => { if (!finished) tui.requestRender(); },
    onAction: value => finish(value), onClose: () => finish(null), onError: error => finish(null, error) });
  tui.addChild(view);
  tui.setFocus(view);
  const restore = () => {
    if (restored || !started) return;
    restored = true;
    try { tui.stop(); } finally { screen.write('\x1b[?1049l'); }
  };
  const emergencyRestore = () => { try { restore(); } catch { /* Preserve the original fatal error. */ } };
  const onSignal = () => finish(null);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('exit', emergencyRestore);
  process.once('uncaughtExceptionMonitor', emergencyRestore);
  const startTime = performance.now();
  try {
    screen.write('\x1b[?1049h\x1b[2J\x1b[H');
    started = true;
    tui.start();
    return await result;
  } finally {
    view.dispose();
    // shortcut: pi-tui 0.73.1 leaves a 150 ms startup timer, remove this wait when stop cancels it upstream.
    if (screen instanceof ProcessTerminal) await delay(Math.max(0, 160 - (performance.now() - startTime)));
    try { restore(); }
    finally {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      process.removeListener('exit', emergencyRestore);
      process.removeListener('uncaughtExceptionMonitor', emergencyRestore);
    }
  }
}
