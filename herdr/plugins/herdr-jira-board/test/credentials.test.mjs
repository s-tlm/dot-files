import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { loadCredentials } from '../lib/credentials.mjs';
import { SETTINGS_TEMPLATE } from '../lib/settings.mjs';
import { settings } from './fixtures.mjs';

const email = 'person+board@example.com';
const token = 'TEST-secret-123';
const configPath = '/injected/settings.json';

function fixture(overrides = {}) {
  const calls = { read: [], exec: [], mkdir: [], writeFile: [] };
  return {
    calls,
    options: {
      configPath,
      read: async (...args) => {
        calls.read.push(args);
        return JSON.stringify({ email, ...settings });
      },
      exec: async (...args) => {
        calls.exec.push(args);
        return { stdout: `${token}\n`, stderr: 'ignored' };
      },
      mkdir: async (...args) => { calls.mkdir.push(args); },
      writeFile: async (...args) => { calls.writeFile.push(args); },
      ...overrides,
    },
  };
}

async function rejectsSafely(options, message, secrets = [token]) {
  await assert.rejects(loadCredentials(options), error => {
    assert.equal(error.constructor, Error);
    assert.match(error.message, message);
    assert.deepEqual(Object.getOwnPropertyNames(error).sort(), ['message', 'stack']);
    for (const secret of secrets) {
      for (const rendered of [String(error), error.stack, JSON.stringify(error), inspect(error)]) {
        assert.equal(rendered.includes(secret), false);
      }
    }
    return true;
  });
}

test('reads only settings and executes the fixed Keychain lookup without a shell or token arguments', async () => {
  const { options, calls } = fixture();
  assert.deepEqual(await loadCredentials(options), { email, token, ...settings });
  assert.deepEqual(calls.read, [[configPath, 'utf8']]);
  assert.deepEqual(calls.exec, [[
    '/usr/bin/security',
    ['find-generic-password', '-s', 'herdr-jira-board', '-a', email, '-w'],
    { timeout: 10000, maxBuffer: 16384, encoding: 'utf8' },
  ]]);
  assert.equal(JSON.stringify(calls).includes(token), false);
  assert.equal(Object.hasOwn(calls.exec[0][2], 'shell'), false);
});

test('resolves the default path using XDG or the home directory without creating files', async () => {
  const original = process.env.XDG_CONFIG_HOME;
  try {
    for (const value of ['/injected/xdg', '', undefined]) {
      if (value === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = value;
      const { options, calls } = fixture();
      delete options.configPath;
      await loadCredentials(options);
      assert.deepEqual([calls.mkdir, calls.writeFile], [[], []]);
      assert.deepEqual(calls.read, [[join(value || join(homedir(), '.config'), 'herdr', 'plugins', 'config', 'herdr-jira-board', 'config.json'), 'utf8']]);
    }
  } finally {
    if (original === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = original;
  }
});

for (const code of ['EACCES', 'EISDIR', 'ENOTDIR', 'ERR_INVALID_ARG_TYPE', undefined]) {
  test(`sanitises configuration read errors: ${code}`, async () => {
    const secretPath = `/private/${token}/config.json`;
    const failure = Object.assign(new Error(`${secretPath}: ${token}`), { code, path: secretPath });
    const { options, calls } = fixture({ configPath: secretPath, read: async path => {
      assert.equal(path, secretPath);
      throw failure;
    } });
    await rejectsSafely(options, /Cannot read configuration.*path.*permissions/, [token, secretPath]);
    assert.deepEqual([calls.exec, calls.mkdir, calls.writeFile], [[], [], []]);
  });
}

const missingFile = async () => { throw Object.assign(new Error(`${configPath}: ${token}`), { code: 'ENOENT' }); };

test('creates a private template exclusively when the configuration is missing, then stops before Keychain', async () => {
  const { options, calls } = fixture({ read: missingFile });
  await rejectsSafely(options, /^Created a configuration template at \/injected\/settings\.json\. Fill in email, site, board, project, storyPointsField, then retry\.$/);
  assert.deepEqual(calls.mkdir, [['/injected', { recursive: true, mode: 0o700 }]]);
  assert.equal(calls.writeFile.length, 1);
  const [path, content, flags] = calls.writeFile[0];
  assert.equal(path, configPath);
  assert.deepEqual(flags, { flag: 'wx', mode: 0o600 });
  assert.deepEqual(JSON.parse(content), { email: '', site: '', board: null, project: '', storyPointsField: '' });
  assert.deepEqual(JSON.parse(content), SETTINGS_TEMPLATE);
  assert.ok(content.endsWith('}\n'));
  assert.deepEqual(calls.exec, []);
});

for (const step of ['mkdir', 'writeFile']) {
  test(`never overwrites and reports a sanitised failure when template ${step} fails`, async () => {
    const { options, calls } = fixture({ read: missingFile, [step]: async () => {
      throw Object.assign(new Error(`${configPath}: ${token}`), { code: 'EEXIST', path: configPath });
    } });
    await rejectsSafely(options, /Missing configuration, and the template could not be created/, [token, configPath]);
    assert.deepEqual(calls.exec, []);
  });
}

test('creates a real template once with private modes and never overwrites it', async t => {
  const { mkdtemp, readFile, rm, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(join(tmpdir(), 'jira-config-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'nested', 'config.json');
  const exec = () => assert.fail('Keychain must not be read');
  await assert.rejects(loadCredentials({ configPath: path, exec }), /Created a configuration template/);
  assert.equal((await stat(join(root, 'nested'))).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const template = await readFile(path, 'utf8');
  await assert.rejects(loadCredentials({ configPath: path, exec }), /Incomplete configuration/);
  assert.equal(await readFile(path, 'utf8'), template);
});

test('an existing file is read, not replaced', async () => {
  const { options, calls } = fixture();
  await loadCredentials(options);
  assert.deepEqual([calls.mkdir, calls.writeFile], [[], []]);
});

for (const [label, values, missing] of [
  ['the untouched template', SETTINGS_TEMPLATE, 'email, site, board, project, storyPointsField'],
  ['an email-only file', { email }, 'site, board, project, storyPointsField'],
  ['an empty object', {}, 'email, site, board, project, storyPointsField'],
  ['null and empty values', { email, ...settings, board: null, storyPointsField: '' }, 'board, storyPointsField'],
]) {
  test(`lists every field that still needs a value: ${label}`, async () => {
    const { options, calls } = fixture({ read: async () => JSON.stringify(values) });
    await rejectsSafely(options, new RegExp(`^Incomplete configuration\\. Fill in ${missing} in /injected/settings\\.json, then retry\\.$`));
    assert.deepEqual([calls.exec, calls.writeFile], [[], []]);
  });
}

for (const [key, values, message] of [
  ['site', ['http://example.atlassian.net', 'https://example.com', 'https://evil.com/example.atlassian.net',
    'https://example.atlassian.net/jira', 'https://example.atlassian.net:443', 'https://user:pass@example.atlassian.net',
    'https://example.atlassian.net?x=1', 'https://example.atlassian.net#x', 'https://example.atlassian.net.evil.com',
    'https://-example.atlassian.net', 'https://a.b.atlassian.net', 'https://EXAMPLE.atlassian.net', ' https://example.atlassian.net', 42],
  /^Malformed site\. Set site to your Jira Cloud URL/],
  ['board', [0, -1, 1.5, '11', 2 ** 53, true, [11]], /^Malformed board\./],
  ['project', ['data', 'D', 'DATA-1', '1DATA', 'ABCDEFGHIJK', 'DA TA', 7], /^Malformed project\./],
  ['storyPointsField', ['customfield_', 'customfield_0', 'customfield_01', 'customfield_1a', 'points', 10000], /^Malformed storyPointsField\./],
]) {
  for (const value of values) {
    test(`rejects an invalid ${key} before Keychain: ${JSON.stringify(value)}`, async () => {
      const { options, calls } = fixture({ read: async () => JSON.stringify({ email, ...settings, [key]: value }) });
      await rejectsSafely(options, message);
      assert.deepEqual(calls.exec, []);
    });
  }
}

test('normalises a trailing slash on the site', async () => {
  const { options } = fixture({ read: async () => JSON.stringify({ email, ...settings, site: `${settings.site}/` }) });
  assert.equal((await loadCredentials(options)).site, settings.site);
});

test('sanitises non-Error failures from the settings reader', async () => {
  const { options, calls } = fixture({ read: async () => { throw null; } });
  await rejectsSafely(options, /Cannot read configuration/);
  assert.deepEqual(calls.exec, []);
});

for (const raw of [
  '', `{"email":"${token}`, 'null', '[]', 'false', '42', '"text"',
  ...['token', 'password', 'headers', 'unexpected', 'Email', '__proto__', 'apiToken', 'boards'].map(key =>
    JSON.stringify({ email, ...settings, [key]: token })),
  JSON.stringify({ token }),
]) {
  test(`rejects malformed or extra settings without reading Keychain: ${JSON.stringify(raw)}`, async () => {
    const { options, calls } = fixture({ read: async () => raw });
    await rejectsSafely(options, /Malformed settings/, [token, ...(raw.length > 10 ? [raw] : [])]);
    assert.deepEqual(calls.exec, []);
  });
}

for (const invalid of [
  undefined, null, 42, {}, [], '', 'person', 'person@localhost', '@example.com',
  'a@@example.com', 'a:b@example.com', 'a b@example.com', 'a@example.com\n',
  '\tperson@example.com', 'a\0@example.com', 'a\x7f@example.com', 'é@example.com',
  '.a@example.com', 'a.@example.com', 'a..b@example.com', 'a@-example.com',
  'a@example-.com', 'a@example..com', 'a@example.com.', 'a@exam_ple.com',
  `${'a'.repeat(65)}@example.com`, `a@${'b'.repeat(64)}.com`,
  `a@${Array(4).fill('b'.repeat(63)).join('.')}`,
]) {
  test(`rejects an unclean or implausible email: ${JSON.stringify(invalid)}`, async () => {
    const { options, calls } = fixture({ read: async () => JSON.stringify({ ...settings, email: invalid }) });
    await rejectsSafely(options, [undefined, null, ''].includes(invalid) ? /Incomplete configuration\. Fill in email in/ : /Malformed email/);
    assert.deepEqual(calls.exec, []);
  });
}

for (const valid of [email, 'First.Last@example.co.uk', "o'brien@example.com", '`whoami`@example.com', `${'a'.repeat(64)}@example.com`]) {
  test(`passes a valid email as a literal account argument: ${valid}`, async () => {
    const { options, calls } = fixture({ read: async () => JSON.stringify({ ...settings, email: valid }) });
    assert.deepEqual(await loadCredentials(options), { email: valid, token, ...settings });
    assert.equal(calls.exec[0][1][4], valid);
  });
}

for (const ending of ['', '\n', '\r\n', '\r', '\n\r\n\n']) {
  test(`removes only trailing line endings: ${JSON.stringify(ending)}`, async () => {
    const { options } = fixture({ exec: async () => ({ stdout: token + ending }) });
    assert.deepEqual(await loadCredentials(options), { email, token, ...settings });
  });
}

test('accepts every printable non-whitespace ASCII token character unchanged', async () => {
  const printable = Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33)).join('');
  const { options } = fixture({ exec: async () => ({ stdout: `${printable}\r\n`, stderr: token }) });
  assert.deepEqual(await loadCredentials(options), { email, token: printable, ...settings });
});

for (const stdout of [
  undefined, null, 123, Buffer.from(token), '', '\n\r\n', ` ${token}`, `${token} `,
  `\n${token}`, `${token}\nmore`, `${token}\rmore`, `${token}\t`, `${token}\v`,
  `${token}\0`, `${token}\x1b`, `${token}\x7f`, `${token}é`, `${token}\u00a0`,
]) {
  test(`rejects invalid token output: ${JSON.stringify(stdout)}`, async () => {
    const { options } = fixture({ exec: async () => ({ stdout, stderr: token }) });
    await rejectsSafely(options, /Invalid Keychain token/);
  });
}

for (const result of [undefined, null, {}]) {
  test(`rejects missing lookup output: ${JSON.stringify(result)}`, async () => {
    const { options } = fixture({ exec: async () => result });
    await rejectsSafely(options, /Invalid Keychain token/);
  });
}

for (const failure of [
  { code: 44 }, { code: '44' }, { code: 36 }, { code: 51 }, { code: 128 },
  { code: 'EACCES' }, { code: 'ENOENT' }, { code: 'ETIMEDOUT' },
  { killed: true, signal: 'SIGTERM' }, { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, {},
]) {
  test(`sanitises failed Keychain lookup: ${JSON.stringify(failure)}`, async () => {
    const sensitive = Object.assign(new Error(token), failure, {
      stdout: token, stderr: token, cause: new Error(token), cmd: token,
    });
    let attempts = 0;
    const { options } = fixture({ exec: async () => { attempts++; throw sensitive; } });
    await rejectsSafely(options, failure.code === 44 ? /Missing Keychain entry.*service herdr-jira-board.*account/ : /Cannot access Keychain.*Unlock.*allow access.*times out/);
    assert.equal(attempts, 1);
  });
}

test('sanitises a non-Error lookup rejection', async () => {
  const { options } = fixture({ exec: async () => { throw null; } });
  await rejectsSafely(options, /Cannot access Keychain/);
});
