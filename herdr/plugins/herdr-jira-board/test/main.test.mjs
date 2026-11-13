import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { settings as jiraSettings } from './fixtures.mjs';
const exec = promisify(execFile);
const entry = fileURLToPath(new URL('../bin/herdr-jira-board.mjs', import.meta.url));
const browse = action => `query\n${action}\nDATA-1\tTicket\n`;
const choice = id => `${id}\tChoice\n`;

for (const scenario of [
  { name: 'open captures the origin before opening without reading credentials', command: 'open', answers: [], writes: [] },
  { name: 'auth validates credentials and metadata without OAuth or fzf', command: 'auth', answers: [], writes: [] },
  { name: 'check reads the snapshot without opening the browser', command: 'check', answers: [], writes: [] },
  { name: 'missing credentials fail without OAuth, browser or network setup', command: 'auth', fail: 'credentials', answers: [], writes: [], expectedError: true },
  { name: 'cancelled comment retains its draft without writing', action: 'c', answers: ['cancel'], writes: [] },
  { name: 'uncertain comment retains its draft without retrying', action: 'c', answers: ['submit'], fail: 'comment', writes: ['comment'] },
  { name: 'cancelled status does not transition', action: 's', answers: ['21', 'cancel'], writes: [] },
  { name: 'cancelled points do not update', action: 'p', answers: ['3', 'cancel'], writes: [] },
  { name: 'refresh failure preserves the accepted write outcome', action: 's', answers: ['21', 'submit'], fail: 'refresh', writes: ['transition'] },
  { name: 'dispatch uses the originating directory without a picker and rechecks scope', action: 'd', answers: [], writes: ['dispatch'] },
  { name: 'worktree dispatch reports its Herdr branch', action: 'd', answers: [], branch: 'feat/data-1', writes: ['dispatch'] },
  { name: 'stale ticket cannot dispatch', action: 'd', answers: [], fail: 'scope', writes: [] },
]) test(`controller: ${scenario.name}`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jira-controller-test-'));
  const log = join(dir, 'events.jsonl');
  const settings = { ...scenario, queue: scenario.command ? [] : [browse(scenario.action), ...scenario.answers.map(choice), null] };
  const common = `import {appendFileSync,readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
    import {join} from 'node:path';
    const config=JSON.parse(process.env.JIRA_TEST_SETTINGS);
    const event=(name,value)=>appendFileSync(process.env.JIRA_TEST_LOG,JSON.stringify({name,value})+'\\n');
    const nextAnswer=()=>{
      const counter=join(process.env.TMPDIR,'count');
      const index=existsSync(counter)?Number(readFileSync(counter,'utf8')):0;
      writeFileSync(counter,String(index+1));
      return config.queue[index];
    };`;
  const modules = {
    'board.mjs': `${common}
      export async function browse(issues,state){
        const drafts=readdirSync(process.env.TMPDIR).filter(x=>x.startsWith('herdr-jira-board-')).flatMap(x=>{
          const dir=join(process.env.TMPDIR,x);
          return readdirSync(dir).filter(x=>x.endsWith('.draft')).map(x=>readFileSync(join(dir,x),'utf8'));
        });
        event('board',{issues,state,drafts});
        const answer=nextAnswer();
        if(answer==null)return null;
        const [query,action,line]=answer.trimEnd().split('\\n');
        return {query,action,selected:line?.split('\\t')[0],sort:'created'};
      }`,
    'credentials.mjs': `${common} export async function loadCredentials(){event('credentials');if(config.fail==='credentials')throw Error('Missing configuration');return {email:'test@example.invalid',token:'test-only',...${JSON.stringify(jiraSettings)}}}`,
    'jira.mjs': `${common}
      export class Jira {
        constructor(config){event('jira',config)}
        me={accountId:'me'};
        async init(){event('init');return this}
        snapshots=0;
        async snapshot(){if(this.snapshots++>0&&config.fail==='refresh')throw Error('Read failed');return {state:'Sprint',issues:[{key:'DATA-2',fields:{summary:'Other'}},{key:'DATA-1',fields:{summary:'Ticket'}}]}}
        async scope(){event('scope');return {sprint:{name:'Sprint'}}}
        async transitions(){return [{id:'21',name:'Start',to:{name:'In Progress'}}]}
        async assertScope(key){event('scope',key);if(config.fail==='scope')throw Error('Ticket left the active scope')}
        async transition(){event('transition')}
        async points(){event('points')}
        async comment(){event('comment');if(config.fail==='comment')throw Error('Write outcome is uncertain. Check Jira.')}
      }`,
    'herdr.mjs': `${common}
      export const captureOrigin=(env=process.env)=>JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON);
      export class Herdr {
        async open(origin){event('open',origin)}
        async dispatch(key,origin,{cwd,site,project,...rest}){event('dispatch',{key,origin,cwd,site,project,rest});return {branch:config.branch}}
      }`,
  };
  const loader = join(dir, 'loader.mjs');
  await writeFile(loader, `const modules=${JSON.stringify(modules)};
    export async function load(url,context,next){
      const name=url.split('/').at(-1);
      if(url.includes('/lib/')&&modules[name])return {format:'module',source:modules[name],shortCircuit:true};
      return next(url,context);
    }`);
  const setup = join(dir, 'setup.mjs');
  await writeFile(setup, `import {register} from 'node:module'; register(${JSON.stringify(new URL(`file://${loader}`).href)},import.meta.url);`);
  const fzf = join(dir, 'fzf');
  await writeFile(fzf, `#!${process.execPath}
    import fs from 'node:fs'; import path from 'node:path';
    const config=JSON.parse(process.env.JIRA_TEST_SETTINGS);
    const counter=path.join(process.env.TMPDIR,'count');
    const count=fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8')):0;
    fs.writeFileSync(counter,String(count+1));
    const drafts=fs.readdirSync(process.env.TMPDIR).filter(x=>x.startsWith('herdr-jira-board-')).flatMap(x=>{
      const dir=path.join(process.env.TMPDIR,x);
      return fs.readdirSync(dir).filter(x=>x.endsWith('.draft')).map(x=>fs.readFileSync(path.join(dir,x),'utf8'));
    });
    fs.appendFileSync(process.env.JIRA_TEST_LOG,JSON.stringify({name:'fzf',value:{args:process.argv.slice(2),drafts}})+'\\n');
    const answer=config.queue[count];
    if(answer==null)process.exit(130);
    process.stdout.write(answer);
  `, { mode: 0o700 });
  await writeFile(join(dir, 'package.json'), '{"type":"module"}');
  const editor = join(dir, 'editor');
  await writeFile(editor, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(process.argv[2],'First line\\nSecond line\\n');`, { mode: 0o700 });
  const origin = { workspace_id: 'w1', focused_pane_id: 'w1:p1', tab_id: 'w1:t1', focused_pane_cwd: dir };
  try {
    const result = await exec(process.execPath, ['--import', setup, entry, ...(scenario.command ? [scenario.command] : [])], { timeout: 10000, env: {
      ...process.env, TMPDIR: dir, PATH: `${dir}:${process.env.PATH}`, VISUAL: editor,
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify(origin), JIRA_BOARD_ORIGIN_JSON: '',
      JIRA_TEST_LOG: log, JIRA_TEST_SETTINGS: JSON.stringify(settings),
    } }).then(value => {
      assert.ok(!scenario.expectedError, 'The command should fail when credentials are missing');
      return value;
    }, error => {
      if (!scenario.expectedError) throw error;
      assert.match(error.stderr, /Missing configuration/);
      return { stdout: '', stderr: error.stderr };
    });
    const events = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.filter(e => ['comment', 'transition', 'points', 'dispatch'].includes(e.name)).map(e => e.name), scenario.writes);
    if (scenario.command) {
      assert.equal(events.filter(e => e.name === 'credentials').length, scenario.command === 'open' ? 0 : 1);
      assert.equal(events.filter(e => e.name === 'fzf').length, 0);
      if (scenario.command === 'open') {
        assert.deepEqual(events, [{ name: 'open', value: origin }]);
        assert.ok(!(await readdir(dir)).some(x => x.startsWith('herdr-jira-board-')));
        return;
      }
      assert.doesNotMatch(result.stderr, /OAuth|browser may open/i);
      if (!scenario.expectedError) assert.match(result.stdout, scenario.command === 'auth' ? /credential verified/ : /2 scoped tickets/);
      assert.ok(!(await readdir(dir)).some(x => x.startsWith('herdr-jira-board-')));
      return;
    }
    const lastBrowser = events.filter(e => e.name === 'board').at(-1).value;
    assert.equal(lastBrowser.state.query, 'query');
    assert.equal(lastBrowser.state.selected, 'DATA-1');
    assert.equal(lastBrowser.state.sort, 'created');
    assert.deepEqual(lastBrowser.issues.map(issue => issue.key), ['DATA-2', 'DATA-1']);
    assert.doesNotMatch(lastBrowser.state.header, /\/:search|a:assignee|Shift\+arrows/);
    if (scenario.action === 'c') assert.deepEqual(lastBrowser.drafts, ['First line\nSecond line\n']);
    if (scenario.fail === 'comment') assert.ok(lastBrowser.state.alert.includes('outcome is uncertain'));
    if (scenario.fail === 'refresh') assert.ok(lastBrowser.state.alert.includes('update accepted, but a follow-up failed. Check Jira before repeating.'));
    if (scenario.fail === 'scope') assert.ok(lastBrowser.state.alert.includes('left the active scope'));
    if (!scenario.fail) assert.equal(lastBrowser.state.alert, '');
    if (scenario.branch) assert.ok(lastBrowser.state.header.includes(`${scenario.branch} (Herdr worktree)`));
    if (scenario.action === 'd') assert.equal(events.filter(event => event.name === 'fzf').length, 0);
    if (scenario.writes.includes('dispatch')) {
      const index = events.findIndex(e => e.name === 'dispatch');
      assert.equal(events[index - 1].name, 'scope');
      assert.deepEqual(events[index].value, { key: 'DATA-1', origin, cwd: dir, site: jiraSettings.site, project: jiraSettings.project, rest: {} });
    }
    assert.equal(events.filter(e => e.name === 'credentials').length, 1);
    assert.deepEqual(events.filter(e => e.name === 'jira').map(e => e.value), [{ email: 'test@example.invalid', token: 'test-only', ...jiraSettings }]);
    assert.equal(events.filter(e => e.name === 'init').length, 1);
    assert.ok(!(await readdir(dir)).some(x => x.startsWith('herdr-jira-board-')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
