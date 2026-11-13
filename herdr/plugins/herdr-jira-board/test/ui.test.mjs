import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const scenario of [
  { name: 'Enter exits search without dispatching', keys: ['/dspca', '\r', 'd'], expected: { query: 'dspca', action: 'd', selected: 'DATA-1', sort: null } },
  { name: 'Esc exits search without closing', keys: ['/dspca', '\u001b', 'r'], expected: { query: 'dspca', action: 'r', selected: 'DATA-1', sort: null } },
  { name: 'q types in search and closes in navigation', keys: ['/q', '\u001b', 'q'], expected: null },
  { name: 'refresh works in an empty snapshot', keys: ['r'], empty: true, expected: { query: '', action: 'r', sort: null } },
]) test(`real TUI: ${scenario.name}`, { timeout: 15000, skip: process.platform !== 'darwin' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jira-fzf-test-'));
  const output = join(dir, 'result.json');
  const browser = new URL('../lib/board.mjs', import.meta.url).href;
  const code = `import {browse} from ${JSON.stringify(browser)}; import {writeFile} from 'node:fs/promises';
    const result = await browse(${scenario.empty ? '[]' : "[{key:'DATA-1',fields:{summary:'dspca test'}}]"}, {header:'READY-TUI',query:''});
    await writeFile(${JSON.stringify(output)},JSON.stringify(result));`;
  const driver = `import os, pty, sys, select, time, signal, fcntl, termios, struct
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], [sys.argv[1], '--input-type=module', '-e', sys.argv[2]])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
started = None
transcript = b''
keys = [(0.1 + index * 0.3, key.encode()) for index, key in enumerate(__import__('json').loads(sys.argv[3]))]
deadline = time.monotonic() + 9
try:
    while time.monotonic() < deadline:
        if started is not None and keys and time.monotonic() - started >= keys[0][0]:
            os.write(fd, keys.pop(0)[1])
        if select.select([fd], [], [], 0.02)[0]:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            transcript += data
            if started is None and b'READY-TUI' in transcript:
                started = time.monotonic()
    else:
        raise RuntimeError('TUI did not exit')
    _, status = os.waitpid(pid, 0)
    if os.waitstatus_to_exitcode(status) != 0:
        raise RuntimeError(transcript.decode(errors='replace'))
finally:
    os.close(fd)
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
`;
  const child = spawn('uv', ['run', '--no-project', 'python', '-c', driver, process.execPath, code, JSON.stringify(scenario.keys)],
    { env: { ...process.env, TERM: 'xterm-256color', PI_TUI_WRITE_LOG: join(dir, 'forbidden-tui.log') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let transcript = '';
  child.stdout.on('data', chunk => { transcript += chunk; });
  child.stderr.on('data', chunk => { transcript += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`TUI did not exit: ${transcript.slice(-2000)}`)); }, 10000);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`TUI exited ${code}: ${transcript.slice(-2000)}`)); });
    });
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), scenario.expected);
    await assert.rejects(readFile(join(dir, 'forbidden-tui.log')), { code: 'ENOENT' });
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});
