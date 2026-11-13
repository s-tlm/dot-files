import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { stripVTControlCharacters } from 'node:util';

export const POINTS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
export function safeText(value) {
  return stripVTControlCharacters(String(value ?? '')).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
}
export function description(value) {
  if (value == null) return '(No description)';
  if (typeof value === 'string') return safeText(value);
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string' ||
      (node.content !== undefined && !Array.isArray(node.content)) || depth > 100) throw new Error('Malformed ADF description.');
    const children = node.content ?? [];
    if (node.type === 'text') {
      if (typeof node.text !== 'string') throw new Error('Malformed ADF text.');
      return node.text;
    }
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'mention') return node.attrs?.text ?? '[mention]';
    if (node.type === 'emoji') return node.attrs?.text ?? node.attrs?.shortName ?? '[emoji]';
    if (node.type === 'status') return node.attrs?.text ?? '[status]';
    if (['inlineCard', 'blockCard'].includes(node.type)) return node.attrs?.url ?? '[link]';
    if (node.type === 'media') return node.attrs?.alt || '[media]';
    if (node.type === 'rule') return '\n---\n';
    if (['bulletList', 'orderedList'].includes(node.type)) {
      const start = Number.isSafeInteger(node.attrs?.order) ? node.attrs.order : 1;
      return children.map((child, index) => `${node.type === 'bulletList' ? '- ' : `${start + index}. `}${walk(child, depth + 1).trimEnd()}`).join('\n') + '\n';
    }
    // shortcut: merged table cells use plain separators, use a rich renderer if exact layout is needed.
    if (node.type === 'tableRow') return children.map(child => walk(child, depth + 1).trim().replace(/\n+/g, ' / ')).join(' | ') + '\n';
    const body = children.map(child => walk(child, depth + 1)).join('');
    return body + (['paragraph', 'heading', 'codeBlock', 'mediaSingle', 'mediaGroup'].includes(node.type) ? '\n' : '');
  };
  const text = safeText(walk(value));
  return text.trim() ? text : '(No description)';
}
export function preview(issue) {
  const f = issue.fields;
  return `${issue.key}: ${safeText(f.summary)}\n\nStatus: ${safeText(f.status?.name)}\nPoints: ${f.points ?? 'Not set'}\nReporter: ${safeText(f.reporter?.displayName ?? 'Unknown')}\nAssignee: ${safeText(f.assignee?.displayName ?? 'Unassigned')}\n\n${description(f.description)}\n`;
}
export function assignees(issues, me) {
  const entries = new Map();
  for (const { fields: { assignee } } of issues) {
    if (assignee?.accountId) entries.set(assignee.accountId, safeText(assignee.displayName));
  }
  return [['all', 'All assignees'], [me, 'My tickets'], ['unassigned', 'Unassigned'],
    ...[...entries].map(([id, name]) => [id, `${name} (${id})`])];
}
export function filtered(issues, assignee) {
  return issues.filter(i => assignee === 'all' || (assignee === 'unassigned' ? !i.fields.assignee : i.fields.assignee?.accountId === assignee));
}
export function shellQuote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }
export function run(command, args, { input, inherit = false, env = process.env, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'inherit'], env, signal });
    let output = '';
    child.stdout?.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0 || code === 1 || code === 130) resolve({ code, output });
      else reject(new Error(`${command} exited with code ${code}`));
    });
    child.stdin?.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.stdin?.end(input ?? '');
  });
}
export async function choose(title, choices, { previewFile } = {}) {
  const args = ['--layout=reverse', '--border', '--header', safeText(title), '--delimiter=\t', '--with-nth=2..'];
  if (previewFile) args.push('--preview', `cat ${shellQuote(previewFile)}`, '--preview-window=right,65%,wrap');
  const { code, output } = await run('fzf', args, { input: choices.map(([id, label]) => `${id}\t${safeText(label).replaceAll('\n', ' ')}`).join('\n'),
    env: { ...process.env, FZF_DEFAULT_OPTS: '', FZF_DEFAULT_OPTS_FILE: '' } });
  return code === 0 ? output.split('\t')[0] : null;
}
export async function confirm(title, text, dir) {
  const file = `${dir}/confirmation.txt`;
  await writeFile(file, safeText(text), { mode: 0o600 });
  return await choose(title, [['cancel', 'Cancel'], ['submit', 'Submit']], { previewFile: file }) === 'submit';
}
export async function editComment(key, dir) {
  const file = `${dir}/${key}.draft`;
  await writeFile(file, '', { flag: 'a', mode: 0o600 });
  const result = await run(process.env.VISUAL || process.env.EDITOR || 'vi', [file], { inherit: true });
  if (result.code !== 0) throw new Error('Editor failed. Your draft is retained for this session.');
  const body = await readFile(file, 'utf8');
  if (!body.trim()) throw new Error('A comment cannot be blank.');
  return body;
}
