import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Jira } from '../lib/jira.mjs';
import { settings, site as API_BASE } from './fixtures.mjs';

const credentials = { email: 'test@example.invalid', token: 'synthetic-secret-token', ...settings };
const authorization = `Basic ${Buffer.from(`${credentials.email}:${credentials.token}`).toString('base64')}`;
const path = '/rest/api/3/myself';
const writeOptions = { method: 'PUT', body: { fields: { [settings.storyPointsField]: 5 } } };
const uncertain = /Check Jira before repeating the write\. No automatic retry was made/;

function fixture(respond = () => Response.json({ ok: true }), options = {}) {
  const calls = [], sleeps = [];
  const jira = new Jira(credentials, {
    fetch: async (url, init) => {
      calls.push({ url: new URL(url), ...init });
      return respond(calls.at(-1), calls.length);
    },
    sleep: async ms => { sleeps.push(ms); },
    ...options,
  });
  return { jira, calls, sleeps };
}

function noSecrets(error) {
  for (const secret of [credentials.email, credentials.token, authorization, authorization.slice(6)]) {
    assert.equal(error.message.includes(secret), false, 'An error must not contain credentials');
  }
  return true;
}

test('constructor rejects missing or malformed email and token without exposing secrets', () => {
  for (const value of [{}, { email: credentials.email }, { token: credentials.token },
    { ...credentials, email: '' }, { ...credentials, email: 'not-an-email' },
    { ...credentials, email: 'test:injected@example.invalid' }, { ...credentials, email: 'test\n@example.invalid' },
    { ...credentials, token: '' }, { ...credentials, token: 'contains space' },
    { ...credentials, token: 'contains\nnewline' }, { ...credentials, token: 123 }]) {
    assert.throws(() => new Jira(value, { fetch: () => assert.fail('No request may occur') }), error => {
      assert.match(error.message, /configured email and Keychain token/);
      return noSecrets(error);
    });
  }
});

test('constructor rejects invalid Jira settings before any request without exposing secrets', () => {
  for (const [key, values, message] of [
    ['site', [undefined, '', 'http://example.atlassian.net', 'https://example.com', 'https://example.atlassian.net/jira',
      'https://example.atlassian.net:443', 'https://user:pass@example.atlassian.net', 'https://example.atlassian.net?x=1',
      'https://example.atlassian.net.evil.com'], /Malformed site/],
    ['board', [undefined, 0, -1, 1.5, '11'], /Malformed board/],
    ['project', [undefined, 'data', 'D', 'DATA-1'], /Malformed project/],
    ['storyPointsField', [undefined, 'points', 'customfield_0'], /Malformed storyPointsField/],
  ]) {
    for (const value of values) {
      assert.throws(() => new Jira({ ...credentials, [key]: value }, { fetch: () => assert.fail('No request may occur') }), error => {
        assert.match(error.message, message);
        return noSecrets(error);
      });
    }
  }
  assert.equal(new Jira({ ...credentials, site: `${settings.site}/` }).site, settings.site);
});

test('constructor validates timeout and budget bounds and keeps the 30 second default budget', () => {
  const { jira } = fixture();
  assert.equal(jira.timeout, 10_000);
  assert.equal(jira.budget, 30_000);
  for (const option of ['timeout', 'budget']) {
    for (const value of [0, -1, 1.5, NaN, Infinity, '10', 2_147_483_648]) {
      assert.throws(() => fixture(undefined, { [option]: value }), /Invalid Jira request timeout/);
    }
  }
});

test('requests use only the configured Jira site with Basic authentication and manual redirects', async () => {
  const { jira, calls } = fixture();
  await jira.request(path, { query: { expand: 'a b&c', omitted: undefined } });
  await jira.request('/rest/api/3/search/jql', { method: 'POST', read: true, body: { jql: 'project = DATA' } });
  assert.equal(jira.site, 'https://example.atlassian.net');
  assert.equal(calls[0].url.href, `${API_BASE}${path}?expand=a+b%26c`);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, undefined);
  assert.deepEqual(calls[0].headers, { Authorization: authorization, Accept: 'application/json' });
  assert.deepEqual(calls[1].headers, { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json' });
  assert.equal(calls[1].body, JSON.stringify({ jql: 'project = DATA' }));
  for (const call of calls) {
    assert.equal(call.redirect, 'manual');
    assert.ok(call.signal instanceof AbortSignal);
    assert.equal(call.signal.aborted, false);
  }
  assert.notStrictEqual(calls[0].signal, calls[1].signal);
  assert.doesNotMatch(JSON.stringify(jira), /synthetic-secret-token|Basic /);
});

test('unsafe paths and unsupported methods are rejected before fetch', async () => {
  const { jira, calls } = fixture();
  for (const invalid of ['https://elsewhere.invalid/rest/api/3/myself', '//elsewhere.invalid/rest/api/3/myself', '/rest/api/2/myself', '/rest/api/3/../myself', '/rest/api/3/%2e%2e/myself', '/rest/api/3/myself?redirect=elsewhere', '/rest/api/3/myself#fragment', '/rest/api/3/myself\\other']) {
    await assert.rejects(jira.request(invalid), /Invalid Jira API request/);
  }
  for (const method of ['DELETE', 'PATCH', 'get', 'OPTIONS']) await assert.rejects(jira.request(path, { method }), /Invalid Jira API request/);
  assert.deepEqual(calls, []);
});

for (const [status, reason] of [[401, /Token rejected or expired/], [403, /Access denied.*permissions.*policy/], [404, /not found or not visible/], [500, /Request rejected/]]) {
  for (const write of [false, true]) {
    test(`HTTP ${status} ${write ? 'write' : 'read'} errors are safe and never retried`, async () => {
      let cancelled = 0;
      const { jira, calls, sleeps } = fixture(() => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(`${credentials.token} ${credentials.email}`)); },
        cancel() { cancelled++; },
      }), { status }));
      await assert.rejects(jira.request(path, write ? writeOptions : {}), error => {
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.match(error.message, reason);
        if (write) assert.match(error.message, uncertain);
        return noSecrets(error);
      });
      assert.equal(calls.length, 1);
      assert.equal(cancelled, 1);
      assert.deepEqual(sleeps, []);
    });
  }
}

test('429 reads make at most three attempts with fallback backoff and fresh timeout signals', async () => {
  const { jira, calls, sleeps } = fixture(() => new Response('rate limited', { status: 429 }));
  await assert.rejects(jira.request(path), /HTTP 429.*bounded read retry budget/);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
  assert.equal(new Set(calls.map(c => c.signal)).size, 3);
});

test('read-only POST search retries a rate limit without changing its body', async () => {
  const { jira, calls, sleeps } = fixture((call, count) => count < 3 ? new Response(null, { status: 429, headers: { 'Retry-After': '0' } }) : Response.json({ issues: [], isLast: true }));
  const options = { method: 'POST', read: true, body: { jql: 'project = DATA', nextPageToken: 'cursor' } };
  assert.deepEqual(await jira.request('/rest/api/3/search/jql', options), { issues: [], isLast: true });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(c => c.body), Array(3).fill(JSON.stringify(options.body)));
  assert.deepEqual(sleeps, [0, 0]);
});

for (const method of ['POST', 'PUT']) {
  test(`HTTP 429 ${method} writes never sleep or retry`, async () => {
    const { jira, calls, sleeps } = fixture(() => new Response(null, { status: 429, headers: { 'Retry-After': '0' } }));
    await assert.rejects(jira.request(path, { method, body: {} }), error => {
      assert.match(error.message, /HTTP 429/);
      assert.match(error.message, uncertain);
      return noSecrets(error);
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  });
}

for (const [label, header, wait] of [
  ['seconds', '2', 2000], ['fractional seconds', '0.025', 25], ['trimmed seconds', ' 2 ', 2000],
  ['HTTP date', 'Tue, 01 Jan 2030 00:00:02 GMT', 2000],
  ['past HTTP date', 'Mon, 31 Dec 2029 23:59:59 GMT', 0],
  ['missing', undefined, 1000], ['malformed', 'not-a-date', 1000], ['negative seconds', '-1', 1000],
]) {
  test(`Retry-After ${label} controls bounded read backoff`, async t => {
    t.mock.method(Date, 'now', () => Date.UTC(2030, 0, 1));
    const { jira, calls, sleeps } = fixture((call, count) => count === 1 ? new Response(null, { status: 429, headers: header === undefined ? {} : { 'Retry-After': header } }) : Response.json({ ok: true }));
    assert.deepEqual(await jira.request(path), { ok: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [wait]);
  });
}

test('a retry delay equal to the remaining budget fails without sleeping', async t => {
  t.mock.method(Date, 'now', () => Date.UTC(2030, 0, 1));
  const { jira, calls, sleeps } = fixture(() => new Response(null, { status: 429, headers: { 'Retry-After': '0.025' } }), { budget: 25 });
  await assert.rejects(jira.request(path), /HTTP 429/);
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('a delay longer than the remaining budget does not start a retry', async () => {
  const { jira, calls, sleeps } = fixture(() => new Response(null, { status: 429, headers: { 'Retry-After': '1' } }), { budget: 25 });
  await assert.rejects(jira.request(path), /HTTP 429/);
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('the shared request budget stops retries after sleep exhausts the deadline', async t => {
  let now = Date.UTC(2030, 0, 1);
  t.mock.method(Date, 'now', () => now);
  t.mock.method(performance, 'now', () => now - Date.UTC(2030, 0, 1));
  const sleeps = [];
  const { jira, calls } = fixture(() => new Response(null, { status: 429, headers: { 'Retry-After': '0.001' } }), {
    budget: 25,
    sleep: async ms => { sleeps.push(ms); now += 25; },
  });
  await assert.rejects(jira.request(path), /exceeded its time budget/);
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, [1]);
});

for (const status of [301, 302, 303, 307, 308]) {
  test(`redirect ${status} is refused and its body is cancelled`, async () => {
    let cancelled = false;
    const { jira, calls, sleeps } = fixture(() => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status, headers: { Location: 'https://elsewhere.invalid/collect' } }));
    await assert.rejects(jira.request(path), error => {
      assert.match(error.message, /unexpected redirect.*Credentials were not forwarded/);
      return noSecrets(error);
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].redirect, 'manual');
    assert.equal(cancelled, true);
    assert.deepEqual(sleeps, []);
  });
}

test('a write redirect reports uncertainty without retrying', async () => {
  const { jira, calls } = fixture(() => new Response(null, { status: 307, headers: { Location: 'https://elsewhere.invalid/collect' } }));
  await assert.rejects(jira.request(path, writeOptions), error => {
    assert.match(error.message, /redirect/);
    assert.match(error.message, uncertain);
    return true;
  });
  assert.equal(calls.length, 1);
});

for (const [label, body] of [['empty', ''], ['whitespace', ' \n'], ['broken JSON', '{'], ['null', 'null'], ['array', '[]'], ['scalar', '42'], ['HTML', '<html>not JSON</html>']]) {
  test(`${label} is not a valid JSON read response`, async () => {
    const { jira, calls } = fixture(() => new Response(body));
    await assert.rejects(jira.request(path), /malformed JSON response/);
    assert.equal(calls.length, 1);
  });
  if (body.trim()) {
    test(`${label} after a write reports uncertainty without retry`, async () => {
      const { jira, calls } = fixture(() => new Response(body));
      await assert.rejects(jira.request(path, writeOptions), error => {
        assert.match(error.message, /malformed JSON response.*Write outcome is uncertain/);
        assert.match(error.message, uncertain);
        return true;
      });
      assert.equal(calls.length, 1);
    });
  }
}

test('a 204 read still requires JSON while empty writes succeed', async () => {
  const { jira } = fixture(() => new Response(null, { status: 204 }));
  await assert.rejects(jira.request(path), /malformed JSON response/);
  for (const method of ['PUT', 'POST']) assert.deepEqual(await jira.request(path, { method, body: {} }), {});
  const { jira: empty } = fixture(() => new Response(' \n'));
  assert.deepEqual(await empty.request(path, writeOptions), {});
});

for (const write of [false, true]) {
  test(`fetch failures are redacted and ${write ? 'writes stay uncertain' : 'reads do not retry'}`, async () => {
    const { jira, calls } = fixture(() => { throw new Error(`${credentials.token} ${credentials.email} ${authorization}`); });
    await assert.rejects(jira.request(path, write ? writeOptions : {}), error => {
      assert.match(error.message, write ? /Write outcome is uncertain/ : /read failed or timed out/);
      if (write) assert.match(error.message, uncertain);
      return noSecrets(error);
    });
    assert.equal(calls.length, 1);
  });

  test(`body stream failures are redacted and ${write ? 'writes stay uncertain' : 'reads do not retry'}`, async () => {
    const { jira, calls } = fixture(() => new Response(new ReadableStream({ start(controller) { controller.error(new Error(credentials.token)); } })));
    await assert.rejects(jira.request(path, write ? writeOptions : {}), error => {
      assert.match(error.message, write ? /Write outcome is uncertain/ : /response read failed or timed out/);
      if (write) assert.match(error.message, uncertain);
      return noSecrets(error);
    });
    assert.equal(calls.length, 1);
  });
}

async function peer(t, handler) {
  const server = createServer(handler);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const calls = [];
  const fetch = (input, init) => {
    const url = new URL(input);
    assert.ok(url.href.startsWith(`${API_BASE}/rest/`), 'The adapter accepts only the configured Jira site');
    calls.push({ url, ...init });
    const target = new URL(url.pathname + url.search, origin);
    assert.equal(target.origin, origin, 'The adapter must not contact a remote host');
    return globalThis.fetch(target, init);
  };
  return { origin, fetch, calls };
}

test('a local HTTP peer receives Basic auth and JSON but a redirect target receives nothing', { timeout: 3000 }, async t => {
  const received = [];
  const { origin, fetch, calls } = await peer(t, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString() });
    response.writeHead(307, { Location: `${origin}/collect` });
    response.end('redirect');
  });
  const jira = new Jira(credentials, { fetch });
  await assert.rejects(jira.request('/rest/api/3/issue/DATA-1', writeOptions), /redirect.*Credentials were not forwarded/);
  assert.equal(calls.length, 1);
  assert.equal(received.length, 1);
  assert.equal(received[0].url, '/rest/api/3/issue/DATA-1');
  assert.equal(received[0].headers.authorization, authorization);
  assert.equal(received[0].headers['content-type'], 'application/json');
  assert.equal(received[0].body, JSON.stringify(writeOptions.body));
});

for (const phase of ['fetch', 'body']) {
  for (const write of [false, true]) {
    test(`AbortSignal enforces the ${phase} timeout for a ${write ? 'write' : 'read'} against a local peer`, { timeout: 3000 }, async t => {
      let received = 0;
      const { fetch, calls } = await peer(t, (request, response) => {
        received++;
        request.resume();
        if (phase === 'body') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.flushHeaders();
          response.write('{"unfinished":');
        }
      });
      const jira = new Jira(credentials, { fetch, timeout: 100, budget: 1000, sleep: () => assert.fail('Timeouts must not retry') });
      await assert.rejects(jira.request(path, write ? writeOptions : {}), error => {
        assert.match(error.message, write ? /Write outcome is uncertain/ : phase === 'body' ? /response read failed or timed out/ : /read failed or timed out/);
        if (write) assert.match(error.message, uncertain);
        return noSecrets(error);
      });
      assert.equal(received, 1);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].signal.aborted, true);
      assert.equal(calls[0].signal.reason.name, 'TimeoutError');
    });
  }
}

test('the remaining budget caps the fetch timeout against a local peer', { timeout: 3000 }, async t => {
  const { fetch, calls } = await peer(t, request => request.resume());
  const jira = new Jira(credentials, { fetch, timeout: 2000, budget: 100 });
  await assert.rejects(jira.request(path), /read failed or timed out/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
});
