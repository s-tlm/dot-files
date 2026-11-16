import { stripVTControlCharacters } from 'node:util';
import { visibleWidth, truncateToWidth } from '@mariozechner/pi-tui';
import { safeText } from './browser.mjs';

const reset = '\x1b[0m';
const muted = text => `\x1b[38;5;8m${text}${reset}`;
const danger = text => (text ? `\x1b[1;31m${text}${reset}` : '');
const plain = value => safeText(String(value ?? '').replace(/[\r\n\t]+/g, ' '));
const fit = (text, width) => {
  if (width <= 0) return '';
  const clipped = truncateToWidth(text, width, '…');
  return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
};
// pi-tui wraps its ellipsis in full resets, which would end a row's dim and selection background mid-row.
// Cell text is already plain, so its clipped output can drop those resets safely.
const fitCell = (text, width) => fit(visibleWidth(text) <= width || width <= 0 ? text
  : `${stripVTControlCharacters(truncateToWidth(text, width - 1, ''))}…`, width);

// Follows the column order, left to right.
export const SORTS = ['key', 'created', 'name', 'status', 'assignee'];

// Jira returns ISO timestamps such as 2026-11-13T12:00:00.000+1100; show the date in Jira's offset.
export const createdDate = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '');

// Catppuccin Mocha, matching the Herdr theme.
const PALETTE = {
  red: '#f38ba8', yellow: '#f9e2af', mauve: '#cba6f7', blue: '#89b4fa', green: '#a6e3a1',
  teal: '#94e2d5', peach: '#fab387', lavender: '#b4befe', overlay: '#7f849c',
};
// Jira's categories put Blocked with In Progress and Review with To Do, so names take precedence.
const STATUS_STYLES = [
  ['blocked', { colour: PALETTE.red, bold: true }], ['in progress', { colour: PALETTE.yellow }],
  ['review', { colour: PALETTE.mauve }], ['to do', { colour: PALETTE.blue }],
  ['backlog', { colour: PALETTE.overlay }], ['done', { colour: PALETTE.green }],
];
const STATUS_BY_NAME = new Map(STATUS_STYLES);
const CATEGORY_STYLES = { new: { colour: PALETTE.blue }, indeterminate: { colour: PALETTE.yellow }, done: { colour: PALETTE.green } };
export const statusStyle = status => STATUS_BY_NAME.get(String(status?.name ?? '').trim().toLowerCase())
  ?? CATEGORY_STYLES[status?.statusCategory?.key] ?? null;
const isDone = status => status?.statusCategory?.key === 'done' || String(status?.name ?? '').trim().toLowerCase() === 'done';

const DAY = 86_400_000;
export function ageColour(created, now) {
  const days = Math.floor((now - Date.parse(created ?? '')) / DAY);
  if (!Number.isFinite(days)) return null;
  if (days <= 7) return PALETTE.teal;
  if (days <= 30) return null;
  return days <= 90 ? PALETTE.peach : PALETTE.red;
}

// Resets only the attributes it sets, so the selected row's background stays continuous.
function paint(text, style, enabled) {
  if (!enabled || !style?.colour || !text) return text;
  const [r, g, b] = [1, 3, 5].map(index => parseInt(style.colour.slice(index, index + 2), 16));
  const body = style.bold ? `\x1b[1m${text}\x1b[22m` : text;
  return `\x1b[38;2;${r};${g};${b}m${body}\x1b[39m`;
}

export function statusSummary(issues, colour = !process.env.NO_COLOR) {
  const counts = new Map();
  for (const issue of issues) {
    const status = issue.fields?.status;
    const name = plain(status?.name).trim();
    if (!name) continue;
    const entry = counts.get(name.toLowerCase()) ?? { name, status, count: 0 };
    entry.count++;
    counts.set(name.toLowerCase(), entry);
  }
  const order = STATUS_STYLES.map(([name]) => name);
  const rank = key => (order.includes(key) ? order.indexOf(key) : order.length);
  return [...counts].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([, { name, status, count }]) => paint(`${count} ${name}`, statusStyle(status), colour))
    .join(muted(' · '));
}

export function measureBoard(width, height, previewHidden = false) {
  if (![width, height].every(value => Number.isFinite(value) && Number.isInteger(value) && value >= 0)) {
    throw new RangeError('Board dimensions must be finite nonnegative integers.');
  }
  const padding = width >= 4 ? 1 : 0;
  const innerWidth = width - padding * 2;
  const bodyHeight = Math.max(0, height - 7);
  const tooSmall = innerWidth < 54 || height < 8;
  // Show the preview only while the five-column table keeps its wide widths.
  const candidate = Math.min(48, Math.max(28, Math.floor(innerWidth * 0.3)));
  const previewWidth = !previewHidden && !tooSmall && innerWidth - candidate - 3 >= 70 ? candidate : 0;
  const tableWidth = innerWidth - (previewWidth ? previewWidth + 3 : 0);
  return { width, height, padding, innerWidth, tableWidth, previewWidth, bodyHeight, tooSmall };
}

function footer(width, index, count, searchMode, scrollable) {
  // Letters are query text while searching, so search mode keeps the arrow hints.
  const pairs = (searchMode
    ? [['↑↓', 'move'], ['Enter', 'navigate'], ['Esc', 'navigate'], ['⇧↑↓', 'scroll']]
    : [['j/k', 'move'], ['/', 'search'], ['e', 'edit'], ['d', 'peon'], ['f', 'sort'], ['p', 'preview'],
      ['a', 'assignee'], ['r', 'refresh'], ['J/K', 'scroll'], ['esc', 'quit']])
    .filter(([, label]) => scrollable || label !== 'scroll');
  const counter = `${count ? index + 1 : 0}/${count}`;
  if (visibleWidth(counter) > width) return fit('', width);
  const available = width - visibleWidth(counter) - 2;
  const hints = [...pairs];
  const hintWidth = () => visibleWidth(hints.map(pair => pair.join(' ')).join('  '));
  while (hints.length && hintWidth() > available) {
    // Keep the escape hint until no complete hint fits beside the counter.
    const removable = hints.findLastIndex(([key]) => key.toLowerCase() !== 'esc');
    hints.splice(removable < 0 ? 0 : removable, 1);
  }
  const text = hints.map(([key, label]) => `\x1b[38;5;249m${key} ${muted(label)}`).join('  ');
  return text + ' '.repeat(width - visibleWidth(text) - visibleWidth(counter)) + muted(counter);
}

export function renderBoardFrame({
  layout, searchLine = '', header = '', issues = [], selectedIndex = 0,
  previewLines = [], previewOffset = 0, searchMode = false, busy = false, error = '', alert = '', sort = null,
  summary = '', me = null, now = Date.now(), colour = !process.env.NO_COLOR,
}) {
  const { width, height, padding, innerWidth, tableWidth, previewWidth, bodyHeight, tooSmall } = layout;
  const lines = Array(height).fill('');
  const index = Number.isFinite(selectedIndex)
    ? Math.max(0, Math.min(issues.length - 1, Math.trunc(selectedIndex))) : 0;
  const put = (row, text) => {
    if (row >= 0 && row < height) lines[row] = ' '.repeat(padding) + fit(text, innerWidth) + ' '.repeat(padding);
  };
  if (tooSmall) {
    put(0, plain('Widen pane or increase height'));
    if (height > 1) put(height - 1, footer(innerWidth, index, issues.length, searchMode, false));
    return lines.map(line => truncateToWidth(line, width, '…'));
  }
  const widths = tableWidth >= 70 ? [12, 10, tableWidth - 59, 11, 14] : [9, 10, tableWidth - 45, 6, 8];
  const headings = [['Ticket ID', 'key'], ['Created', 'created'], ['Name', 'name'], ['Status', 'status'], ['Assignee', 'assignee']]
    .map(([label, key]) => (key && key === sort ? `${label} ▼` : label));
  // Colour after fitting so styling never changes column widths.
  const cells = (values, styles = []) => values
    .map((value, column) => paint(fitCell(plain(value), widths[column]), styles[column], colour)).join(' │ ');
  const split = (table, preview = '') => fit(table, tableWidth)
    + (previewWidth ? muted(' │ ') + fit(preview, previewWidth) : '');
  const rule = muted('─'.repeat(innerWidth));
  put(0, searchLine);
  put(1, rule);
  put(2, [busy ? 'Searching…' : '', danger(plain(error)), danger(plain(alert)), summary, plain(header)].filter(Boolean).join('  '));
  put(3, split(`\x1b[1;38;5;8m${cells(headings)}${reset}`, 'Preview'));
  put(4, split(muted('─'.repeat(tableWidth)), '─'.repeat(previewWidth)));
  const start = Math.max(0, Math.min(index - Math.floor(bodyHeight / 2), issues.length - bodyHeight));
  const offset = Number.isFinite(previewOffset) ? Math.max(0, Math.trunc(previewOffset)) : 0;
  const selectedStatus = issues[index]?.fields?.status;
  const statusLine = `Status: ${plain(selectedStatus?.name)}`;
  // The preview's Status line precedes the description, so the first exact match is that line.
  const statusRow = previewLines.findIndex(line => plain(line).trimEnd() === statusLine);
  for (let row = 0; row < bodyHeight; row++) {
    const issue = issues[start + row];
    let table = '';
    if (issue) {
      const selected = start + row === index;
      const fields = issue.fields ?? {};
      const done = isDone(fields.status);
      const assigneeStyle = !fields.assignee ? { colour: PALETTE.overlay }
        : me && fields.assignee.accountId === me ? { colour: PALETTE.lavender } : null;
      table = cells([`${selected ? '›' : ' '} ${plain(issue.key)}`, createdDate(fields.created), fields.summary,
        fields.status?.name, fields.assignee?.displayName ?? 'Unassigned'],
      [null, done ? null : { colour: ageColour(fields.created, now) }, null, statusStyle(fields.status), assigneeStyle]);
      if (done && colour) table = `\x1b[2m${table}\x1b[22m`;
      if (selected) table = `\x1b[48;5;237m${table}${reset}`;
    } else if (!issues.length && row === 0) {
      table = 'No tickets match';
    }
    let preview = plain(issues.length ? previewLines[offset + row] ?? '' : row === 0 ? '(No ticket selected)' : '');
    if (issues.length && offset + row === statusRow) preview = `Status: ${paint(plain(selectedStatus?.name), statusStyle(selectedStatus), colour)}`;
    put(5 + row, split(table, preview));
  }
  put(height - 2, rule);
  put(height - 1, footer(innerWidth, index, issues.length, searchMode, previewWidth > 0));
  return lines;
}
