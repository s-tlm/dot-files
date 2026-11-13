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

// Jira returns ISO timestamps such as 2026-11-13T12:00:00.000+1100; show the date in Jira's offset.
export const createdDate = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '');

export function measureBoard(width, height) {
  if (![width, height].every(value => Number.isFinite(value) && Number.isInteger(value) && value >= 0)) {
    throw new RangeError('Board dimensions must be finite nonnegative integers.');
  }
  const padding = width >= 4 ? 1 : 0;
  const innerWidth = width - padding * 2;
  const bodyHeight = Math.max(0, height - 7);
  const tooSmall = innerWidth < 54 || height < 8;
  // Show the preview only while the five-column table keeps its wide widths.
  const candidate = Math.min(48, Math.max(28, Math.floor(innerWidth * 0.3)));
  const previewWidth = !tooSmall && innerWidth - candidate - 3 >= 70 ? candidate : 0;
  const tableWidth = innerWidth - (previewWidth ? previewWidth + 3 : 0);
  return { width, height, padding, innerWidth, tableWidth, previewWidth, bodyHeight, tooSmall };
}

function footer(width, index, count, searchMode) {
  const pairs = searchMode
    ? [['↑↓', 'move'], ['Enter', 'navigate'], ['Esc', 'navigate'], ['⇧↑↓', 'preview']]
    : [['↑↓', 'move'], ['/', 'search'], ['f', 'sort'], ['d', 'peon'], ['s', 'status'], ['p', 'points'],
      ['c', 'comment'], ['a', 'assignee'], ['r', 'refresh'], ['⇧↑↓', 'preview'], ['esc', 'quit']];
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
    if (height > 1) put(height - 1, footer(innerWidth, index, issues.length, searchMode));
    return lines.map(line => truncateToWidth(line, width, '…'));
  }
  const widths = tableWidth >= 70 ? [12, 10, tableWidth - 59, 11, 14] : [9, 10, tableWidth - 45, 6, 8];
  const headings = [['Ticket ID', 'key'], ['Created', 'created'], ['Name', 'name'], ['Status', 'status'], ['Assignee', 'assignee']]
    .map(([label, key]) => (key && key === sort ? `${label} ▼` : label));
  const cells = values => values.map((value, column) => fit(plain(value), widths[column])).join(' │ ');
  const split = (table, preview = '') => fit(table, tableWidth)
    + (previewWidth ? muted(' │ ') + fit(plain(preview), previewWidth) : '');
  const rule = muted('─'.repeat(innerWidth));
  put(0, searchLine);
  put(1, rule);
  put(2, [busy ? 'Searching…' : '', danger(plain(error)), danger(plain(alert)), plain(header)].filter(Boolean).join('  '));
  put(3, split(`\x1b[1;38;5;8m${cells(headings)}${reset}`, 'Preview'));
  put(4, split(muted('─'.repeat(tableWidth)), '─'.repeat(previewWidth)));
  const start = Math.max(0, Math.min(index - Math.floor(bodyHeight / 2), issues.length - bodyHeight));
  const offset = Number.isFinite(previewOffset) ? Math.max(0, Math.trunc(previewOffset)) : 0;
  for (let row = 0; row < bodyHeight; row++) {
    const issue = issues[start + row];
    let table = '';
    if (issue) {
      const selected = start + row === index;
      const fields = issue.fields ?? {};
      table = cells([`${selected ? '›' : ' '} ${plain(issue.key)}`, createdDate(fields.created), fields.summary,
        fields.status?.name, fields.assignee?.displayName ?? 'Unassigned']);
      if (selected) table = `\x1b[48;5;237m${table}${reset}`;
    } else if (!issues.length && row === 0) {
      table = 'No tickets match';
    }
    const preview = issues.length ? previewLines[offset + row] ?? '' : row === 0 ? '(No ticket selected)' : '';
    put(5 + row, split(table, preview));
  }
  put(height - 2, rule);
  put(height - 1, footer(innerWidth, index, issues.length, searchMode));
  return lines;
}
