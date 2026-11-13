import test from 'node:test';
import assert from 'node:assert/strict';
import { Jira, issueKey as checkKey, normaliseIssue as normalise, commentDocument } from '../lib/jira.mjs';
import { assignees, filtered, description, POINTS } from '../lib/browser.mjs';
import { settings, site, board as BOARD, project, storyPointsField as POINT_FIELD } from './fixtures.mjs';

const issueKey = key => checkKey(key, project);
const normaliseIssue = value => normalise(value, settings);
const fields = ['description', 'summary', 'assignee', 'reporter', 'status', 'created', POINT_FIELD];
const issue = (key = 'DATA-1', extra = {}) => ({ key, fields: { summary: 'A ticket', assignee: null, ...extra } });
const page = (values, isLast = true) => ({ values, isLast });
const issuePage = (issues, isLast = true, nextPageToken) => ({ issues, isLast, nextPageToken });
const sprint = (id = 100) => ({ id, name: `Sprint ${id}`, state: 'active' });
const jql = 'project = DATA AND filter = 42 AND sprint = 100';
const boardPath = `/rest/agile/1.0/board/${BOARD}`;
const ticketPath = '/rest/api/3/issue/DATA-1';
const routes = {
  me: 'GET /rest/api/3/myself',
  board: `GET ${boardPath}/configuration`,
  filter: 'GET /rest/api/3/filter/42',
  sprints: `GET ${boardPath}/sprint`,
  search: 'POST /rest/api/3/search/jql',
  transitions: `GET ${ticketPath}/transitions`,
  transition: `POST ${ticketPath}/transitions`,
  points: `PUT ${ticketPath}`,
  issue: `GET ${ticketPath}`,
  comment: `POST ${ticketPath}/comment`,
};

async function fixture(overrides = {}) {
  const calls = [];
  const handlers = {
    [routes.me]: () => ({ accountId: 'me' }),
    [routes.board]: () => ({ id: BOARD, filter: { id: '42' }, estimation: { field: { fieldId: POINT_FIELD } } }),
    [routes.filter]: () => ({ id: '42', jql: 'project = DATA AND team = platform' }),
    [routes.sprints]: () => page([sprint()]),
    [routes.search]: () => issuePage([issue()]),
    [routes.transitions]: () => ({ transitions: [{ id: '31', name: 'Done', fields: {} }] }),
    [routes.transition]: () => new Response(null, { status: 204 }),
    [routes.points]: () => new Response(null, { status: 204 }),
    [routes.issue]: () => issue('DATA-1', { [POINT_FIELD]: 5 }),
    [routes.comment]: () => ({ id: 'comment-1' }),
    ...overrides,
  };
  const fetch = async (input, options) => {
    const url = new URL(input);
    assert.ok(url.href.startsWith(`${site}/rest/`), 'Requests must use the configured Jira site');
    const path = url.pathname;
    const route = `${options.method} ${path}`;
    const call = { route, query: Object.fromEntries(url.searchParams), body: options.body === undefined ? undefined : JSON.parse(options.body), options };
    calls.push(call);
    assert.ok(Object.hasOwn(handlers, route), `Unexpected request: ${route}`);
    const result = await handlers[route](call);
    return result instanceof Response ? result : Response.json(result);
  };
  return { jira: await new Jira({ email: 'test@example.invalid', token: 'test-token', ...settings }, { fetch }).init(), calls, handlers };
}
const writes = calls => calls.filter(call => call.route.startsWith('PUT ') || (call.route.startsWith('POST ') && call.route !== routes.search));

test('initialisation requires a nonempty account ID from the direct REST endpoint', async () => {
  for (const value of [{ displayName: 'Me' }, { accountId: '' }, { accountId: 123 }]) {
    await assert.rejects(fixture({ [routes.me]: () => value }), /account ID/);
  }
  const { jira, calls } = await fixture();
  assert.equal(jira.me.accountId, 'me');
  assert.deepEqual(calls.map(c => [c.route, c.query, c.body]), [[routes.me, {}, undefined]]);
});

test('scope resolves the saved filter directly and all active sprint offset pages', async () => {
  const { jira, calls } = await fixture({
    [routes.sprints]: ({ query }) => query.startAt === '0' ? { ...page([sprint()], false), startAt: 0 } : { ...page([]), startAt: 1 },
  });
  assert.deepEqual(await jira.scope(), { filterId: 42, sprint: sprint(), jql });
  assert.deepEqual(calls.filter(c => c.route === routes.board).map(c => c.query), [{}]);
  assert.deepEqual(calls.filter(c => c.route === routes.filter).map(c => c.query), [{}]);
  assert.deepEqual(calls.filter(c => c.route === routes.sprints).map(c => c.query), [0, 1].map(startAt => ({ state: 'active', startAt: String(startAt), maxResults: '50' })));
  assert.deepEqual(calls.slice(1).map(c => c.route), [routes.board, routes.filter, routes.sprints, routes.sprints]);
});

for (const [label, board] of [
  ['wrong board', { id: 7, filter: { id: 42 }, estimation: { field: { fieldId: POINT_FIELD } } }],
  ['missing filter', { id: BOARD, estimation: { field: { fieldId: POINT_FIELD } } }],
  ['invalid filter', { id: BOARD, filter: { id: 'oops' }, estimation: { field: { fieldId: POINT_FIELD } } }],
  ['zero filter', { id: BOARD, filter: { id: 0 }, estimation: { field: { fieldId: POINT_FIELD } } }],
  ['wrong estimate field', { id: BOARD, filter: { id: 42 }, estimation: { field: { fieldId: 'other' } } }],
]) {
  test(`scope rejects ${label} before searching`, async () => {
    const { jira, calls } = await fixture({ [routes.board]: () => board });
    await assert.rejects(jira.snapshot(), /configuration/);
    assert.equal(calls.some(c => c.route === routes.search), false);
  });
}

for (const value of [{}, { id: 42 }, { id: 42, jql: ' ' }, { id: 99, jql: 'team = platform' }, { values: [{ id: 42, jql: 'team = platform' }] }]) {
  test(`scope rejects an unresolved saved filter: ${JSON.stringify(value)}`, async () => {
    const { jira, calls } = await fixture({ [routes.filter]: () => value });
    await assert.rejects(jira.scope(), /saved filter/);
    assert.equal(calls.some(c => c.route === routes.search), false);
  });
}

test('search follows every token, preserves request fields and deduplicates by key', async () => {
  const pages = [issuePage([issue()], false, 'a'), issuePage([issue('DATA-2')], false, 'b'), issuePage([issue('DATA-1', { summary: 'Updated' }), issue('DATA-3')])];
  const { jira, calls } = await fixture({ [routes.search]: () => pages.shift() });
  const result = await jira.search(jql);
  assert.deepEqual(result.map(i => i.key), ['DATA-1', 'DATA-2', 'DATA-3']);
  assert.equal(result[0].fields.summary, 'Updated');
  assert.deepEqual(calls.filter(c => c.route === routes.search).map(c => c.body), [undefined, 'a', 'b'].map(nextPageToken => ({
    jql: `${jql} ORDER BY key ASC`, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}),
  })));
  assert.deepEqual(writes(calls), []);
});

test('the team filter remains intersected with project and shared active sprint, never an assignee union', async () => {
  const { jira, calls } = await fixture({ [routes.sprints]: () => page([{ ...sprint(), originBoardId: 999 }]) });
  const snapshot = await jira.snapshot();
  assert.equal(snapshot.jql, jql);
  assert.equal(calls.find(c => c.route === routes.search).body.jql, `${jql} ORDER BY key ASC`);
  assert.doesNotMatch(snapshot.jql, /\bOR\b|assignee/i);
  const tickets = [issue('DATA-1', { assignee: { accountId: 'me', displayName: 'Same' } }), issue('DATA-2', { assignee: { accountId: 'other', displayName: 'Same' } }), issue('DATA-3')].map(normaliseIssue);
  assert.deepEqual(filtered(tickets, 'me').map(i => i.key), ['DATA-1']);
  assert.deepEqual(filtered(tickets, 'other').map(i => i.key), ['DATA-2']);
  assert.deepEqual(filtered(tickets, 'unassigned').map(i => i.key), ['DATA-3']);
  assert.deepEqual(filtered(tickets, 'all'), tickets);
  assert.deepEqual(filtered(tickets, 'unknown'), []);
  assert.deepEqual(assignees(tickets, 'me').slice(3), [['me', 'Same (me)'], ['other', 'Same (other)']]);
});

test('refresh resolves a sprint rollover instead of reusing cached scope', async () => {
  let active = 100;
  const { jira, calls } = await fixture({ [routes.sprints]: () => page([sprint(active)]) });
  assert.equal((await jira.snapshot()).state, 'Sprint 100');
  active = 101;
  const refreshed = await jira.snapshot();
  assert.equal(refreshed.state, 'Sprint 101');
  assert.equal(refreshed.sprint.id, 101);
  assert.equal(calls.filter(c => c.route === routes.board).length, 2);
  assert.match(calls.filter(c => c.route === routes.search).at(-1).body.jql, /sprint = 101/);
});

for (const active of [[], [sprint(), sprint(101)]]) {
  test(`${active.length} active sprints returns an explicit empty state without searching`, async () => {
    const { jira, calls } = await fixture({ [routes.sprints]: () => page(active) });
    const snapshot = await jira.snapshot();
    assert.deepEqual(snapshot.issues, []);
    assert.match(snapshot.state, active.length ? /Multiple active sprints/ : /No active sprint/);
    assert.equal(calls.some(c => c.route === routes.search), false);
  });
}

for (const invalid of [[null], [{ id: '100', state: 'active' }], [{ id: 100, state: 'closed' }], [{ id: 0, state: 'active' }], [{ id: -1, state: 'active' }]]) {
  test(`scope rejects malformed active sprints: ${JSON.stringify(invalid)}`, async () => {
    const { jira } = await fixture({ [routes.sprints]: () => page(invalid) });
    await assert.rejects(jira.scope(), /Malformed active sprint/);
  });
}

for (const invalid of [{}, { values: {}, isLast: true }, { values: [], isLast: 'true' }, page([], false)]) {
  test(`offset pagination rejects malformed or empty nonterminal pages: ${JSON.stringify(invalid)}`, async () => {
    const { jira } = await fixture({ [routes.sprints]: () => invalid });
    await assert.rejects(jira.scope(), /Malformed .* page|Empty nonterminal/);
  });
}

for (const withOffset of [false, true]) {
  test(`offset pagination rejects a repeated nonterminal page, explicit offset: ${withOffset}`, async () => {
    let count = 0;
    const { jira } = await fixture({ [routes.sprints]: () => {
      assert.ok(++count <= 3, 'Repeated pages must not fetch forever');
      return { ...page([sprint()], false), ...(withOffset ? { startAt: 0 } : {}) };
    } });
    await assert.rejects(jira.scope(), /Repeated|repeated.*page|offset.*progress/);
    assert.equal(count, 2);
  });
}

test('sprint offsets advance by the number returned, not the requested page size', async () => {
  const { jira, calls } = await fixture({ [routes.sprints]: ({ query }) => query.startAt === '0' ? page([sprint(), sprint(101)], false) : { ...page([sprint(102)]), startAt: 2 } });
  assert.deepEqual(await jira.sprints(), [sprint(), sprint(101), sprint(102)]);
  assert.deepEqual(calls.filter(c => c.route === routes.sprints).map(c => c.query.startAt), ['0', '2']);
});

for (const invalid of [{}, { issues: {}, isLast: true }, { issues: [], isLast: 'true' }, issuePage([issue()], false), issuePage([issue()], false, 12), { ...issuePage([]), warnings: ['Results incomplete'] }]) {
  test(`issue pagination rejects malformed pages or missing cursors: ${JSON.stringify(invalid)}`, async () => {
    const { jira } = await fixture({ [routes.search]: () => invalid });
    await assert.rejects(jira.search(jql), /Malformed (?:or incomplete )?issue page|Missing or repeated issue cursor/);
  });
}

for (const cursors of [['same', 'same'], ['a', 'b', 'a']]) {
  test(`issue pagination rejects repeated nonterminal cursor cycles: ${cursors.join(', ')}`, async () => {
    let count = 0;
    const { jira } = await fixture({ [routes.search]: () => {
      assert.ok(count < cursors.length, 'Repeated cursors must not fetch forever');
      return issuePage([issue()], false, cursors[count++]);
    } });
    await assert.rejects(jira.search(jql), /repeated issue cursor/);
    assert.equal(count, cursors.length);
  });
}

test('an empty terminal issue page is an empty result', async () => {
  const { jira } = await fixture({ [routes.search]: () => issuePage([]) });
  assert.deepEqual(await jira.search(jql), []);
});

test('an empty nonterminal issue page still follows its cursor', async () => {
  const { jira } = await fixture({ [routes.search]: ({ body }) => body.nextPageToken ? issuePage([issue()]) : issuePage([], false, 'next') });
  assert.deepEqual((await jira.search(jql)).map(i => i.key), ['DATA-1']);
});

test('issue keys and assignees use stable IDs rather than display names', () => {
  assert.equal(issueKey('DATA-123'), 'DATA-123');
  for (const key of ['DATA-0', 'DATA-01', 'data-1', 'OTHER-1', 'DATA-1 OR project = OTHER', 'DATA-1/../../myself', '', null, 123]) assert.throws(() => issueKey(key), /Invalid DATA/);
  const original = issue('DATA-1', { assignee: { accountId: 'abc:123', displayName: 'Same' } });
  assert.equal(normaliseIssue(original).fields.assignee.accountId, 'abc:123');
  assert.notEqual(normaliseIssue(original).fields, original.fields);
  assert.equal(normaliseIssue(issue()).fields.assignee, null);
  for (const assignee of [{ displayName: 'Same' }, { accountId: 123 }, 'Same']) assert.throws(() => normaliseIssue(issue('DATA-1', { assignee })), /Malformed assignee/);
  assert.throws(() => normaliseIssue({ key: 'DATA-1', fields: [] }), /Malformed issue fields/);
  assert.throws(() => normaliseIssue(issue('DATA-1', { summary: 1 })), /Malformed issue summary/);
});

test('an empty assignee account ID is not a stable ID', () => {
  assert.throws(() => normaliseIssue(issue('DATA-1', { assignee: { accountId: '', displayName: 'Same' } })), /Malformed assignee/);
});

test('points use raw REST fields only and preserve missing, null and zero', () => {
  for (const value of [null, 0, 5]) assert.equal(normaliseIssue(issue('DATA-1', { [POINT_FIELD]: value })).fields.points, value);
  assert.equal(normaliseIssue(issue()).fields.points, null);
  assert.equal(normaliseIssue(issue('DATA-1', { points: 8 })).fields.points, null);
  for (const customFields of [{ points: { id: POINT_FIELD, value: 8 } }, [{ id: POINT_FIELD, value: 8 }]]) {
    assert.equal(normaliseIssue(issue('DATA-1', { customFields })).fields.points, null);
    assert.equal(normaliseIssue(issue('DATA-1', { [POINT_FIELD]: 0, customFields })).fields.points, 0);
  }
  for (const value of ['5', false, NaN, Infinity, {}, []]) assert.throws(() => normaliseIssue(issue('DATA-1', { [POINT_FIELD]: value })), /Malformed story points/);
});

test('missing descriptions are safe and existing descriptions remain unchanged', () => {
  assert.equal(description(normaliseIssue(issue()).fields.description), '(No description)');
  assert.equal(description(normaliseIssue(issue('DATA-1', { description: null })).fields.description), '(No description)');
  for (const value of ['**Literal markdown**', commentDocument('Existing 🌏 description')]) {
    assert.strictEqual(normaliseIssue(issue('DATA-1', { description: value })).fields.description, value);
  }
});

const commentText = 'A **comment** 🌏\r\n\r\n[link](https://example.invalid)\r最後\n';
const commentADF = { type: 'doc', version: 1, content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'A **comment** 🌏' }] },
  { type: 'paragraph', content: [] },
  { type: 'paragraph', content: [{ type: 'text', text: '[link](https://example.invalid)' }] },
  { type: 'paragraph', content: [{ type: 'text', text: '最後' }] },
  { type: 'paragraph', content: [] },
] };
const mutations = [
  ['points', jira => jira.points('DATA-1', 5), routes.points, { fields: { [POINT_FIELD]: 5 } }],
  ['transition', jira => jira.transition('DATA-1', '31'), routes.transition, { transition: { id: '31' } }],
  ['comment', jira => jira.comment('DATA-1', commentText), routes.comment, { body: commentADF }],
];

for (const [label, mutate, operation, payload] of mutations) {
  test(`${label} rechecks scope and writes only its specified fields`, async () => {
    const { jira, calls } = await fixture();
    await jira.snapshot();
    calls.length = 0;
    await mutate(jira);
    assert.equal(calls[0].route, routes.board);
    const check = calls.findIndex(c => c.route === routes.search);
    assert.equal(calls[check].body.jql, `${jql} AND key = DATA-1 ORDER BY key ASC`);
    assert.ok(check < calls.findIndex(c => c.route === operation));
    assert.deepEqual(writes(calls).map(c => [c.route, c.body]), [[operation, payload]]);
  });

  test(`${label} blocks a ticket removed from scope since the snapshot`, async () => {
    const { jira, calls, handlers } = await fixture();
    await jira.snapshot();
    handlers[routes.search] = () => issuePage([]);
    await assert.rejects(mutate(jira), /no longer in the active board scope.*Refresh/);
    assert.deepEqual(writes(calls), []);
  });

  test(`${label} blocks writes when the sprint is no longer uniquely active`, async () => {
    for (const active of [[], [sprint(), sprint(101)]]) {
      const { jira, calls } = await fixture({ [routes.sprints]: () => page(active) });
      await assert.rejects(mutate(jira), /no longer in the active board scope/);
      assert.deepEqual(writes(calls), []);
    }
  });

  test(`${label} never retries a timed-out write`, async () => {
    const { jira, calls } = await fixture({ [operation]: () => { throw new DOMException('Timed out', 'TimeoutError'); } });
    await assert.rejects(mutate(jira), /Write outcome is uncertain.*Check Jira before repeating.*No automatic retry/);
    assert.equal(writes(calls).length, 1);
    assert.equal(calls.some(c => c.route === routes.issue), false);
  });

  test(`${label} accepts an empty 204 write response`, async () => {
    const { jira, calls } = await fixture({ [operation]: () => new Response(null, { status: 204 }) });
    await mutate(jira);
    assert.equal(writes(calls).length, 1);
  });
}

test('all keyed operations reject invalid keys before any request', async () => {
  const { jira, calls } = await fixture();
  calls.length = 0;
  for (const key of ['OTHER-1', 'DATA-0', 'DATA-1 OR 1=1', '../DATA-1', null]) {
    for (const operation of [() => jira.assertScope(key), () => jira.transitions(key), () => jira.transition(key, '31'), () => jira.points(key, 5), () => jira.comment(key, 'Comment')]) {
      await assert.rejects(operation(), /Invalid DATA/);
    }
  }
  assert.deepEqual(calls, []);
});

test('transitions are fetched again at submission and stale choices are blocked', async () => {
  const { jira, calls, handlers } = await fixture();
  assert.deepEqual((await jira.transitions('DATA-1')).map(t => t.id), ['31']);
  handlers[routes.transitions] = () => ({ transitions: [{ id: '41', name: 'Review', fields: {} }, { id: '31', name: 'Done', fields: {}, isAvailable: false }] });
  await assert.rejects(jira.transition('DATA-1', '31'), /no longer available/);
  assert.deepEqual(calls.filter(c => c.route === routes.transitions).map(c => c.query), Array.from({ length: 2 }, () => ({ expand: 'transitions.fields' })));
  assert.deepEqual(writes(calls), []);
});

test('fresh required transition fields block the write and explain what to complete in Jira', async () => {
  const { jira, calls, handlers } = await fixture();
  await jira.transitions('DATA-1');
  handlers[routes.transitions] = () => ({ transitions: [{ id: '31', name: 'Done', fields: { resolution: { required: true, name: 'Resolution' }, customfield_7: { required: true }, optional: { required: false, name: 'Optional' } } }] });
  await assert.rejects(jira.transition('DATA-1', '31'), error => {
    assert.match(error.message, /Complete this transition in Jira/);
    assert.match(error.message, /Resolution, customfield_7/);
    assert.doesNotMatch(error.message, /Optional/);
    return true;
  });
  assert.equal(calls.filter(c => c.route === routes.transitions).length, 2);
  assert.deepEqual(writes(calls), []);
});

for (const transitions of [{}, [null], [{ id: 31, name: 'Done', fields: {} }], [{ id: '31', fields: {} }], [{ id: '31', name: 'Done', fields: [] }], [{ id: '31', name: 'Done' }]]) {
  test(`malformed transitions block writes: ${JSON.stringify(transitions)}`, async () => {
    const { jira, calls } = await fixture({ [routes.transitions]: () => ({ transitions }) });
    await assert.rejects(jira.transition('DATA-1', '31'), /Malformed transitions/);
    assert.deepEqual(writes(calls), []);
  });
}

test('blank comments are rejected before any request', async () => {
  const { jira, calls } = await fixture();
  calls.length = 0;
  for (const body of ['', ' \n\t', null, undefined, 123]) await assert.rejects(jira.comment('DATA-1', body), /comment cannot be blank/);
  assert.deepEqual(calls, []);
});

test('comments preserve multiline Unicode as literal ADF text without markdown conversion', () => {
  assert.deepEqual(commentDocument(commentText), commentADF);
});

test('only supported story points reach Jira, including zero', async () => {
  let saved;
  const { jira, calls } = await fixture({
    [routes.points]: ({ body }) => { saved = body.fields[POINT_FIELD]; return new Response(null, { status: 204 }); },
    [routes.issue]: () => issue('DATA-1', { [POINT_FIELD]: saved }),
  });
  for (const points of POINTS) assert.equal((await jira.points('DATA-1', points)).fields[POINT_FIELD], points);
  assert.equal(writes(calls).length, POINTS.length);
  calls.length = 0;
  for (const points of [null, undefined, -1, 4, 1.5, '5', NaN, Infinity]) await assert.rejects(jira.points('DATA-1', points), /Fibonacci/);
  assert.deepEqual(calls, []);
});

test('a failed story points readback reports an unconfirmed write without retrying', async () => {
  const { jira, calls } = await fixture({ [routes.issue]: () => { throw new Error('Read timed out'); } });
  await assert.rejects(jira.points('DATA-1', 5), /not confirmed after the write returned.*Check Jira before repeating/);
  assert.equal(writes(calls).length, 1);
});

test('story points readback for another ticket cannot confirm the write', async () => {
  const { jira, calls } = await fixture({ [routes.issue]: () => issue('DATA-2', { [POINT_FIELD]: 5 }) });
  await assert.rejects(jira.points('DATA-1', 5), /not confirmed.*Check Jira before repeating/);
  assert.equal(writes(calls).length, 1);
});

test('story points readback mismatch warns before a repeated write', async () => {
  const { jira, calls } = await fixture({ [routes.issue]: () => issue('DATA-1', { [POINT_FIELD]: 3 }) });
  await assert.rejects(jira.points('DATA-1', 5), /not confirmed.*Check Jira before repeating/);
  assert.equal(writes(calls).length, 1);
  assert.equal(calls.at(-1).route, routes.issue);
  assert.deepEqual(calls.at(-1).query, { fields: fields.join(',') });
  assert.equal(calls.at(-1).body, undefined);
});

test('another configuration drives the site, board, project, key checks and points field', async () => {
  const other = { site: 'https://other.atlassian.net', board: 22, project: 'TEAM', storyPointsField: 'customfield_20000' };
  const urls = [];
  const fetch = async (input, options) => {
    const url = new URL(input);
    urls.push(`${options.method} ${url.href}`);
    if (url.pathname.endsWith('/configuration')) return Response.json({ id: 22, filter: { id: 42 }, estimation: { field: { fieldId: other.storyPointsField } } });
    if (url.pathname.endsWith('/filter/42')) return Response.json({ id: '42', jql: 'team = platform' });
    if (url.pathname.endsWith('/sprint')) return Response.json(page([sprint()]));
    if (url.pathname.endsWith('/search/jql')) return Response.json(issuePage([issue('TEAM-1', { [other.storyPointsField]: 3, [POINT_FIELD]: 8 })]));
    return Response.json({ accountId: 'me' });
  };
  const jira = await new Jira({ email: 'test@example.invalid', token: 'test-token', ...other }, { fetch }).init();
  const snapshot = await jira.snapshot();
  assert.equal(snapshot.jql, 'project = TEAM AND filter = 42 AND sprint = 100');
  assert.equal(snapshot.issues[0].fields.points, 3);
  assert.ok(urls.every(url => url.split(' ')[1].startsWith('https://other.atlassian.net/rest/')));
  assert.ok(urls.some(url => url.includes('/rest/agile/1.0/board/22/configuration')));
  const count = urls.length;
  await assert.rejects(jira.assertScope('DATA-1'), /Invalid TEAM ticket key/);
  assert.equal(urls.length, count);
  await jira.assertScope('TEAM-1');
  assert.throws(() => normalise(issue('TEAM-1'), settings), /Invalid DATA ticket key/);
  assert.equal(checkKey('TEAM-7', 'TEAM'), 'TEAM-7');
  for (const bad of [undefined, 'data', 'D', 'DATA.*']) assert.throws(() => checkKey('DATA-1', bad), /Malformed project/);
  assert.throws(() => normalise(issue(), { project }), /Malformed storyPointsField/);
});
