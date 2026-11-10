import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
test("pi loads the extension and verifies prompt stability, gates, commands and lifecycle rules", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dream-extension-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helper = join(dirname(fileURLToPath(import.meta.url)), "extension-check.ts");
  const running = exec("/opt/homebrew/bin/pi", ["-p", "--no-session", "-ne", "-ns", "-nc", "-np", "--no-mcp", "-na", "-e", helper], {
    cwd: root, timeout: 30_000, env: { ...process.env, PI_CODING_AGENT_DIR: root, PI_OFFLINE: "1", PI_CODING_AGENT_SESSION_DIR: "" },
  });
  running.child.stdin?.end();
  const result = await running;
  assert.match(result.stdout + result.stderr, /EXTENSION_CHECKS_PASSED/);
  assert.doesNotMatch(result.stderr, /Failed to load extension|AssertionError/);
});

test("the real extension starts a headless worker and honours a pending cancel file", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dream-headless-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createJob, jobDirectory, readJob } = await import("../jobs.ts");
  const { writeFile } = await import("node:fs/promises");
  const job = await createJob(join(root, "dreams"), { storeKey: "test", storePath: join(root, "memory"), repoRoot: root, sessionFiles: [join(root, "unused.jsonl")] });
  const directory = jobDirectory(join(root, "dreams"), job.id);
  await writeFile(join(directory, "cancel"), "");
  const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
  const running = exec("/opt/homebrew/bin/pi", ["-p", "--no-session", "-ne", "-ns", "-nc", "-np", "--no-mcp", "-na", "-e", entry, `--dream-run=${job.id}`], {
    cwd: root, timeout: 15_000, env: { ...process.env, PI_CODING_AGENT_DIR: root, PI_OFFLINE: "1" },
  });
  running.child.stdin?.end();
  await running;
  const result = await readJob(directory);
  assert.equal(result.status, "canceled");
  assert.equal(result.usage.cost_usd, 0);
});
