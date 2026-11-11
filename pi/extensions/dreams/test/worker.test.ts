import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createJob, jobDirectory, readJob } from "../jobs.ts";
import { runWorker } from "../worker.ts";

const fake = join(dirname(fileURLToPath(import.meta.url)), "fake-pi.ts");
async function fixture(
  t: TestContext,
  model = "fake/success",
  keepTranscripts = false,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dream-worker-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const agentDirectory = join(root, "agent");
  await mkdir(repo);
  await mkdir(agentDirectory);
  await writeFile(join(repo, "AGENTS.md"), "Repo rule.\n");
  await writeFile(join(repo, "AGENTS.override.md"), "Override rule.\n");
  await writeFile(join(repo, "CLAUDE.md"), "Claude rule.\n");
  await mkdir(join(repo, ".claude"));
  await writeFile(
    join(repo, ".claude", "CLAUDE.md"),
    "This is not pi context.\n",
  );
  await writeFile(join(agentDirectory, "AGENTS.md"), "Global rule.\n");
  await writeFile(join(agentDirectory, "CLAUDE.MD"), "Global legacy rule.\n");
  const session = join(root, "session.jsonl");
  await writeFile(
    session,
    [
      {
        type: "session",
        version: 3,
        id: "fixture",
        cwd: repo,
        timestamp: "2026-11-01T00:00:00Z",
      },
      {
        type: "message",
        id: "u",
        parentId: null,
        message: { role: "user", content: "Remember this lasting fact." },
      },
      {
        type: "message",
        id: "a",
        parentId: "u",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "A lasting fact." }],
        },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
  const jobs = join(root, "jobs");
  const store = join(root, "memory");
  const job = await createJob(jobs, {
    storeKey: "store",
    storePath: store,
    repoRoot: repo,
    sessionFiles: [session],
    model,
    keepTranscripts,
  });
  const directory = jobDirectory(jobs, job.id);
  const runtime = {
    execPath: process.execPath,
    piEntry: fake,
    timeoutMs: 10_000,
    agentDirectory,
  };
  return {
    root,
    store,
    job,
    directory,
    runtime,
    output: `${store}.dream-${job.id}`,
  };
}

test("runs analyzers and organizer, sums usage, preserves input, and removes stubs and transcripts", async (t) => {
  const f = await fixture(t);
  await mkdir(f.store, { mode: 0o700 });
  await writeFile(join(f.store, "original.md"), "Original memory.\n");
  const result = await runWorker(f.directory, f.runtime);
  assert.equal(result.status, "completed", JSON.stringify(result.error));
  assert.equal(result.progress.done, 1);
  assert.equal(result.progress.phase, "completed");
  assert.equal(result.usage.cost_usd, 0.02);
  assert.equal(result.usage.input_tokens, 40);
  assert.equal(result.usage.output_tokens, 20);
  assert.equal(result.usage.cache_read_input_tokens, 10);
  assert.equal(result.usage.cache_creation_input_tokens, 4);
  assert.match(result.summary, /Curated a topic\.\u2028Checked links/);
  assert.equal(
    await readFile(join(f.store, "original.md"), "utf8"),
    "Original memory.\n",
  );
  assert.deepEqual(await readdir(f.store), ["original.md"]);
  assert.match(await readFile(join(f.output, "MEMORY.md"), "utf8"), /topic.md/);
  await assert.rejects(access(join(f.output, "retired.md")));
  await assert.rejects(access(join(f.directory, "transcripts")));
  assert.equal(
    await readFile(join(f.directory, "context", "repo", "AGENTS.md"), "utf8"),
    "Repo rule.\n",
  );
  assert.equal(
    await readFile(join(f.directory, "context", "global", "AGENTS.md"), "utf8"),
    "Global rule.\n",
  );
  assert.equal(
    await readFile(join(f.directory, "context", "global", "CLAUDE.MD"), "utf8"),
    "Global legacy rule.\n",
  );
  assert.equal(
    await readFile(
      join(f.directory, "context", "repo", "AGENTS.override.md"),
      "utf8",
    ),
    "Override rule.\n",
  );
  assert.equal(
    await readFile(join(f.directory, "context", "repo", "CLAUDE.md"), "utf8"),
    "Claude rule.\n",
  );
  await assert.rejects(access(join(f.directory, "context", "repo", ".claude")));
  assert.equal((await lstat(f.output)).mode & 0o777, 0o700);
  assert.deepEqual(await readJob(f.directory), result);
  await assert.rejects(runWorker(f.directory, f.runtime), /EEXIST/);
});

test("keeps transcripts only when requested", async (t) => {
  const f = await fixture(t, "fake/success", true);
  const result = await runWorker(f.directory, f.runtime);
  assert.equal(result.status, "completed");
  const path = join(f.directory, "transcripts", "1.txt");
  assert.match(await readFile(path, "utf8"), /lasting fact/);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
});

for (const model of [
  "fake/fail",
  "fake/abort",
  "fake/length",
  "fake/unsettled",
  "fake/malformed",
  "fake/invalid-usage",
]) {
  test(`rejects incomplete or failed analyzer protocol: ${model}`, async (t) => {
    const f = await fixture(t, model);
    const result = await runWorker(f.directory, f.runtime);
    assert.equal(result.status, "failed");
    assert.equal(result.error?.type, "analyzer_failed");
    assert.equal(result.progress.failed.length, 1);
    assert.equal(result.outputs.length, 1);
    await assert.rejects(access(join(f.output, "MEMORY.md")));
    await assert.rejects(access(join(f.directory, "transcripts")));
  });
}

test("stops at the reported budget and retains partial output", async (t) => {
  const f = await fixture(t, "fake/budget");
  f.job.budget_usd = 0.5;
  const { saveJob } = await import("../jobs.ts");
  await saveJob(f.directory, f.job);
  const result = await runWorker(f.directory, f.runtime);
  assert.equal(result.status, "failed");
  assert.equal(result.error?.type, "budget_exceeded");
  assert.equal(result.usage.cost_usd, 1);
  await access(join(f.output, "topic.md"));
});

test("times out a hanging child", async (t) => {
  const f = await fixture(t, "fake/hang");
  const result = await runWorker(f.directory, { ...f.runtime, timeoutMs: 200 });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.type, "timeout");
});

test("cancels pending work without cloning or spending", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "cancel"), "");
  const result = await runWorker(f.directory, f.runtime);
  assert.equal(result.status, "canceled");
  assert.equal(result.usage.cost_usd, 0);
  assert.deepEqual(result.outputs, []);
});

test("cancels a running child and escalates when it ignores SIGTERM", async (t) => {
  const f = await fixture(t, "fake/ignore-term");
  const timer = setTimeout(() => {
    void writeFile(join(f.directory, "cancel"), "");
  }, 600);
  t.after(() => clearTimeout(timer));
  const result = await runWorker(f.directory, f.runtime);
  assert.equal(result.status, "canceled");
  assert.equal(result.error, null);
  const descendant = Number(
    await readFile(join(f.output, "descendant.pid"), "utf8"),
  );
  assert.throws(
    () => process.kill(descendant, 0),
    (error: NodeJS.ErrnoException) => error.code === "ESRCH",
  );
  await assert.rejects(access(join(f.directory, "transcripts")));
});

test("reports unavailable session inputs before cloning", async (t) => {
  const f = await fixture(t);
  await rm(f.job.inputs[1].session_files[0]);
  const result = await runWorker(f.directory, f.runtime);
  assert.equal(result.error?.type, "input_session_unavailable");
  assert.deepEqual(result.outputs, []);
});

test("rejects an oversized store before cloning", async (t) => {
  const f = await fixture(t);
  await mkdir(f.store);
  await writeFile(
    join(f.store, "huge.md"),
    Buffer.alloc(10 * 1024 * 1024 + 1, 65),
  );
  const result = await runWorker(f.directory, f.runtime);
  assert.equal(result.error?.type, "input_memory_store_too_large");
  assert.deepEqual(result.outputs, []);
});

test("parallel analyzers all settle before final organisation", async (t) => {
  const f = await fixture(t);
  const other = join(f.root, "session2.jsonl");
  await writeFile(
    other,
    (await readFile(f.job.inputs[1].session_files[0], "utf8")).replace(
      '"id":"fixture"',
      '"id":"fixture2"',
    ),
  );
  f.job.inputs[1].session_files.push(other);
  f.job.concurrency = 2;
  f.job.progress.total = 2;
  const { saveJob } = await import("../jobs.ts");
  await saveJob(f.directory, f.job);
  const result = await runWorker(f.directory, f.runtime);
  assert.equal(result.status, "completed");
  assert.equal(result.progress.done, 2);
  assert.equal(result.usage.cost_usd, 0.03);
});
