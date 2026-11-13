import { run, safeText } from './browser.mjs';

export async function filterIssues(issues, query, { signal } = {}) {
  if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
  if (!query) return issues;
  const input = issues.map(issue => [issue.key, issue.fields.summary, issue.fields.status?.name,
    issue.fields.assignee?.displayName ?? 'Unassigned'].map(value => safeText(value).replace(/[\t\r\n]/g, ' ')).join('\t')).join('\n');
  const { code, output } = await run('fzf', [`--filter=${query}`, '--delimiter=\t'], {
    input, signal, env: { ...process.env, FZF_DEFAULT_OPTS: '', FZF_DEFAULT_OPTS_FILE: '' },
  });
  if (code === 130) throw new Error('Fuzzy search was interrupted.');
  const byKey = new Map(issues.map(issue => [issue.key, issue]));
  return output.split('\n').filter(Boolean).map(line => {
    const issue = byKey.get(line.split('\t')[0]);
    if (!issue) throw new Error('Fuzzy search returned an unknown ticket.');
    return issue;
  });
}
