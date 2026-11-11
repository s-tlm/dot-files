import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";

export type Exec = (
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>;

const execFileAsync = promisify(execFile);
const nodeExec: Exec = async (command, args, options) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      ...options,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "number" &&
      "stdout" in error &&
      typeof error.stdout === "string" &&
      "stderr" in error &&
      typeof error.stderr === "string" &&
      !("killed" in error && error.killed) &&
      !("signal" in error && error.signal)
    ) {
      return { stdout: error.stdout, stderr: error.stderr, code: error.code };
    }
    throw error;
  }
};
const maxFiles = 2_000;
const maxBytes = 10 * 1024 * 1024;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function statIfPresent(path: string): Promise<Stats | undefined> {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function safePath(path: string): Promise<string> {
  if (typeof path !== "string" || !path.trim() || path.includes("\0")) {
    throw new Error("A non-empty filesystem path is required");
  }
  const absolute = resolve(path);
  const parts: string[] = [];
  for (
    let current = absolute;
    dirname(current) !== current;
    current = dirname(current)
  ) {
    parts.push(current);
  }
  for (const current of parts.reverse()) {
    const stat = await statIfPresent(current);
    if (!stat) break;
    if (stat.isSymbolicLink())
      throw new Error(`Symlinks are not allowed: ${current}`);
    if (current !== absolute && !stat.isDirectory()) {
      throw new Error(`Not a directory: ${current}`);
    }
  }
  return absolute;
}

function contains(root: string, path: string): boolean {
  const tail = relative(root, path);
  return (
    tail === "" ||
    (tail !== ".." && !tail.startsWith(`..${sep}`) && !isAbsolute(tail))
  );
}

function disjoint(input: string, output: string): void {
  if (contains(input, output) || contains(output, input)) {
    throw new Error("Store paths must not overlap");
  }
}

async function scanStore(path: string, limits = true) {
  path = await safePath(path);
  const stat = await statIfPresent(path);
  const dirs: string[] = [];
  const files: { path: string; stat: Stats }[] = [];
  let bytes = 0;
  if (stat) {
    if (!stat.isDirectory()) throw new Error(`Not a store directory: ${path}`);
    const pending = [path];
    while (pending.length) {
      const dir = pending.pop()!;
      dirs.push(dir);
      for (const name of await fs.readdir(dir)) {
        const entry = join(dir, name);
        const info = await fs.lstat(entry);
        if (info.isDirectory()) {
          pending.push(entry);
        } else if (info.isFile() && info.nlink === 1) {
          files.push({ path: entry, stat: info });
          bytes += info.size;
          if (limits && (files.length > maxFiles || bytes > maxBytes)) {
            throw new Error(
              "input_memory_store_too_large: exceeds 2000 files or 10 MiB",
            );
          }
        } else {
          throw new Error(
            `Symlinks, hard links and non-regular files are not allowed: ${entry}`,
          );
        }
      }
    }
  }
  return { path, exists: stat !== undefined, dirs, files, bytes };
}

async function makePrivate(
  store: Awaited<ReturnType<typeof scanStore>>,
): Promise<void> {
  for (const dir of store.dirs) await fs.chmod(dir, 0o700);
  for (const file of store.files) await fs.chmod(file.path, 0o600);
}

export async function resolveStore(
  cwd: string,
  memoryRoot?: string,
  exec: Exec = nodeExec,
): Promise<{ key: string; path: string; root: string }> {
  if (memoryRoot === undefined) {
    let agentDir =
      process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
    if (agentDir === "~") agentDir = homedir();
    else if (agentDir.startsWith("~/"))
      agentDir = join(homedir(), agentDir.slice(2));
    memoryRoot = join(agentDir, "memory");
  }
  let root = await fs.realpath(cwd);
  if (!(await fs.stat(root)).isDirectory())
    throw new Error(`Not a directory: ${cwd}`);
  const options = { cwd: root, timeout: 10_000 };
  const commonResult = await exec(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    options,
  );
  if (commonResult.code === 0) {
    const common = commonResult.stdout.replace(/\r?\n$/, "");
    if (!isAbsolute(common))
      throw new Error("Git did not report an absolute common directory");
    const result = await exec(
      "git",
      ["--git-dir", common, "worktree", "list", "--porcelain", "-z"],
      options,
    );
    if (result.code !== 0)
      throw new Error(
        `Git worktree lookup failed (${result.code}): ${result.stderr}`,
      );
    const first = result.stdout.split("\0")[0];
    if (!first?.startsWith("worktree "))
      throw new Error("Git did not report the main checkout");
    root = await fs.realpath(first.slice("worktree ".length));
    // shortcut: Git cannot identify a separate directory's main checkout; add a mapping if you need that layout.
    if (root === (await fs.realpath(common)))
      throw new Error("Cannot resolve the main checkout from this git layout");
  } else if (
    commonResult.code !== 128 ||
    !/not a git repository/i.test(commonResult.stderr)
  ) {
    throw new Error(
      `Git store lookup failed (${commonResult.code}): ${commonResult.stderr}`,
    );
  }
  const key = `--${root.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const base = await safePath(memoryRoot);
  const baseStat = await statIfPresent(base);
  if (baseStat && !baseStat.isDirectory())
    throw new Error(`Not a directory: ${base}`);
  const path = await safePath(join(base, key));
  return { key, path, root };
}

export async function storeStats(
  path: string,
): Promise<{ files: number; bytes: number }> {
  const store = await scanStore(path);
  return { files: store.files.length, bytes: store.bytes };
}

export async function cloneStore(input: string, output: string): Promise<void> {
  const store = await scanStore(input);
  output = await safePath(output);
  disjoint(store.path, output);
  await fs.mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await fs.mkdir(output, { mode: 0o700 });
  try {
    for (const dir of store.dirs.slice(1)) {
      await fs.mkdir(join(output, relative(store.path, dir)), {
        recursive: true,
        mode: 0o700,
      });
    }
    for (const file of store.files) {
      const source = await fs.open(
        file.path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await source.stat();
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          info.ino !== file.stat.ino ||
          info.size !== file.stat.size
        ) {
          throw new Error(`Store changed while cloning: ${file.path}`);
        }
        const target = join(output, relative(store.path, file.path));
        await fs.writeFile(target, await source.readFile(), {
          flag: "wx",
          mode: 0o600,
        });
        await fs.utimes(target, file.stat.atime, file.stat.mtime);
      } finally {
        await source.close();
      }
    }
    await storeStats(output);
  } catch (error) {
    try {
      await fs.rm(output, { recursive: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Clone failed; could not remove ${output}`,
      );
    }
    throw error;
  }
}

// shortcut: timestamps cannot report deletions; compare snapshots if deletion warnings become necessary.
export async function editedSince(
  store: string,
  clonedAt: string,
): Promise<string[]> {
  const time = Date.parse(clonedAt);
  if (!Number.isFinite(time)) throw new Error("Invalid clone timestamp");
  const snapshot = await scanStore(store);
  return snapshot.files
    .filter((file) => file.stat.mtimeMs > time)
    .map((file) => relative(snapshot.path, file.path))
    .sort();
}

export async function adoptStore(
  store: string,
  output: string,
): Promise<string | undefined> {
  const current = await scanStore(store);
  const next = await scanStore(output);
  disjoint(current.path, next.path);
  if (!next.exists)
    throw new Error(`Output store does not exist: ${next.path}`);
  await makePrivate(next);
  await fs.mkdir(dirname(current.path), { recursive: true, mode: 0o700 });
  let backup: string | undefined;
  if (current.exists) {
    await makePrivate(current);
    backup = `${current.path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
    if (await statIfPresent(backup))
      throw new Error(`Backup already exists: ${backup}`);
    await fs.rename(current.path, backup);
  }
  try {
    await fs.rename(next.path, current.path);
  } catch (error) {
    if (backup) {
      try {
        await fs.rename(backup, current.path);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Adoption failed; restore the store from ${backup}`,
        );
      }
    }
    throw error;
  }
  return backup;
}

export async function discardStore(output: string): Promise<void> {
  output = await safePath(output);
  if (dirname(output) === output)
    throw new Error("Cannot discard the filesystem root");
  const store = await scanStore(output, false);
  if (store.exists) await fs.rm(store.path, { recursive: true });
}

export async function removeMovedStubs(output: string): Promise<void> {
  const store = await scanStore(output);
  const movedTarget = (text: string): string | undefined => {
    const match = /^MOVED TO \[\[([^\[\]\r\n]+)\]\](?:\r?\n)?$/.exec(text);
    return match && match[0] === text ? match[1] : undefined;
  };
  const markdown = new Map<string, string>();
  for (const file of store.files) {
    if (file.path.endsWith(".md"))
      markdown.set(file.path, await fs.readFile(file.path, "utf8"));
  }
  const stubs: string[] = [];
  for (const [path, text] of markdown) {
    if (basename(path).toLowerCase() === "memory.md") continue;
    const target = movedTarget(text);
    if (target === undefined) continue;
    if (
      isAbsolute(target) ||
      /^[a-z][a-z\d+.-]*:/i.test(target) ||
      !target.endsWith(".md")
    ) {
      throw new Error(`Invalid MOVED TO target in ${path}: ${target}`);
    }
    const destination = resolve(store.path, target);
    const content = markdown.get(destination);
    if (
      !contains(store.path, destination) ||
      content === undefined ||
      movedTarget(content) !== undefined
    ) {
      throw new Error(
        `MOVED TO target must be a live file inside the store: ${path} -> ${target}`,
      );
    }
    stubs.push(path);
  }
  // Validate the full set before removing anything, so a bad target leaves every source intact.
  for (const path of stubs) await fs.unlink(path);
}

export async function diffStores(
  input: string,
  output: string,
  exec: Exec = nodeExec,
): Promise<string> {
  const before = await scanStore(input);
  const after = await scanStore(output);
  if (!after.exists)
    throw new Error(`Output store does not exist: ${after.path}`);
  let empty: string | undefined;
  try {
    if (!before.exists)
      empty = await fs.mkdtemp(
        join(await fs.realpath(tmpdir()), "pi-dream-diff-"),
      );
    const result = await exec(
      "git",
      [
        "diff",
        "--no-index",
        "--stat",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--no-renames",
        "--",
        empty ?? before.path,
        after.path,
      ],
      { timeout: 10_000 },
    );
    if (result.code !== 0 && result.code !== 1) {
      throw new Error(`Git diff failed (${result.code}): ${result.stderr}`);
    }
    return result.stdout;
  } finally {
    if (empty) await fs.rm(empty, { recursive: true });
  }
}
