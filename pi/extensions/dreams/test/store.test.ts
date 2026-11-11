import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  adoptStore,
  cloneStore,
  diffStores,
  discardStore,
  editedSince,
  removeMovedStubs,
  resolveStore,
  storeStats,
} from "../store.ts";
import type { Exec } from "../store.ts";

const exec = promisify(execFile);

function setEnv(t: TestContext, key: string, value: string | undefined): void {
  const previous = process.env[key];
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(
    join(await fs.realpath(tmpdir()), "dream-store-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = join(root, "store");
  const output = join(root, "output");
  async function put(path: string, content = "memory"): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await fs.writeFile(path, content, { mode: 0o600 });
  }
  return { root, store, output, put };
}

async function mode(path: string): Promise<number> {
  return (await fs.stat(path)).mode & 0o777;
}

test("non-git stores use the real cwd and pi's path key without creating directories", async (t) => {
  const { root } = await fixture(t);
  const cwd = join(root, "plain folder");
  await fs.mkdir(cwd);
  const alias = join(root, "alias");
  await fs.symlink(cwd, alias);
  const result = await resolveStore(alias, join(root, "memory"));
  const key = `--${cwd.slice(1).replace(/[/\\:]/g, "-")}--`;
  assert.deepEqual(result, { root: cwd, key, path: join(root, "memory", key) });
  await assert.rejects(fs.lstat(result.path), { code: "ENOENT" });
  setEnv(t, "PI_CODING_AGENT_DIR", undefined);
  const defaultStore = await resolveStore(cwd);
  assert.equal(defaultStore.key, key);
  assert.equal(defaultStore.root, cwd);
  assert.ok(defaultStore.path.endsWith(join(".pi", "agent", "memory", key)));
});

test("a main checkout, subdirectory and linked worktree share the main checkout store", async (t) => {
  const { root } = await fixture(t);
  const main = join(root, "repo with spaces");
  const worktree = join(root, "linked checkout");
  await exec("git", ["init", "-q", main]);
  await exec("git", [
    "-C",
    main,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "Initial",
    "--allow-empty",
  ]);
  await exec("git", ["-C", main, "worktree", "add", "-qb", "linked", worktree]);
  await fs.mkdir(join(main, "nested"));
  const memory = join(root, "memory");
  const expected = await resolveStore(main, memory);
  assert.equal(expected.root, main);
  assert.deepEqual(await resolveStore(join(main, "nested"), memory), expected);
  assert.deepEqual(await resolveStore(worktree, memory), expected);
});

test("an unresolvable separate git directory fails rather than selecting its metadata folder", async (t) => {
  const { root } = await fixture(t);
  const cwd = join(root, "checkout");
  await exec("git", [
    "init",
    "-q",
    "--separate-git-dir",
    join(root, "metadata"),
    cwd,
  ]);
  await assert.rejects(
    resolveStore(cwd, join(root, "memory")),
    /Cannot resolve the main checkout/,
  );
});

test("resolveStore refuses missing cwd, file cwd, invalid roots and symlinked memory roots", async (t) => {
  const { root, put } = await fixture(t);
  await assert.rejects(resolveStore(join(root, "missing"), root), {
    code: "ENOENT",
  });
  await put(join(root, "file"));
  await assert.rejects(
    resolveStore(join(root, "file"), root),
    /Not a directory/,
  );
  await assert.rejects(resolveStore(root, ""), /non-empty/);
  await assert.rejects(
    resolveStore(root, join(root, "file")),
    /Not a directory/,
  );
  await fs.symlink(root, join(root, "alias"));
  await assert.rejects(
    resolveStore(root, join(root, "alias", "new")),
    /Symlink/,
  );
  const resolved = await resolveStore(root, join(root, "memory"));
  await fs.mkdir(dirname(resolved.path));
  await fs.symlink(root, resolved.path);
  await assert.rejects(resolveStore(root, join(root, "memory")), /Symlink/);
});

test("git execution failures are not silently treated as non-git folders", async (t) => {
  const { root } = await fixture(t);
  setEnv(t, "PATH", root);
  await assert.rejects(resolveStore(root, join(root, "memory")), {
    code: "ENOENT",
  });
});

test("resolveStore honours the agent directory override, including tilde expansion", async (t) => {
  const { root } = await fixture(t);
  setEnv(t, "HOME", root);
  setEnv(t, "PI_CODING_AGENT_DIR", "~/personal-agent");
  const result = await resolveStore(root);
  assert.equal(result.path, join(root, "personal-agent", "memory", result.key));
});

test("resolveStore uses an injected plain runner for both git commands", async (t) => {
  const { root } = await fixture(t);
  const main = join(root, "main checkout");
  const common = join(main, ".git");
  const worktree = join(root, "linked checkout");
  await fs.mkdir(common, { recursive: true });
  await fs.mkdir(worktree);
  const calls: {
    command: string;
    args: string[];
    options: { cwd?: string; timeout?: number };
  }[] = [];
  const runner: Exec = async (command, args, options) => {
    calls.push({ command, args, options });
    return {
      code: 0,
      stderr: "",
      stdout:
        calls.length === 1 ? `${common}\n` : `worktree ${main}\0HEAD abc\0\0`,
    };
  };
  const result = await resolveStore(worktree, join(root, "memory"), runner);
  assert.equal(result.root, main);
  assert.deepEqual(calls, [
    {
      command: "git",
      args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      options: { cwd: worktree, timeout: 10_000 },
    },
    {
      command: "git",
      args: ["--git-dir", common, "worktree", "list", "--porcelain", "-z"],
      options: { cwd: worktree, timeout: 10_000 },
    },
  ]);
});

test("resolveStore handles runner exit codes and rejects malformed git output", async (t) => {
  const { root } = await fixture(t);
  const memory = join(root, "memory");
  const notGit: Exec = async () => ({
    code: 128,
    stdout: "",
    stderr: "fatal: not a git repository",
  });
  assert.equal((await resolveStore(root, memory, notGit)).root, root);
  for (const result of [
    { code: 128, stdout: "", stderr: "fatal: unsafe repository" },
    { code: 2, stdout: "", stderr: "bad argument" },
    { code: 0, stdout: "relative\n", stderr: "" },
  ])
    await assert.rejects(
      resolveStore(root, memory, async () => result),
      /Git/,
    );
  for (const result of [
    { code: 2, stdout: "", stderr: "failed" },
    { code: 0, stdout: "invalid", stderr: "" },
  ]) {
    let calls = 0;
    await assert.rejects(
      resolveStore(root, memory, async () =>
        ++calls === 1 ? { code: 0, stdout: `${root}\n`, stderr: "" } : result,
      ),
      /Git/,
    );
  }
});

test("missing stores count as empty and nested stores count bytes, not characters", async (t) => {
  const { store, put } = await fixture(t);
  assert.deepEqual(await storeStats(store), { files: 0, bytes: 0 });
  await put(join(store, "MEMORY.md"), "hello");
  await put(join(store, "nested", "topic.md"), "café");
  await fs.mkdir(join(store, "empty"));
  assert.deepEqual(await storeStats(store), { files: 2, bytes: 10 });
});

test("storeStats allows exactly 2000 files and rejects one more", async (t) => {
  const { store, put } = await fixture(t);
  for (let start = 0; start < 2_000; start += 50) {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        put(join(store, `${start + i}.md`), ""),
      ),
    );
  }
  assert.deepEqual(await storeStats(store), { files: 2_000, bytes: 0 });
  await put(join(store, "extra.md"), "");
  await assert.rejects(storeStats(store), /input_memory_store_too_large/);
});

test("storeStats allows exactly 10 MiB and rejects one byte more", async (t) => {
  const { store, put } = await fixture(t);
  const path = join(store, "large.md");
  await put(path, "");
  await fs.truncate(path, 10 * 1024 * 1024);
  assert.deepEqual(await storeStats(store), {
    files: 1,
    bytes: 10 * 1024 * 1024,
  });
  await fs.truncate(path, 10 * 1024 * 1024 + 1);
  await assert.rejects(storeStats(store), /input_memory_store_too_large/);
});

test("store operations reject symlink roots, ancestors, nested links and broken links", async (t) => {
  const { root, store, output, put } = await fixture(t);
  await put(join(store, "nested", "topic.md"));
  const alias = join(root, "alias");
  await fs.symlink(store, alias);
  await assert.rejects(storeStats(alias), /Symlink/);
  await assert.rejects(storeStats(join(alias, "nested")), /Symlink/);
  await assert.rejects(cloneStore(alias, output), /Symlink/);
  await fs.symlink(join(root, "absent"), join(store, "nested", "broken"));
  await assert.rejects(storeStats(store), /Symlink/);
  await assert.rejects(cloneStore(store, output), /Symlink/);
  await assert.rejects(discardStore(store), /Symlink/);
  await assert.rejects(removeMovedStubs(store), /Symlink/);
  await assert.rejects(editedSince(store, new Date().toISOString()), /Symlink/);
});

test("storeStats rejects regular file roots, invalid paths and hard links", async (t) => {
  const { root, store, put } = await fixture(t);
  await put(join(root, "file"));
  await assert.rejects(storeStats(join(root, "file")), /Not a store directory/);
  await assert.rejects(
    storeStats(join(root, "file", "child")),
    /Not a directory/,
  );
  await assert.rejects(storeStats("\0"), /non-empty/);
  await assert.rejects(storeStats(""), /non-empty/);
  await fs.mkdir(store);
  await fs.link(join(root, "file"), join(store, "link.md"));
  await assert.rejects(storeStats(store), /hard links/);
});

test("storeStats rejects non-regular socket entries without opening them", async (t) => {
  const { store } = await fixture(t);
  await fs.mkdir(store);
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(join(store, "socket"), resolve);
  });
  try {
    await assert.rejects(storeStats(store), /non-regular/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("cloneStore copies nested and empty directories, timestamps and private modes", async (t) => {
  const { store, output, put } = await fixture(t);
  await put(join(store, "MEMORY.md"), "index");
  await put(join(store, "nested", "topic.md"), "topic");
  await fs.mkdir(join(store, "nested", "empty"));
  const old = new Date("2020-01-01T00:00:00Z");
  await fs.utimes(join(store, "nested", "topic.md"), old, old);
  await fs.chmod(join(store, "MEMORY.md"), 0o644);
  await cloneStore(store, output);
  assert.deepEqual(await storeStats(output), { files: 2, bytes: 10 });
  assert.equal(
    await fs.readFile(join(output, "nested", "topic.md"), "utf8"),
    "topic",
  );
  for (const path of [
    output,
    join(output, "nested"),
    join(output, "nested", "empty"),
  ]) {
    assert.equal(await mode(path), 0o700);
  }
  assert.equal(await mode(join(output, "MEMORY.md")), 0o600);
  assert.equal(await mode(join(output, "nested", "topic.md")), 0o600);
  assert.equal(
    (await fs.stat(join(output, "nested", "topic.md"))).mtimeMs,
    old.getTime(),
  );
  await fs.writeFile(join(output, "MEMORY.md"), "changed");
  assert.equal(await fs.readFile(join(store, "MEMORY.md"), "utf8"), "index");
});

test("cloning a missing store creates a private empty output and private new parents", async (t) => {
  const { store, root } = await fixture(t);
  const output = join(root, "new", "parent", "output");
  await cloneStore(store, output);
  assert.deepEqual(await storeStats(output), { files: 0, bytes: 0 });
  for (const path of [join(root, "new"), dirname(output), output])
    assert.equal(await mode(path), 0o700);
});

test("cloneStore refuses existing outputs, symlink destinations and overlapping paths", async (t) => {
  const { root, store, output, put } = await fixture(t);
  await put(join(store, "file.md"), "original");
  await put(join(output, "keep.md"), "keep");
  await assert.rejects(cloneStore(store, output), { code: "EEXIST" });
  assert.equal(await fs.readFile(join(output, "keep.md"), "utf8"), "keep");
  await assert.rejects(cloneStore(store, store), /overlap/);
  await assert.rejects(cloneStore(store, join(store, "child")), /overlap/);
  await assert.rejects(cloneStore(store, root), /overlap/);
  await fs.symlink(output, join(root, "alias"));
  await assert.rejects(
    cloneStore(store, join(root, "alias", "child")),
    /Symlink/,
  );
});

test("a failed clone removes only its own incomplete output", async (t) => {
  const { store, output, put } = await fixture(t);
  await put(join(store, "file.md"));
  t.mock.method(fs, "writeFile", async () => {
    throw new Error("Disk full");
  });
  await assert.rejects(cloneStore(store, output), /Disk full/);
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  assert.equal(await fs.readFile(join(store, "file.md"), "utf8"), "memory");
});

test("a clone reports both the copy and cleanup errors", async (t) => {
  const { store, output, put } = await fixture(t);
  await put(join(store, "file.md"));
  t.mock.method(fs, "writeFile", async () => {
    throw new Error("Disk full");
  });
  const remove = t.mock.method(fs, "rm", async () => {
    throw new Error("Cleanup failed");
  });
  await assert.rejects(cloneStore(store, output), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    return true;
  });
  remove.mock.restore();
});

test("a changed source is rejected and the incomplete clone is removed", async (t) => {
  const { store, output, put } = await fixture(t);
  const file = join(store, "file.md");
  await put(file);
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    await fs.writeFile(file, "changed length");
    return open(...args);
  });
  await assert.rejects(cloneStore(store, output), /changed while cloning/);
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
});

test("editedSince returns sorted relative files strictly after the clone timestamp", async (t) => {
  const { store, put } = await fixture(t);
  const clonedAt = "2026-11-06T10:00:00.000Z";
  for (const [name, offset] of [
    ["before.md", -1],
    ["equal.md", 0],
    ["z.md", 1],
    ["nested/a.md", 2],
  ] as const) {
    const path = join(store, name);
    await put(path);
    const date = new Date(Date.parse(clonedAt) + offset * 1_000);
    await fs.utimes(path, date, date);
  }
  assert.deepEqual(await editedSince(store, clonedAt), ["nested/a.md", "z.md"]);
  assert.deepEqual(await editedSince(join(store, "absent"), clonedAt), []);
  await assert.rejects(editedSince(store, "not a date"), /timestamp/);
});

test("adoptStore returns a private backup and replaces the store by rename", async (t) => {
  const { store, output, put } = await fixture(t);
  await put(join(store, "old.md"), "old");
  await put(join(output, "nested", "new.md"), "new");
  await fs.chmod(store, 0o755);
  await fs.chmod(join(store, "old.md"), 0o644);
  await fs.chmod(output, 0o755);
  await fs.chmod(join(output, "nested", "new.md"), 0o644);
  const inode = (await fs.stat(output)).ino;
  const backup = await adoptStore(store, output);
  assert.ok(backup?.startsWith(`${store}.bak-`));
  assert.equal(await fs.readFile(join(backup, "old.md"), "utf8"), "old");
  assert.equal(
    await fs.readFile(join(store, "nested", "new.md"), "utf8"),
    "new",
  );
  assert.equal((await fs.stat(store)).ino, inode);
  for (const path of [backup, store, join(store, "nested")])
    assert.equal(await mode(path), 0o700);
  assert.equal(await mode(join(backup, "old.md")), 0o600);
  assert.equal(await mode(join(store, "nested", "new.md")), 0o600);
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
});

test("adopting a first store returns no backup and creates private parents", async (t) => {
  const { root, output, put } = await fixture(t);
  const store = join(root, "new", "store");
  await put(join(output, "new.md"), "new");
  assert.equal(await adoptStore(store, output), undefined);
  assert.equal(await mode(dirname(store)), 0o700);
  assert.equal(await fs.readFile(join(store, "new.md"), "utf8"), "new");
});

test("adoption rolls the old store back when the output rename fails", async (t) => {
  const { store, output, root, put } = await fixture(t);
  await put(join(store, "old.md"), "old");
  await put(join(output, "new.md"), "new");
  const rename = fs.rename.bind(fs);
  const calls: string[][] = [];
  t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
    calls.push(args.map(String));
    if (args[0] === output) throw new Error("Output rename failed");
    return rename(...args);
  });
  await assert.rejects(adoptStore(store, output), /Output rename failed/);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2], [calls[0][1], store]);
  assert.equal(await fs.readFile(join(store, "old.md"), "utf8"), "old");
  assert.equal(await fs.readFile(join(output, "new.md"), "utf8"), "new");
  assert.deepEqual((await fs.readdir(root)).sort(), ["output", "store"]);
});

test("adoption keeps the backup and reports both failures when rollback fails", async (t) => {
  const { store, output, root, put } = await fixture(t);
  await put(join(store, "old.md"), "old");
  await put(join(output, "new.md"), "new");
  const rename = fs.rename.bind(fs);
  t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
    if (args[0] === store) return rename(...args);
    throw new Error("Rename failed");
  });
  await assert.rejects(adoptStore(store, output), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(error.message, /restore the store from/);
    return true;
  });
  const backup = (await fs.readdir(root)).find((name) =>
    name.startsWith("store.bak-"),
  );
  assert.ok(backup);
  assert.equal(await fs.readFile(join(root, backup, "old.md"), "utf8"), "old");
  assert.equal(await fs.readFile(join(output, "new.md"), "utf8"), "new");
});

test("a failed initial backup rename leaves both stores in place", async (t) => {
  const { store, output, put } = await fixture(t);
  await put(join(store, "old.md"), "old");
  await put(join(output, "new.md"), "new");
  const rename = t.mock.method(fs, "rename", async () => {
    throw new Error("Backup failed");
  });
  await assert.rejects(adoptStore(store, output), /Backup failed/);
  assert.equal(rename.mock.callCount(), 1);
  assert.equal(await fs.readFile(join(store, "old.md"), "utf8"), "old");
  assert.equal(await fs.readFile(join(output, "new.md"), "utf8"), "new");
});

test("a failed first adoption does not invent a backup or delete the output", async (t) => {
  const { store, output, put } = await fixture(t);
  await put(join(output, "new.md"), "new");
  t.mock.method(fs, "rename", async () => {
    throw new Error("Rename failed");
  });
  await assert.rejects(adoptStore(store, output), /Rename failed/);
  await assert.rejects(fs.lstat(store), { code: "ENOENT" });
  assert.equal(await fs.readFile(join(output, "new.md"), "utf8"), "new");
});

test("adoption validates both stores and rejects missing, linked and overlapping outputs", async (t) => {
  const { root, store, output, put } = await fixture(t);
  await put(join(store, "old.md"));
  await assert.rejects(adoptStore(store, output), /does not exist/);
  await assert.rejects(adoptStore(store, store), /overlap/);
  await fs.mkdir(join(store, "child"));
  await assert.rejects(adoptStore(store, join(store, "child")), /overlap/);
  await assert.rejects(adoptStore(join(store, "child"), store), /overlap/);
  await fs.symlink(store, output);
  await assert.rejects(adoptStore(store, output), /Symlink/);
  await fs.unlink(output);
  await put(join(output, "new.md"));
  await fs.symlink(root, join(store, "escape"));
  await assert.rejects(adoptStore(store, output), /Symlink/);
  await fs.unlink(join(store, "escape"));
  await fs.symlink(root, join(output, "escape"));
  await assert.rejects(adoptStore(store, output), /Symlink/);
});

test("discardStore removes only its output, tolerates absence and permits oversized failed outputs", async (t) => {
  const { store, output, put } = await fixture(t);
  await put(join(store, "keep.md"), "keep");
  await put(join(output, "large.md"), "");
  await fs.truncate(join(output, "large.md"), 10 * 1024 * 1024 + 1);
  await discardStore(output);
  await discardStore(output);
  assert.equal(await fs.readFile(join(store, "keep.md"), "utf8"), "keep");
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
});

test("discardStore rejects a symlink instead of deleting it or its target", async (t) => {
  const { store, output, put } = await fixture(t);
  await put(join(store, "keep.md"), "keep");
  await fs.symlink(store, output);
  await assert.rejects(discardStore(output), /Symlink/);
  assert.ok((await fs.lstat(output)).isSymbolicLink());
  assert.equal(await fs.readFile(join(store, "keep.md"), "utf8"), "keep");
});

test("removeMovedStubs removes only exact Markdown markers pointing to store-relative live files", async (t) => {
  const { output, put } = await fixture(t);
  const live = "---\nname: live\n---\nRetained facts.\n";
  await put(join(output, "topics", "live.md"), live);
  for (const [name, text] of Object.entries({
    "retired.md": "MOVED TO [[topics/live.md]]\n",
    "nested/retired.md": "MOVED TO [[topics/live.md]]",
    "retired-crlf.md": "MOVED TO [[topics/live.md]]\r\n",
  }))
    await put(join(output, name), text);
  const keep = {
    "MEMORY.md": "MOVED TO [[missing.md]]\n",
    "nested/MEMORY.md": "MOVED TO [[missing.md]]",
    "retired.txt": "MOVED TO [[missing.md]]\n",
    "old-style.md": "MOVED TO topics/live.md\n",
    "colon.md": "MOVED TO: [[topics/live.md]]\n",
    "prose.md": "A note about MOVED TO [[topics/live.md]]",
    "extra-body.md": "MOVED TO [[topics/live.md]]\nRetained facts",
    "extra-line.md": "MOVED TO [[topics/live.md]]\n\n",
    "leading-space.md": " MOVED TO [[topics/live.md]]\n",
    "trailing-space.md": "MOVED TO [[topics/live.md]] \n",
    "lower.md": "moved to [[topics/live.md]]",
    "bom.md": "\uFEFFMOVED TO [[topics/live.md]]\n",
  };
  for (const [name, text] of Object.entries(keep))
    await put(join(output, name), text);
  await removeMovedStubs(output);
  for (const name of ["retired.md", "nested/retired.md", "retired-crlf.md"]) {
    await assert.rejects(fs.lstat(join(output, name)), { code: "ENOENT" });
  }
  for (const [name, text] of Object.entries(keep)) {
    assert.equal(await fs.readFile(join(output, name), "utf8"), text, name);
  }
  assert.equal(
    await fs.readFile(join(output, "topics", "live.md"), "utf8"),
    live,
  );
  await removeMovedStubs(join(output, "absent"));
});

for (const kind of [
  "missing",
  "escaping",
  "absolute",
  "url",
  "directory",
  "non-markdown",
  "self",
  "cycle",
  "chain",
]) {
  test(`removeMovedStubs rejects ${kind} targets without deleting the source`, async (t) => {
    const { root, output, put } = await fixture(t);
    await put(join(root, "outside.md"), "Outside content");
    await put(join(output, "live.md"), "Retained facts");
    await put(join(output, "plain.txt"), "Retained facts");
    await fs.mkdir(join(output, "directory.md"));
    const target = {
      missing: "missing.md",
      escaping: "../outside.md",
      absolute: join(output, "live.md"),
      url: pathToFileURL(join(output, "live.md")).href,
      directory: "directory.md",
      "non-markdown": "plain.txt",
      self: "retired.md",
      cycle: "other.md",
      chain: "other.md",
    }[kind]!;
    const source = `MOVED TO [[${target}]]\n`;
    await put(join(output, "retired.md"), source);
    if (kind === "cycle" || kind === "chain") {
      await put(
        join(output, "other.md"),
        `MOVED TO [[${kind === "cycle" ? "retired.md" : "live.md"}]]\n`,
      );
    }
    await assert.rejects(removeMovedStubs(output), /MOVED TO/);
    assert.equal(await fs.readFile(join(output, "retired.md"), "utf8"), source);
    assert.equal(
      await fs.readFile(join(output, "live.md"), "utf8"),
      "Retained facts",
    );
    assert.equal(
      await fs.readFile(join(root, "outside.md"), "utf8"),
      "Outside content",
    );
    if (kind === "cycle" || kind === "chain")
      assert.ok((await fs.stat(join(output, "other.md"))).isFile());
  });
}

test("removeMovedStubs validates every target before deleting any source", async (t) => {
  const { output, put } = await fixture(t);
  const valid = "MOVED TO [[live.md]]\n";
  const invalid = "MOVED TO [[missing.md]]\n";
  await put(join(output, "live.md"), "Retained facts");
  await put(join(output, "a-retired.md"), valid);
  await put(join(output, "z-retired.md"), invalid);
  await assert.rejects(removeMovedStubs(output), /MOVED TO/);
  assert.equal(await fs.readFile(join(output, "a-retired.md"), "utf8"), valid);
  assert.equal(
    await fs.readFile(join(output, "z-retired.md"), "utf8"),
    invalid,
  );
});

test("removeMovedStubs refuses symlink targets without deleting the stub or destination", async (t) => {
  const { root, output, put } = await fixture(t);
  const source = "MOVED TO [[alias.md]]\n";
  await put(join(root, "outside.md"), "Outside content");
  await put(join(output, "retired.md"), source);
  await fs.symlink(join(root, "outside.md"), join(output, "alias.md"));
  await assert.rejects(removeMovedStubs(output), /Symlink/);
  assert.equal(await fs.readFile(join(output, "retired.md"), "utf8"), source);
  assert.equal(
    await fs.readFile(join(root, "outside.md"), "utf8"),
    "Outside content",
  );
});

test("diffStores returns a stat for changes and an empty string for identical stores", async (t) => {
  const { store, output, put } = await fixture(t);
  await put(join(store, "topic.md"), "old\n");
  await cloneStore(store, output);
  assert.equal(await diffStores(store, output), "");
  await fs.writeFile(join(output, "topic.md"), "new\n");
  const diff = await diffStores(store, output);
  assert.match(diff, /topic\.md/);
  assert.match(diff, /1 file changed/);
});

test("diffStores treats a missing input as empty and removes its temporary directory", async (t) => {
  const { store, output, put } = await fixture(t);
  await put(join(output, "new.md"), "new\n");
  let temporary = "";
  const mkdtemp = fs.mkdtemp.bind(fs);
  t.mock.method(fs, "mkdtemp", async (prefix: string) => {
    temporary = await mkdtemp(prefix);
    assert.equal(await mode(temporary), 0o700);
    return temporary;
  });
  assert.match(await diffStores(store, output), /new\.md/);
  assert.ok(temporary);
  await assert.rejects(fs.lstat(temporary), { code: "ENOENT" });
});

test("diffStores cleans up after a git failure and does not mistake errors for a diff", async (t) => {
  const { store, output, put, root } = await fixture(t);
  await put(join(output, "new.md"));
  const mkdtemp = fs.mkdtemp.bind(fs);
  let temporary = "";
  t.mock.method(
    fs,
    "mkdtemp",
    async (prefix: string) => (temporary = await mkdtemp(prefix)),
  );
  setEnv(t, "PATH", root);
  await assert.rejects(diffStores(store, output), { code: "ENOENT" });
  await assert.rejects(fs.lstat(temporary), { code: "ENOENT" });
});

test("diffStores accepts a plain runner and handles its difference and failure exit codes", async (t) => {
  const { store, output, put } = await fixture(t);
  await put(join(store, "old.md"));
  await put(join(output, "new.md"));
  const runner: Exec = async (command, args, options) => {
    assert.equal(command, "git");
    assert.deepEqual(args.slice(-3), ["--", store, output]);
    assert.ok(args.includes("--no-index"));
    assert.ok(args.includes("--stat"));
    assert.deepEqual(options, { timeout: 10_000 });
    return { code: 1, stdout: "1 file changed\n", stderr: "" };
  };
  assert.equal(await diffStores(store, output, runner), "1 file changed\n");
  assert.equal(
    await diffStores(store, output, async () => ({
      code: 0,
      stdout: "",
      stderr: "",
    })),
    "",
  );
  await assert.rejects(
    diffStores(store, output, async () => ({
      code: 129,
      stdout: "",
      stderr: "bad argument",
    })),
    /Git diff failed \(129\): bad argument/,
  );
});

test("an injected runner failure still removes the temporary empty input", async (t) => {
  const { store, output, put } = await fixture(t);
  await put(join(output, "new.md"));
  let empty = "";
  await assert.rejects(
    diffStores(store, output, async (_command, args) => {
      empty = args.at(-2)!;
      assert.deepEqual(await fs.readdir(empty), []);
      throw new Error("Runner timed out");
    }),
    /Runner timed out/,
  );
  assert.ok(empty);
  await assert.rejects(fs.lstat(empty), { code: "ENOENT" });
});

test("discardStore rejects the filesystem root before inspecting its contents", async (t) => {
  const read = t.mock.method(fs, "readdir", async () => {
    throw new Error("Must not scan");
  });
  await assert.rejects(discardStore("/"), /filesystem root/);
  assert.equal(read.mock.callCount(), 0);
});

test("diffStores passes shell metacharacters as paths and rejects missing or linked output", async (t) => {
  const { root, store, put } = await fixture(t);
  const output = join(root, "output; touch SENTINEL; $(false)");
  await put(join(output, "new.md"));
  assert.match(await diffStores(store, output), /new\.md/);
  await assert.rejects(fs.lstat(join(root, "SENTINEL")), { code: "ENOENT" });
  await assert.rejects(
    diffStores(store, join(root, "missing")),
    /does not exist/,
  );
  await fs.symlink(output, join(root, "alias"));
  await assert.rejects(diffStores(store, join(root, "alias")), /Symlink/);
});
