import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveJob,
  cancelJob,
  createJob,
  finished,
  jobDirectory,
  listJobs,
  readJob,
  recoverJob,
  saveJob,
  transition,
} from "../jobs.ts";
import type { Status } from "../jobs.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "dream-jobs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = {
    storeKey: "store",
    storePath: join(root, "memory"),
    repoRoot: root,
    sessionFiles: [join(root, "session.jsonl")],
  };
  const job = await createJob(root, options);
  return { root, job, directory: jobDirectory(root, job.id), options };
}

test("creates a private pending job with the planned defaults", async (t) => {
  const { job, directory } = await fixture(t);
  assert.equal(job.status, "pending");
  assert.equal(job.model, "anthropic/claude-sonnet-5-5");
  assert.equal(job.budget_usd, 5);
  assert.equal(job.concurrency, 1);
  assert.deepEqual(await readJob(directory), job);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(directory, "dream.json"))).mode & 0o777, 0o600);
});

test("validates inputs, budget, concurrency and job IDs", async (t) => {
  const { root, options } = await fixture(t);
  for (const extra of [
    { sessionFiles: [] },
    { sessionFiles: ["same", "same"] },
    { sessionFiles: Array.from({ length: 101 }, (_, i) => `${i}`) },
    { budget: 0 },
    { budget: NaN },
    { budget: Infinity },
    { concurrency: 0 },
    { concurrency: 1.5 },
    { concurrency: 101 },
  ])
    await assert.rejects(createJob(root, { ...options, ...extra }));
  for (const id of ["../escape", "drm_../../escape", "", "drm_x/y"])
    assert.throws(() => jobDirectory(root, id));
});

test("every state transition matches the status rules", async (t) => {
  const { job } = await fixture(t);
  const states: Status[] = [
    "pending",
    "running",
    "completed",
    "failed",
    "canceled",
  ];
  const allowed = new Set([
    "pending:running",
    "pending:failed",
    "pending:canceled",
    "running:completed",
    "running:failed",
    "running:canceled",
    "canceled:canceled",
  ]);
  for (const from of states)
    for (const to of states) {
      const candidate = { ...structuredClone(job), status: from };
      if (allowed.has(`${from}:${to}`)) {
        transition(candidate, to);
        assert.equal(candidate.status, to);
        if (finished(to) && from !== to) assert.ok(candidate.ended_at);
      } else assert.throws(() => transition(candidate, to), /Cannot change/);
    }
});

test("recovers dead workers and abandoned pending jobs but not live workers", async (t) => {
  const { job, directory } = await fixture(t);
  transition(job, "running");
  job.pid = process.pid;
  await saveJob(directory, job);
  assert.equal((await recoverJob(directory)).status, "running");
  job.pid = 2_147_483_647;
  await saveJob(directory, job);
  assert.equal((await recoverJob(directory)).error?.type, "internal_error");
  job.status = "pending";
  job.pid = null;
  await saveJob(directory, job);
  assert.equal(
    (await recoverJob(directory, Date.parse(job.created_at) + 100)).status,
    "pending",
  );
  assert.equal(
    (await recoverJob(directory, Date.parse(job.created_at) + 60_001)).status,
    "failed",
  );
});

test("cancel marks pending work, is idempotent when canceled and rejects other terminal states", async (t) => {
  const { job, directory } = await fixture(t);
  await cancelJob(directory);
  assert.equal(await readFile(join(directory, "cancel"), "utf8"), "");
  transition(job, "canceled");
  await saveJob(directory, job);
  await cancelJob(directory);
  for (const status of ["completed", "failed"] as Status[]) {
    job.status = status;
    await saveJob(directory, job);
    await assert.rejects(cancelJob(directory), /Cannot cancel/);
  }
});

test("archives only finished jobs and hides them unless all is requested", async (t) => {
  const { root, job, directory } = await fixture(t);
  await assert.rejects(archiveJob(directory), /Only finished/);
  transition(job, "running");
  job.pid = process.pid;
  await saveJob(directory, job);
  await assert.rejects(archiveJob(directory), /Only finished/);
  for (const status of ["completed", "failed", "canceled"] as Status[]) {
    job.status = status;
    job.archived_at = null;
    await saveJob(directory, job);
    await archiveJob(directory);
    const timestamp = (await readJob(directory)).archived_at;
    assert.ok(timestamp);
    await archiveJob(directory);
    assert.equal((await readJob(directory)).archived_at, timestamp);
    assert.deepEqual(await listJobs(root), []);
    assert.equal((await listJobs(root, true)).length, 1);
  }
  assert.deepEqual(await listJobs(join(root, "missing")), []);
});

test("a cancel request never rewrites a live worker's job record", async (t) => {
  const { job, directory } = await fixture(t);
  transition(job, "running");
  job.pid = process.pid;
  await saveJob(directory, job);
  const before = await readFile(join(directory, "dream.json"), "utf8");
  await cancelJob(directory);
  assert.equal(await readFile(join(directory, "dream.json"), "utf8"), before);
  assert.equal(await readFile(join(directory, "cancel"), "utf8"), "");
});

test("a dead worker can be canceled directly without signalling a PID", async (t) => {
  const { job, directory } = await fixture(t);
  transition(job, "running");
  job.pid = 2_147_483_647;
  await saveJob(directory, job);
  await cancelJob(directory);
  assert.equal((await readJob(directory)).status, "canceled");
});

test("readers never see a half-written record while the worker publishes updates", async (t) => {
  const { job, directory } = await fixture(t);
  transition(job, "running");
  job.pid = process.pid;
  await saveJob(directory, job);
  let done = false;
  const writer = (async () => {
    for (let i = 0; i < 50; i++) {
      job.progress.done = i;
      await saveJob(directory, job);
    }
    done = true;
  })();
  while (!done) {
    const snapshot = await readJob(directory);
    assert.ok(Number.isInteger(snapshot.progress.done));
    assert.equal(snapshot.status, "running");
  }
  await writer;
  assert.equal((await readJob(directory)).progress.done, 49);
});

test("rejects malformed job records", async (t) => {
  const { directory } = await fixture(t);
  await writeFile(
    join(directory, "dream.json"),
    JSON.stringify({ type: "other", status: "running" }),
  );
  await assert.rejects(readJob(directory), /Invalid dream/);
});
