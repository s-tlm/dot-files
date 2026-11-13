import { setTimeout as delay } from 'node:timers/promises';
import { POINTS } from './browser.mjs';
import { validateProject, validateSettings, validateStoryPointsField } from './settings.mjs';
const uncertain = ' Check Jira before repeating the write. No automatic retry was made.';
export function issueKey(key, project) {
  validateProject(project);
  if (typeof key !== 'string' || !new RegExp(`^${project}-[1-9]\\d*$`).test(key)) throw new Error(`Invalid ${project} ticket key.`);
  return key;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Malformed ${label}.`);
  return value;
}
export function normaliseIssue(issue, { project, storyPointsField } = {}) {
  issueKey(issue?.key, project);
  validateStoryPointsField(storyPointsField);
  const fields = object(issue.fields, 'issue fields');
  if (typeof fields.summary !== 'string') throw new Error('Malformed issue summary.');
  const points = fields[storyPointsField] ?? null;
  if (points !== null && (typeof points !== 'number' || !Number.isFinite(points))) throw new Error('Malformed story points.');
  if (fields.assignee && (typeof fields.assignee.accountId !== 'string' || !fields.assignee.accountId.trim())) throw new Error('Malformed assignee.');
  return { ...issue, fields: { ...fields, points } };
}
export function commentDocument(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('A comment cannot be blank.');
  return { type: 'doc', version: 1, content: text.replace(/\r\n?/g, '\n').split('\n').map(line => ({
    type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [],
  })) };
}
export class Jira {
  #authorization;
  constructor({ email, token, ...settings } = {}, { fetch = globalThis.fetch, timeout = 10_000, budget = 30_000, sleep = delay } = {}) {
    if (typeof email !== 'string' || !email.includes('@') || /[\s:]/.test(email) || typeof token !== 'string' || !token || /[^\x21-\x7e]/.test(token)) throw new Error('A configured email and Keychain token are required.');
    if (![timeout, budget].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647)) throw new Error('Invalid Jira request timeout.');
    Object.assign(this, validateSettings(settings));
    this.fields = ['description', 'summary', 'assignee', 'reporter', 'status', 'created', this.storyPointsField];
    this.#authorization = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    this.fetch = fetch;
    this.timeout = timeout;
    this.budget = budget;
    this.sleep = sleep;
  }
  async request(path, { method = 'GET', query = {}, body, read = method === 'GET' } = {}) {
    if (!/^\/rest\/(?:api\/3|agile\/1\.0)\/[A-Za-z0-9_/-]+$/.test(path) || path.includes('..') || !['GET', 'POST', 'PUT'].includes(method)) throw new Error('Invalid Jira API request.');
    const url = new URL(`${this.site}${path}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    const deadline = performance.now() + this.budget;
    for (let attempt = 0; ; attempt++) {
      const remaining = Math.ceil(deadline - performance.now());
      if (remaining <= 0) throw new Error(`Jira request exceeded its time budget.${read ? '' : uncertain}`);
      const signal = AbortSignal.timeout(Math.min(this.timeout, remaining));
      let response;
      try {
        response = await this.fetch(url, {
          method, redirect: 'manual', signal,
          headers: { Authorization: this.#authorization, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        throw new Error(read ? 'Jira read failed or timed out.' : `Write outcome is uncertain.${uncertain}`);
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`Jira returned an unexpected redirect. Credentials were not forwarded.${read ? '' : uncertain}`);
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 429 && read && attempt < 2) {
          const retry = response.headers.get('retry-after');
          const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry.trim()) ? Number(retry) : null;
          const date = retry && /[a-z]/i.test(retry) ? Date.parse(retry) : NaN;
          const wait = seconds !== null ? seconds * 1000 : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 1000 * (attempt + 1);
          if (wait < deadline - performance.now()) { await this.sleep(wait); continue; }
        }
        const reason = response.status === 401 ? 'Token rejected or expired. Check your email and Keychain token.'
          : response.status === 403 ? 'Access denied. Check Jira permissions and organisation policy.'
            : response.status === 429 ? 'Rate limited. The bounded read retry budget is exhausted or no write retry is allowed.'
              : response.status === 404 ? 'Resource not found or not visible to your account.' : 'Request rejected. Check the selected operation in Jira.';
        throw new Error(`Jira HTTP ${response.status}: ${reason}${read ? '' : uncertain}`);
      }
      let text;
      try { text = await response.text(); }
      catch { throw new Error(read ? 'Jira response read failed or timed out.' : `Write outcome is uncertain.${uncertain}`); }
      if (!text.trim() && !read) return {};
      try { return object(JSON.parse(text), 'Jira response'); }
      catch { throw new Error(`Jira returned a malformed JSON response.${read ? '' : ` Write outcome is uncertain.${uncertain}`}`); }
    }
  }
  async init() {
    this.me = await this.request('/rest/api/3/myself');
    if (typeof this.me.accountId !== 'string' || !this.me.accountId) throw new Error('Jira did not return your account ID.');
    return this;
  }
  async sprints() {
    const all = [], seen = new Set();
    let startAt = 0;
    while (true) {
      const page = await this.request(`/rest/agile/1.0/board/${this.board}/sprint`, { query: { state: 'active', startAt, maxResults: 50 } });
      if (!Array.isArray(page.values) || typeof page.isLast !== 'boolean') throw new Error('Malformed active sprint page.');
      if (page.startAt !== undefined && page.startAt !== startAt) throw new Error('Repeated or non-progressing sprint page offset.');
      const signature = JSON.stringify(page.values);
      if (seen.has(signature)) throw new Error('Repeated sprint page.');
      seen.add(signature);
      all.push(...page.values);
      if (page.isLast) return all;
      if (!page.values.length) throw new Error('Empty nonterminal sprint page.');
      startAt += page.values.length;
    }
  }
  async scope() {
    const board = await this.request(`/rest/agile/1.0/board/${this.board}/configuration`);
    const filterId = Number(board.filter?.id);
    if (board.id !== this.board || !Number.isSafeInteger(filterId) || filterId <= 0 || board.estimation?.field?.fieldId !== this.storyPointsField) throw new Error('Unexpected board or estimation configuration.');
    const filter = await this.request(`/rest/api/3/filter/${filterId}`);
    if (String(filter.id) !== String(filterId) || typeof filter.jql !== 'string' || !filter.jql.trim()) throw new Error('The board saved filter could not be resolved.');
    const sprints = await this.sprints();
    if (sprints.some(s => s?.state !== 'active' || !Number.isSafeInteger(s.id) || s.id <= 0)) throw new Error('Malformed active sprint.');
    if (sprints.length !== 1) return { issues: [], state: sprints.length ? 'Multiple active sprints. Select a unique active sprint in Jira, then refresh.' : 'No active sprint. Refresh after a sprint starts.' };
    const sprint = sprints[0];
    return { filterId, sprint, jql: `project = ${this.project} AND filter = ${filterId} AND sprint = ${sprint.id}` };
  }
  async search(jql) {
    const issues = new Map(), seen = new Set();
    let nextPageToken;
    do {
      const page = await this.request('/rest/api/3/search/jql', { method: 'POST', read: true, body: {
        jql: `${jql} ORDER BY key ASC`, fields: this.fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}),
      } });
      if (!Array.isArray(page.issues) || typeof page.isLast !== 'boolean' || (page.warnings?.length)) throw new Error('Malformed or incomplete issue page.');
      for (const issue of page.issues) issues.set(issue.key, normaliseIssue(issue, this));
      if (page.isLast) break;
      nextPageToken = page.nextPageToken;
      if (typeof nextPageToken !== 'string' || !nextPageToken || seen.has(nextPageToken)) throw new Error('Missing or repeated issue cursor.');
      seen.add(nextPageToken);
    } while (true);
    return [...issues.values()];
  }
  async snapshot() {
    const scope = await this.scope();
    if (!scope.sprint) return scope;
    return { ...scope, issues: await this.search(scope.jql), state: scope.sprint.name };
  }
  async assertScope(key) {
    issueKey(key, this.project);
    const scope = await this.scope();
    if (!scope.sprint || !(await this.search(`${scope.jql} AND key = ${key}`)).some(i => i.key === key)) throw new Error(`${key} is no longer in the active board scope. Refresh before continuing.`);
  }
  async transitions(key) {
    await this.assertScope(key);
    const value = await this.request(`/rest/api/3/issue/${key}/transitions`, { query: { expand: 'transitions.fields' } });
    if (!Array.isArray(value.transitions) || value.transitions.some(t => typeof t?.id !== 'string' || typeof t.name !== 'string' || !t.fields || typeof t.fields !== 'object' || Array.isArray(t.fields))) throw new Error('Malformed transitions.');
    return value.transitions.filter(t => t.isAvailable !== false);
  }
  async transition(key, id) {
    const transitions = await this.transitions(key);
    const transition = transitions.find(t => t.id === id);
    if (!transition) throw new Error('That workflow transition is no longer available.');
    const required = Object.entries(transition.fields).filter(([, f]) => f.required);
    if (required.length) throw new Error(`Complete this transition in Jira. Required fields: ${required.map(([id, f]) => f.name ?? id).join(', ')}.`);
    return this.request(`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: { transition: { id } } });
  }
  async points(key, points) {
    if (!POINTS.includes(points)) throw new Error('Choose a Fibonacci story-points value.');
    await this.assertScope(key);
    await this.request(`/rest/api/3/issue/${key}`, { method: 'PUT', body: { fields: { [this.storyPointsField]: points } } });
    try {
      const issue = normaliseIssue(await this.request(`/rest/api/3/issue/${key}`, { query: { fields: this.fields.join(',') } }), this);
      if (issue.key !== key || issue.fields.points !== points) throw new Error('Read-back mismatch.');
      return issue;
    } catch {
      throw new Error('Story points were not confirmed after the write returned. Check Jira before repeating the change.');
    }
  }
  async comment(key, commentBody) {
    const body = commentDocument(commentBody);
    await this.assertScope(key);
    return this.request(`/rest/api/3/issue/${key}/comment`, { method: 'POST', body: { body } });
  }
}
