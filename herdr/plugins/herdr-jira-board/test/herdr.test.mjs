import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, stat, chmod, symlink, realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Herdr, captureOrigin, validateDirectory } from '../lib/herdr.mjs';
import { site, project } from './fixtures.mjs';

const target = { site, project };

const exec = promisify(execFile);
const origin = cwd => ({ workspace_id: 'w1', focused_pane_id: 'w1:p2', focused_pane_cwd: cwd, tab_id: 'w1:t1' });
const code = expected => error => error.code === expected;

async function fixture(t, handler, { git = false } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hj-')));
  const socketPath = join(root, 'rpc.sock');
  const stateDir = join(root, 'state');
  const cwd = join(root, `repo with 'quotes' $() ; spaces`);
  await mkdir(cwd);
  const gitEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TEMPLATE_DIR: '' };
  let base;
  if (git) {
    await exec('git', ['init', '--quiet', '-b', 'main', cwd], { env: gitEnv });
    await exec('git', ['-C', cwd, 'config', 'core.hooksPath', '/dev/null'], { env: gitEnv });
    if (git !== 'unborn') {
      await writeFile(join(cwd, 'seed.txt'), 'committed\n');
      await exec('git', ['-C', cwd, 'add', 'seed.txt'], { env: gitEnv });
      await exec('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'test: initialise repository'], { env: gitEnv });
      base = (await exec('git', ['-C', cwd, 'rev-parse', 'HEAD'], { env: gitEnv })).stdout.trim();
    }
  }
  const checkout = join(root, 'worktree');
  const requests = [];
  const sockets = new Set();
  const reply = (socket, request, result) => socket.end(JSON.stringify({ id: request.id, result }) + '\n');
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', async chunk => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
      requests.push(request);
      assert.deepEqual(Object.keys(request).sort(), ['id', 'method', 'params']);
      if (await handler?.({ socket, request, reply }) === true) return;
      if (request.method === 'worktree.list') {
        if (!git) socket.end(JSON.stringify({ id: request.id, error: { code: 'not_git_worktree', message: 'Not a Git directory' } }) + '\n');
        else reply(socket, request, { type: 'worktree_list', source: { source_checkout_path: cwd }, worktrees: [] });
        return;
      }
      if (request.method === 'worktree.create') {
        const { cwd: source, branch, base } = request.params;
        const existing = await exec('git', ['-C', source, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { env: gitEnv }).then(() => true, () => false);
        await exec('git', ['-C', source, 'worktree', 'add', ...(existing ? [checkout, branch] : ['-b', branch, checkout, base])], { env: gitEnv });
        reply(socket, request, {
          type: 'worktree_created', workspace: { workspace_id: 'w2' },
          tab: { tab_id: 'w2:t1', workspace_id: 'w2' },
          root_pane: { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: checkout },
          worktree: { path: checkout, branch, is_linked_worktree: true, open_workspace_id: 'w2' },
        });
        return;
      }
      const result = request.method === 'pane.get'
        ? { pane: { pane_id: request.params.pane_id, workspace_id: 'w1' } }
        : request.method === 'pane.split' ? { pane: { pane_id: 'w1:p3' } }
          : request.method === 'agent.get' ? { agent: { interactive_ready: true, agent_status: 'idle', pane_id: git ? 'w2:p1' : 'w1:p3', workspace_id: git ? 'w2' : 'w1' } }
            : { agent: { launch_pending: true, agent_status: 'unknown' } };
      reply(socket, request, result);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const options = { socketPath, stateDir, timeout: 1_000 };
  return { root, cwd, checkout, base, gitEnv, stateDir, requests, options, client: new Herdr(options), origin: origin(cwd) };
}

test('captureOrigin keeps only validated immutable launch context', () => {
  const input = { ...origin('/tmp/repo'), unrelated: 'not forwarded' };
  const captured = captureOrigin({ HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify(input) });
  assert.deepEqual(captured, origin('/tmp/repo'));
  assert.ok(Object.isFrozen(captured));
  for (const context of [null, [], {}, { ...input, workspace_id: '' }, { ...input, tab_id: 1 },
    { ...input, focused_pane_id: 'pane\n1' }, { ...input, focused_pane_cwd: 'relative' },
    { ...input, focused_pane_cwd: '/tmp/\0bad' }]) {
    assert.throws(() => captureOrigin({ HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify(context) }), code('INVALID_ORIGIN'));
  }
  for (const value of [undefined, '', '{']) {
    assert.throws(() => captureOrigin({ HERDR_PLUGIN_CONTEXT_JSON: value }), code('INVALID_ORIGIN'));
  }
});

test('constructor uses XDG socket fallback only when the socket variable is absent', () => {
  const names = ['HERDR_SOCKET_PATH', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    delete process.env.HERDR_SOCKET_PATH;
    delete process.env.XDG_CONFIG_HOME;
    assert.equal(new Herdr().socketPath, join(homedir(), '.config/herdr/herdr.sock'));
    process.env.XDG_CONFIG_HOME = '/tmp/herdr-config';
    process.env.XDG_STATE_HOME = '/tmp/herdr-state';
    assert.equal(new Herdr().socketPath, '/tmp/herdr-config/herdr/herdr.sock');
    assert.equal(new Herdr().stateDir, '/tmp/herdr-state/herdr-jira-board');
    process.env.HERDR_SOCKET_PATH = '/tmp/explicit.sock';
    assert.equal(new Herdr().socketPath, '/tmp/explicit.sock');
    process.env.HERDR_SOCKET_PATH = '';
    assert.throws(() => new Herdr(), code('INVALID_SOCKET'));
    assert.equal(new Herdr({ socketPath: '/tmp/override.sock' }).socketPath, '/tmp/override.sock');
    for (const timeout of [0, -1, NaN, 1.2, Infinity, 2 ** 31]) {
      assert.throws(() => new Herdr({ socketPath: '/tmp/test.sock', timeout }), code('INVALID_TIMEOUT'));
    }
    assert.throws(() => new Herdr({ socketPath: '/tmp/test.sock', stateDir: 'relative' }), code('INVALID_STATE'));
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test('dispatch reservations distinguish workspaces on separate Herdr sockets', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  await first.client.dispatch('DATA-1', first.origin, target);
  await new Herdr({ ...second.options, stateDir: first.stateDir }).dispatch('DATA-1', second.origin, target);
  assert.equal((await readdir(first.stateDir)).length, 2);
});

test('open preserves origin in the environment without forbidden popup targets', async t => {
  const f = await fixture(t, ({ socket, request, reply }) => {
    if (request.method !== 'plugin.pane.open') return false;
    if (['workspace_id', 'target_pane_id', 'direction'].some(key => request.params[key] !== undefined)) {
      socket.end(JSON.stringify({ id: request.id, error: { code: 'invalid_params', message: 'overlay and popup plugin panes target the active pane' } }) + '\n');
    } else reply(socket, request, { type: 'ok' });
    return true;
  });
  assert.deepEqual(await f.client.open(f.origin), { type: 'ok' });
  assert.deepEqual(f.requests[0].params, {
    plugin_id: 'herdr-jira-board', entrypoint: 'board', placement: 'popup',
    width: '90%', height: '85%',
    env: { JIRA_BOARD_ORIGIN_JSON: JSON.stringify(f.origin) },
  });
});

test('request reads fragmented newline frames and returns only result', async t => {
  const f = await fixture(t, ({ socket, request }) => {
    socket.write(JSON.stringify({ id: request.id, result: { answer: 'a\nb €' } }));
    setImmediate(() => socket.end('\n'));
    return true;
  });
  assert.deepEqual(await f.client.request('pane.get', { pane_id: 'w1:p2' }), { answer: 'a\nb €' });
  assert.equal(f.requests.length, 1);
  await assert.rejects(f.client.request('bad method'), code('INVALID_REQUEST'));
  await assert.rejects(f.client.request('pane.get', []), code('INVALID_REQUEST'));
});

test('request rejects invalid frames, remote failures and missing newlines without retries', async t => {
  for (const kind of ['json', 'id', 'result', 'rpc', 'eof', 'timeout', 'oversize']) {
    await t.test(kind, async t => {
      const f = await fixture(t, ({ socket, request }) => {
        if (kind === 'json') socket.end('not-json\n');
        if (kind === 'id') socket.end('{"id":"wrong","result":{}}\n');
        if (kind === 'result') socket.end(JSON.stringify({ id: request.id }) + '\n');
        if (kind === 'rpc') socket.end(JSON.stringify({ id: request.id, error: { message: 'private content' } }) + '\n');
        if (kind === 'eof') socket.end(JSON.stringify({ id: request.id, result: {} }));
        if (kind === 'oversize') socket.end('x'.repeat(4 * 1024 * 1024 + 1));
        return true;
      });
      f.client.timeout = kind === 'timeout' ? 100 : 2_000;
      await assert.rejects(f.client.request('pane.get'), error => {
        assert.equal(error.code, kind === 'rpc' ? 'HERDR_RPC' : kind === 'timeout' ? 'HERDR_TIMEOUT' : 'HERDR_PROTOCOL');
        assert.ok(!error.message.includes('private content'));
        return true;
      });
      assert.equal(f.requests.length, 1);
    });
  }
});

test('request reports unavailable sockets', async t => {
  const f = await fixture(t);
  const client = new Herdr({ ...f.options, socketPath: join(f.root, 'missing.sock') });
  await assert.rejects(client.request('pane.get'), code('HERDR_SOCKET'));
});

test('validateDirectory accepts ordinary directories and resolves symlinks without requiring Git', async t => {
  const f = await fixture(t);
  const nested = join(f.cwd, 'nested');
  await mkdir(nested);
  const link = join(f.root, 'link');
  await symlink(nested, link);
  assert.equal(await validateDirectory(link), await validateDirectory(nested));
  for (const path of [undefined, '', 'relative', '/tmp/\0bad', join(f.root, 'missing')]) {
    await assert.rejects(validateDirectory(path), code('DIRECTORY_REQUIRED'));
  }
  const file = join(f.root, 'file');
  await writeFile(file, '');
  await assert.rejects(validateDirectory(file), code('DIRECTORY_REQUIRED'));
  const bare = join(f.root, 'bare');
  await exec('git', ['init', '--quiet', '--bare', bare]);
  assert.equal(await validateDirectory(bare), await realpath(bare));
  assert.equal(await validateDirectory(f.root), f.root);
});

test('validateDirectory rejects a directory without traversal permission', { skip: process.getuid?.() === 0 }, async t => {
  const f = await fixture(t);
  const restricted = join(f.root, 'restricted');
  await mkdir(restricted);
  await chmod(restricted, 0o000);
  try { await assert.rejects(validateDirectory(restricted), code('DIRECTORY_REQUIRED')); }
  finally { await chmod(restricted, 0o700); }
});

test('dispatch defaults to the captured directory even outside a Git repository', async t => {
  const f = await fixture(t);
  await f.client.dispatch('DATA-1', origin(f.root), target);
  assert.equal(f.requests.find(request => request.method === 'pane.split').params.cwd, f.root);
});

test('dispatch uses argv-safe cwd, explicit pane and awaited readiness, with private ID-only records', async t => {
  const f = await fixture(t);
  const nested = join(f.cwd, 'nested');
  await mkdir(nested);
  const result = await f.client.dispatch('DATA-123', f.origin, { cwd: nested, ...target });
  assert.deepEqual(f.requests.map(r => r.method), ['pane.get', 'worktree.list', 'pane.split', 'agent.start', 'agent.get', 'agent.prompt']);
  assert.deepEqual(f.requests[0].params, { pane_id: 'w1:p2' });
  assert.deepEqual(f.requests[2].params, {
    workspace_id: 'w1', target_pane_id: 'w1:p2', direction: 'right', cwd: nested, focus: false,
  });
  assert.match(result.name, /^jira-[a-f0-9]{27}$/);
  assert.deepEqual(f.requests[3].params, { name: result.name, kind: 'pi', pane_id: 'w1:p3', args: ['--thinking', 'xhigh'], timeout_ms: 30_000 });
  assert.deepEqual(f.requests[4].params, { target: result.name });
  const prompt = f.requests[5].params;
  assert.equal(prompt.target, result.name);
  assert.equal(Object.hasOwn(prompt, 'wait'), false);
  for (const text of ['/skill:peon DATA-123', 'https://example.atlassian.net/browse/DATA-123', 'all comments',
    'Atlassian MCP', 'untrusted', 'Read-only intake and planning only', 'No Jira top-ups, reassignment or writes',
    'No code or Jira changes until separate approval', 'approval before code changes']) assert.ok(prompt.text.includes(text));
  assert.equal((await stat(f.stateDir)).mode & 0o777, 0o700);
  const files = await readdir(f.stateDir);
  assert.equal(files.length, 1);
  const file = join(f.stateDir, files[0]);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const records = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(r => r.stage), ['split', 'start', 'prompt', 'complete']);
  for (const record of records) assert.ok(Object.keys(record).every(key => ['stage', 'workspace_id', 'key', 'name', 'pane_id'].includes(key)));
  await assert.rejects(new Herdr(f.options).dispatch('DATA-123', f.origin, target), code('DISPATCH_DUPLICATE'));
  assert.equal(f.requests.length, 6);
});

test('dispatch returns on prompt admission while peon is still working', async t => {
  const f = await fixture(t, ({ socket, request, reply }) => {
    if (request.method !== 'agent.prompt') return false;
    if (!Object.hasOwn(request.params, 'wait')) {
      reply(socket, request, { type: 'agent_prompted', agent: { agent_status: 'working' } });
    }
    return true;
  });
  const result = await f.client.dispatch('DATA-1', f.origin, target);
  assert.equal(result.pane_id, 'w1:p3');
  assert.equal(f.requests.at(-1).method, 'agent.prompt');
  assert.equal(f.requests.filter(request => request.method === 'agent.get').length, 1);
  assert.ok(!f.requests.some(request => request.method === 'agent.wait'));
  await assert.rejects(new Herdr(f.options).dispatch('DATA-1', f.origin, target), code('DISPATCH_DUPLICATE'));
});

test('request preserves only a safe structured RPC code, never server messages', async t => {
  for (const rpcCode of ['not_git_worktree', 'repository_not_trusted', 'bad\ncode', { private: 'content' }]) {
    const f = await fixture(t, ({ socket, request }) => {
      socket.end(JSON.stringify({ id: request.id, error: { code: rpcCode, message: 'private content' } }) + '\n');
      return true;
    });
    await assert.rejects(f.client.request('worktree.list'), error => {
      assert.equal(error.code, 'HERDR_RPC');
      assert.equal(error.rpcCode, typeof rpcCode === 'string' && !rpcCode.includes('\n') ? rpcCode : undefined);
      assert.ok(!JSON.stringify(error).includes('private content'));
      return true;
    });
  }
});

test('Git dispatch creates a native registered worktree and keeps source edits untouched', async t => {
  const f = await fixture(t, undefined, { git: true });
  const nested = join(f.cwd, 'nested');
  await mkdir(nested);
  await writeFile(join(f.cwd, 'seed.txt'), 'dirty\n');
  await writeFile(join(f.cwd, 'untracked.txt'), 'private source file\n');
  const result = await f.client.dispatch('DATA-123', origin(nested), target);
  assert.deepEqual(f.requests.map(request => request.method),
    ['pane.get', 'worktree.list', 'worktree.create', 'agent.start', 'agent.get', 'agent.prompt']);
  assert.deepEqual(f.requests[1].params, { cwd: nested });
  assert.deepEqual(f.requests[2].params, { cwd: f.cwd, branch: 'feat/data-123', base: f.base, label: 'DATA-123', focus: false });
  assert.equal(f.requests[3].params.pane_id, 'w2:p1');
  assert.deepEqual(f.requests[3].params.args, ['--thinking', 'xhigh']);
  assert.equal(result.workspace_id, 'w2');
  assert.equal(result.branch, 'feat/data-123');
  assert.equal(result.pane_id, 'w2:p1');
  assert.equal(await readFile(join(f.checkout, 'seed.txt'), 'utf8'), 'committed\n');
  assert.equal(await readFile(join(f.cwd, 'seed.txt'), 'utf8'), 'dirty\n');
  await assert.rejects(stat(join(f.checkout, 'untracked.txt')), { code: 'ENOENT' });
  assert.equal((await exec('git', ['-C', f.checkout, 'rev-parse', 'HEAD'])).stdout.trim(), f.base);
  const prompt = f.requests.at(-1).params.text;
  assert.ok(prompt.startsWith('/skill:peon DATA-123 '));
  assert.equal(Object.hasOwn(f.requests.at(-1).params, 'wait'), false);
  for (const text of ['fresh Herdr-managed worktree', 'feat/data-123', 'not evidence', 'Do not create another worktree or branch', 'No code or Jira changes until separate approval']) assert.ok(prompt.includes(text), text);
  const [file] = await readdir(f.stateDir);
  const records = (await readFile(join(f.stateDir, file), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(record => record.stage), ['worktree', 'start', 'prompt', 'complete']);
  assert.ok(records.every(record => record.workspace_id === 'w1' && record.branch === 'feat/data-123'));
  assert.equal(records[0].worker_workspace_id, undefined);
  assert.equal(records.at(-1).worker_workspace_id, 'w2');
  await assert.rejects(new Herdr(f.options).dispatch('DATA-123', f.origin, target), code('DISPATCH_DUPLICATE'));
  assert.equal(f.requests.length, 6);
});

test('linked origins create through the parent checkout but use the linked HEAD', async t => {
  const f = await fixture(t, undefined, { git: true });
  const linked = join(f.root, 'linked');
  await exec('git', ['-C', f.cwd, 'worktree', 'add', '-b', 'feat/source', linked], { env: f.gitEnv });
  await exec('git', ['-C', linked, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'test: advance linked checkout'], { env: f.gitEnv });
  const linkedHead = (await exec('git', ['-C', linked, 'rev-parse', 'HEAD'], { env: f.gitEnv })).stdout.trim();
  await f.client.dispatch('DATA-1', origin(linked), target);
  const create = f.requests.find(request => request.method === 'worktree.create');
  assert.equal(create.params.cwd, f.cwd);
  assert.equal(create.params.base, linkedHead);
  assert.notEqual(create.params.base, f.base);
});

test('listed worktrees and diverged ticket branches block creation without retaining a reservation', async t => {
  for (const kind of ['listed', 'ahead', 'behind']) {
    const f = await fixture(t, ({ socket, request, reply }) => {
      if (kind !== 'listed' || request.method !== 'worktree.list') return false;
      reply(socket, request, { type: 'worktree_list', source: { source_checkout_path: f.cwd },
        worktrees: [{ path: f.checkout, branch: 'feat/data-1' }] });
      return true;
    }, { git: true });
    const commit = message => exec('git', ['-C', f.cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', message], { env: f.gitEnv });
    if (kind === 'ahead') {
      await exec('git', ['-C', f.cwd, 'checkout', '--quiet', '-b', 'feat/data-1'], { env: f.gitEnv });
      await commit('test: branch work');
      await exec('git', ['-C', f.cwd, 'checkout', '--quiet', 'main'], { env: f.gitEnv });
    }
    if (kind === 'behind') {
      await exec('git', ['-C', f.cwd, 'branch', 'feat/data-1'], { env: f.gitEnv });
      await commit('test: advance main');
    }
    await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), error => {
      assert.equal(error.code, 'WORKTREE_EXISTS');
      if (kind !== 'listed') assert.match(error.message, /git branch -d/);
      return true;
    });
    assert.ok(!f.requests.some(request => ['worktree.create', 'pane.split', 'agent.start'].includes(request.method)));
    assert.deepEqual(await readdir(f.stateDir), []);
  }
});

test('an existing ticket branch at HEAD without a worktree is reused', async t => {
  const f = await fixture(t, undefined, { git: true });
  await exec('git', ['-C', f.cwd, 'branch', 'feat/data-1'], { env: f.gitEnv });
  const result = await f.client.dispatch('DATA-1', f.origin, target);
  assert.equal(result.branch, 'feat/data-1');
  const create = f.requests.find(request => request.method === 'worktree.create');
  assert.deepEqual(create.params, { cwd: f.cwd, branch: 'feat/data-1', base: f.base, label: 'DATA-1', focus: false });
  assert.equal((await exec('git', ['-C', f.checkout, 'rev-parse', 'HEAD'], { env: f.gitEnv })).stdout.trim(), f.base);
  assert.match(f.requests.at(-1).params.text, /from an existing branch with no commits of its own/);
});

test('unborn repositories fail before any worktree or pane mutation', async t => {
  const f = await fixture(t, undefined, { git: 'unborn' });
  await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), code('GIT_PREFLIGHT'));
  assert.deepEqual(f.requests.map(request => request.method), ['pane.get', 'worktree.list']);
  assert.deepEqual(await readdir(f.stateDir), []);
});

test('only confirmed non-Git errors allow sibling fallback; unknown failures fail closed', async t => {
  for (const rpcCode of ['repository_not_trusted', 'worktree_list_failed', 'method_not_found', undefined]) {
    const f = await fixture(t, ({ socket, request }) => {
      if (request.method !== 'worktree.list') return false;
      socket.end(JSON.stringify({ id: request.id, error: { code: rpcCode, message: 'private Git failure' } }) + '\n');
      return true;
    });
    await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), code('HERDR_RPC'));
    assert.deepEqual(f.requests.map(request => request.method), ['pane.get', 'worktree.list']);
    assert.deepEqual(await readdir(f.stateDir), []);
  }
});

test('malformed worktree list responses never fall back or mutate', async t => {
  for (const result of [{}, { type: 'worktree_list', source: { source_checkout_path: 'relative' }, worktrees: [] },
    { type: 'worktree_list', source: { source_checkout_path: '/tmp' } }]) {
    const f = await fixture(t, ({ socket, request, reply }) => {
      if (request.method !== 'worktree.list') return false;
      reply(socket, request, result);
      return true;
    });
    await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), code('HERDR_PROTOCOL'));
    assert.deepEqual(await readdir(f.stateDir), []);
    assert.equal(f.requests.length, 2);
  }
});

test('Git inspection ignores inherited Git-directory overrides', async t => {
  const f = await fixture(t, undefined, { git: true });
  const names = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = '/missing/override';
    await f.client.dispatch('DATA-1', f.origin, target);
    assert.equal(f.requests.find(request => request.method === 'worktree.create').params.base, f.base);
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test('Git dispatch failures retain the branch reservation and never fall back or retry', async t => {
  for (const method of ['worktree.create', 'agent.start', 'agent.get', 'agent.prompt']) {
    const f = await fixture(t, ({ socket, request }) => {
      if (request.method !== method) return false;
      socket.end(JSON.stringify({ id: request.id, error: { code: 'failed', message: 'private failure' } }) + '\n');
      return true;
    }, { git: true });
    await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), code('DISPATCH_UNCERTAIN'));
    const count = f.requests.length;
    await assert.rejects(new Herdr(f.options).dispatch('DATA-1', f.origin, target), code('DISPATCH_UNCERTAIN'));
    assert.equal(f.requests.length, count);
    assert.ok(!f.requests.some(request => request.method === 'pane.split'));
    const [file] = await readdir(f.stateDir);
    const records = (await readFile(join(f.stateDir, file), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records[0].branch, 'feat/data-1');
    assert.equal(records[0].stage, 'worktree');
  }
});

test('a created checkout at the wrong base stops before starting or prompting peon', async t => {
  const f = await fixture(t, ({ request }) => {
    if (request.method === 'worktree.create') request.params.base = f.base;
    return false;
  }, { git: true });
  await exec('git', ['-C', f.cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'test: advance source'], { env: f.gitEnv });
  await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), code('DISPATCH_UNCERTAIN'));
  assert.ok(!f.requests.some(request => request.method === 'agent.start'));
});

test('invalid worktree creation responses never start pi or permit a retry', async t => {
  const variants = [
    value => ({}),
    value => ({ ...value, type: 'wrong_type' }),
    value => ({ ...value, workspace: { workspace_id: 'w1' } }),
    value => ({ ...value, root_pane: { ...value.root_pane, pane_id: 'bad\npane' } }),
    value => ({ ...value, root_pane: { ...value.root_pane, workspace_id: 'w9' } }),
    value => ({ ...value, root_pane: { ...value.root_pane, tab_id: 'w2:t9' } }),
    value => ({ ...value, worktree: { ...value.worktree, branch: 'feat/data-999' } }),
    value => ({ ...value, worktree: { ...value.worktree, is_linked_worktree: false } }),
    value => ({ ...value, worktree: { ...value.worktree, open_workspace_id: 'w9' } }),
    value => value,
    value => ({ ...value, worktree: { ...value.worktree, path: 'relative' } }),
  ];
  for (const variant of variants) {
    const f = await fixture(t, ({ socket, request, reply }) => {
      if (request.method !== 'worktree.create') return false;
      reply(socket, request, variant({
        type: 'worktree_created', workspace: { workspace_id: 'w2' },
        tab: { tab_id: 'w2:t1', workspace_id: 'w2' },
        root_pane: { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: f.cwd },
        worktree: { path: f.cwd, branch: 'feat/data-1', is_linked_worktree: true, open_workspace_id: 'w2' },
      }));
      return true;
    }, { git: true });
    await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), code('DISPATCH_UNCERTAIN'));
    assert.deepEqual(f.requests.map(request => request.method), ['pane.get', 'worktree.list', 'worktree.create']);
    await assert.rejects(new Herdr(f.options).dispatch('DATA-1', f.origin, target), code('DISPATCH_UNCERTAIN'));
    assert.equal(f.requests.length, 3);
  }
});

test('Git failures and malformed commit IDs cannot become a non-Git launch', async t => {
  for (const invalidHead of [false, true]) {
    const f = await fixture(t, undefined, { git: true });
    const bin = join(f.root, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'git'), `#!${process.execPath}\nif(process.argv.includes('HEAD^{commit}'))process.stdout.write(${JSON.stringify(invalidHead ? 'invalid' : f.base)});else process.exit(2);\n`, { mode: 0o700 });
    const saved = process.env.PATH;
    try {
      process.env.PATH = bin;
      await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), code('GIT_PREFLIGHT'));
      assert.deepEqual(f.requests.map(request => request.method), ['pane.get', 'worktree.list']);
      assert.deepEqual(await readdir(f.stateDir), []);
    } finally { process.env.PATH = saved; }
  }
});

test('dispatch rejects bad keys and origins before calling Herdr', async t => {
  const f = await fixture(t);
  for (const key of ['DATA-0', 'DATA-01', 'OTHER-123', 'data-123', 'DATA-1\n', 'DATA-1; echo bad']) {
    await assert.rejects(f.client.dispatch(key, f.origin, target), code('INVALID_KEY'));
  }
  await assert.rejects(f.client.dispatch('DATA-1', {}, target), code('INVALID_ORIGIN'));
  assert.equal(f.requests.length, 0);
});

test('dispatch validates keys against the configured project and rejects invalid settings before calling Herdr', async t => {
  const f = await fixture(t);
  const other = { site: 'https://other.atlassian.net', project: 'TEAM' };
  await assert.rejects(f.client.dispatch('DATA-1', f.origin, other), error => {
    assert.equal(error.code, 'INVALID_KEY');
    assert.equal(error.message, 'Choose a valid TEAM ticket key.');
    return true;
  });
  for (const settings of [{}, { project }, { site }, { site: 'http://example.atlassian.net', project },
    { site: 'https://example.atlassian.net.evil.com', project }, { site, project: 'data' }, { site, project: 'DATA|TEAM' }]) {
    await assert.rejects(f.client.dispatch('DATA-1', f.origin, settings), code('INVALID_SETTINGS'));
  }
  assert.equal(f.requests.length, 0);
  const result = await f.client.dispatch('TEAM-7', f.origin, other);
  assert.equal(result.key, 'TEAM-7');
  const prompt = f.requests.find(r => r.method === 'agent.prompt').params.text;
  assert.ok(prompt.startsWith('/skill:peon TEAM-7 https://other.atlassian.net/browse/TEAM-7. '));
  assert.doesNotMatch(prompt, /example\.atlassian\.net/);
});

test('dispatch validates workspace and releases reservations on preflight failures', async t => {
  let moved = true;
  const f = await fixture(t, ({ socket, request, reply }) => {
    if (!moved) return false;
    reply(socket, request, { pane: { pane_id: 'w1:p2', workspace_id: 'w2' } });
    return true;
  });
  await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), code('ORIGIN_CHANGED'));
  assert.deepEqual(await readdir(f.stateDir), []);
  moved = false;
  await assert.rejects(f.client.dispatch('DATA-1', f.origin, { cwd: join(f.root, 'missing'), ...target }), code('DIRECTORY_REQUIRED'));
  assert.deepEqual(await readdir(f.stateDir), []);
  await f.client.dispatch('DATA-1', f.origin, target);
  assert.equal(f.requests.filter(r => r.method === 'pane.split').length, 1);
});

test('split, readiness and prompt failures retain uncertain reservations and never resend', async t => {
  for (const method of ['pane.split', 'agent.start', 'agent.get', 'agent.prompt']) {
    await t.test(method, async t => {
      const f = await fixture(t, ({ socket, request }) => {
        if (request.method !== method) return false;
        if (method !== 'agent.prompt') socket.end(JSON.stringify({ id: request.id, error: { message: 'failed' } }) + '\n');
        return true;
      });
      f.client.timeout = 150;
      await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), code('DISPATCH_UNCERTAIN'));
      const count = f.requests.length;
      await assert.rejects(new Herdr(f.options).dispatch('DATA-1', f.origin, target), code('DISPATCH_UNCERTAIN'));
      assert.equal(f.requests.length, count);
      assert.equal(f.requests.at(-1).method, method);
    });
  }
});

for (const git of [false, true]) test(`dispatch waits for the new shell before starting pi (${git ? 'worktree' : 'sibling'})`, async t => {
  let attempts = 0;
  const f = await fixture(t, ({ socket, request }) => {
    if (request.method !== 'agent.start' || attempts++ >= 2) return false;
    socket.end(JSON.stringify({ id: request.id, error: { code: 'agent_pane_busy', message: 'Shell is still initialising' } }) + '\n');
    return true;
  }, { git });
  f.client.timeout = 3_000;
  await f.client.dispatch('DATA-1', f.origin, target);
  const starts = f.requests.filter(request => request.method === 'agent.start');
  assert.equal(starts.length, 3);
  assert.ok(starts.every(request => JSON.stringify(request.params) === JSON.stringify(starts[0].params)));
  assert.equal(f.requests.filter(request => request.method === 'worktree.create').length, git ? 1 : 0);
  assert.equal(f.requests.filter(request => request.method === 'pane.split').length, git ? 0 : 1);
  assert.equal(f.requests.filter(request => request.method === 'agent.prompt').length, 1);
  assert.equal(Object.hasOwn(f.requests.at(-1).params, 'wait'), false);
});

test('a shell that stays busy times out without starting a second dispatch', async t => {
  const f = await fixture(t, ({ socket, request }) => {
    if (request.method !== 'agent.start') return false;
    socket.end(JSON.stringify({ id: request.id, error: { code: 'agent_pane_busy', message: 'Busy' } }) + '\n');
    return true;
  });
  f.client.timeout = 100;
  await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), error => {
    assert.equal(error.code, 'DISPATCH_UNCERTAIN');
    assert.equal(error.cause.code, 'SHELL_NOT_READY');
    assert.ok(error.message.includes('(shell not ready)'));
    return true;
  });
  assert.ok(f.requests.some(request => request.method === 'agent.start'));
  assert.ok(!f.requests.some(request => ['agent.get', 'agent.prompt'].includes(request.method)));
  const count = f.requests.length;
  await assert.rejects(new Herdr(f.options).dispatch('DATA-1', f.origin, target), code('DISPATCH_UNCERTAIN'));
  assert.equal(f.requests.length, count);
});

test('startup failures other than a confirmed busy-shell rejection never retry', async t => {
  for (const kind of ['agent_start_input_failed', 'agent_pane_unavailable', 'agent_name_in_use', 'timeout', 'socket']) {
    const f = await fixture(t, ({ socket, request }) => {
      if (request.method !== 'agent.start') return false;
      if (kind === 'socket') socket.destroy();
      else if (kind !== 'timeout') socket.end(JSON.stringify({ id: request.id, error: { code: kind, message: 'private failure' } }) + '\n');
      return true;
    });
    f.client.timeout = 100;
    await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), error => {
      assert.equal(error.code, 'DISPATCH_UNCERTAIN');
      if (!['timeout', 'socket'].includes(kind)) assert.ok(error.message.includes(kind));
      assert.ok(!error.message.includes('private failure'));
      return true;
    });
    assert.equal(f.requests.filter(request => request.method === 'agent.start').length, 1);
    assert.equal(f.requests.filter(request => request.method === 'agent.prompt').length, 0);
    const count = f.requests.length;
    await assert.rejects(new Herdr(f.options).dispatch('DATA-1', f.origin, target), code('DISPATCH_UNCERTAIN'));
    assert.equal(f.requests.length, count);
  }
});

test('dispatch polls pending agents and requires every readiness condition', async t => {
  let polls = 0;
  const states = [
    { interactive_ready: false, agent_status: 'idle' },
    { interactive_ready: true, agent_status: 'idle', launch_pending: true },
    { interactive_ready: true, agent_status: 'unknown', launch_pending: false },
    { interactive_ready: true, agent_status: 'idle', launch_pending: false },
  ];
  const f = await fixture(t, ({ socket, request, reply }) => {
    if (request.method !== 'agent.get') return false;
    assert.equal(f.requests.filter(r => r.method === 'agent.prompt').length, 0);
    reply(socket, request, { agent: { pane_id: 'w1:p3', workspace_id: 'w1', ...states[polls++] } });
    return true;
  });
  f.client.timeout = 3_000;
  await f.client.dispatch('DATA-1', f.origin, target);
  assert.equal(polls, states.length);
  assert.equal(f.requests.at(-1).method, 'agent.prompt');
});

test('never-ready agents time out without prompting or allowing another dispatch', async t => {
  const f = await fixture(t, ({ socket, request, reply }) => {
    if (request.method !== 'agent.get') return false;
    reply(socket, request, { agent: { launch_pending: true, agent_status: 'unknown', pane_id: 'w1:p3', workspace_id: 'w1' } });
    return true;
  });
  f.client.timeout = 150;
  await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), error => {
    assert.equal(error.code, 'DISPATCH_UNCERTAIN');
    assert.equal(error.cause.code, 'AGENT_NOT_READY');
    return true;
  });
  assert.equal(f.requests.filter(r => r.method === 'agent.prompt').length, 0);
  const count = f.requests.length;
  await assert.rejects(new Herdr(f.options).dispatch('DATA-1', f.origin, target), code('DISPATCH_UNCERTAIN'));
  assert.equal(f.requests.length, count);
});

test('exclusive reservation blocks another process while dispatch is in flight', async t => {
  let release;
  let notify;
  const reached = new Promise(resolve => { notify = resolve; });
  const f = await fixture(t, ({ socket, request, reply }) => {
    if (request.method !== 'agent.start') return false;
    release = () => reply(socket, request, { ready: true });
    notify();
    return true;
  });
  const first = f.client.dispatch('DATA-1', f.origin, target);
  await reached;
  assert.equal(f.requests.at(-1).method, 'agent.start');
  assert.equal(f.requests.filter(r => r.method === 'agent.prompt').length, 0);
  const module = new URL('../lib/herdr.mjs', import.meta.url).href;
  const script = `import {Herdr} from ${JSON.stringify(module)};
    try { await new Herdr(${JSON.stringify(f.options)}).dispatch('DATA-1', ${JSON.stringify(f.origin)}, ${JSON.stringify(target)}); process.exitCode = 1; }
    catch (error) { if (error.code !== 'DISPATCH_UNCERTAIN') throw error; }`;
  try {
    await exec(process.execPath, ['--input-type=module', '-e', script], { timeout: 5_000 });
  } finally { release(); }
  await first;
  assert.equal(f.requests.filter(r => r.method === 'pane.split').length, 1);
});

test('dispatch fails closed on unsafe permissions and damaged records', async t => {
  const f = await fixture(t);
  await mkdir(f.stateDir, { mode: 0o755 });
  await chmod(f.stateDir, 0o755);
  await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), code('INVALID_STATE'));
  await chmod(f.stateDir, 0o700);
  await f.client.dispatch('DATA-1', f.origin, target);
  const [file] = await readdir(f.stateDir);
  await writeFile(join(f.stateDir, file), '{partial');
  await assert.rejects(f.client.dispatch('DATA-1', f.origin, target), code('DISPATCH_UNCERTAIN'));
  assert.equal(f.requests.length, 6);
});
