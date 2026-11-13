import { execFile } from 'node:child_process';
import { mkdir as makeDirectory, readFile, writeFile as writeFileAsync } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { SETTINGS_TEMPLATE, validateSettings } from './settings.mjs';

const KEYS = Object.keys(SETTINGS_TEMPLATE);

async function createTemplate(configPath, mkdir, writeFile) {
  try {
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    // wx never overwrites a file that appeared after the failed read.
    await writeFile(configPath, `${JSON.stringify(SETTINGS_TEMPLATE, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch {
    throw new Error('Missing configuration, and the template could not be created. Check that you can write to your herdr plugin config directory.');
  }
  return new Error(`Created a configuration template at ${configPath}. Fill in ${KEYS.join(', ')}, then retry.`);
}

export async function loadCredentials({
  configPath = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'herdr', 'plugins', 'config', 'herdr-jira-board', 'config.json'),
  read = readFile,
  exec = promisify(execFile),
  mkdir = makeDirectory,
  writeFile = writeFileAsync,
} = {}) {
  let raw;
  try {
    raw = await read(configPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw await createTemplate(configPath, mkdir, writeFile);
    throw new Error('Cannot read configuration. Check your configuration path and file permissions.');
  }

  let settings;
  try {
    settings = JSON.parse(raw);
  } catch {
    settings = null;
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)
      || Object.keys(settings).some(key => !KEYS.includes(key))) {
    throw new Error(`Malformed settings. Use a JSON object containing only ${KEYS.join(', ')}, never credentials.`);
  }
  const missing = KEYS.filter(key => settings[key] === undefined || settings[key] === null || settings[key] === '');
  if (missing.length) throw new Error(`Incomplete configuration. Fill in ${missing.join(', ')} in ${configPath}, then retry.`);

  const { email } = settings;
  const atom = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
  const label = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
  if (typeof email !== 'string' || email.length > 254 || /[^\x21-\x7e]/.test(email)
      || email.split('@')[0].length > 64
      || !new RegExp(`^${atom}(?:\\.${atom})*@${label}(?:\\.${label})+$`).test(email)) {
    throw new Error('Malformed email. Set your email to a valid ASCII email address without whitespace or colons.');
  }
  const jira = validateSettings(settings);

  let result;
  try {
    result = await exec('/usr/bin/security', [
      'find-generic-password', '-s', 'herdr-jira-board', '-a', email, '-w',
    ], { timeout: 10000, maxBuffer: 16384, encoding: 'utf8' });
  } catch (error) {
    if (error?.code === 44) {
      throw new Error('Missing Keychain entry. Add a generic password in Keychain Access with service herdr-jira-board and your configured email as the account.');
    }
    throw new Error('Cannot access Keychain. Unlock your Keychain, allow access, and retry. Check that macOS Keychain is available if the lookup times out.');
  }
  const token = typeof result?.stdout === 'string' ? result.stdout.replace(/[\r\n]+$/, '') : '';
  if (!token || /[^\x21-\x7e]/.test(token)) {
    throw new Error('Invalid Keychain token. Update the entry with a nonempty printable ASCII token without whitespace.');
  }
  return { email, token, ...jira };
}
