import { promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const fileTools = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const directoryTools = new Set(["grep", "find", "ls"]);

function validPath(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0 && !value.includes("\0");
}

function contains(root: string, path: string): boolean {
    const tail = relative(root, path);
    return tail === "" || (tail !== ".." && !tail.startsWith(`..${sep}`) && !isAbsolute(tail));
}

function expandPath(value: string, toolPath = true): string {
    if (toolPath) {
        value = value.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
        if (value.startsWith("@")) value = value.slice(1);
    }
    if (value === "~") return homedir();
    if (value.startsWith("~/")) return join(homedir(), value.slice(2));
    if (value.startsWith("file://")) return fileURLToPath(value);
    return value;
}

function toolPath(tool: string, input: Record<string, unknown>, cwd: string): string {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid tool input");
    let value = input.path;
    if (directoryTools.has(tool) && (value === undefined || value === "")) value = ".";
    if (!validPath(value) || !validPath(cwd) || !isAbsolute(expandPath(cwd, false))) {
        throw new Error("A valid path and absolute working directory are required");
    }
    const expanded = expandPath(value);
    if (!validPath(expanded)) throw new Error("Invalid tool path");
    return resolve(expandPath(cwd, false), expanded);
}

async function statIfPresent(path: string): Promise<Stats | undefined> {
    try {
        return await fs.lstat(path);
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
        throw error;
    }
}

async function checkedPath(path: string): Promise<{ path: string; stat: Stats | undefined }> {
    if (!validPath(path) || !isAbsolute(path)) throw new Error("Roots must be absolute filesystem paths");
    path = resolve(path);
    const parts: string[] = [];
    for (let current = path; dirname(current) !== current; current = dirname(current)) parts.push(current);
    let nearest = dirname(path) === path ? path : "/";
    let stat: Stats | undefined;
    for (const current of parts.reverse()) {
        stat = await statIfPresent(current);
        if (!stat) return { path: resolve(await fs.realpath(nearest), relative(nearest, path)), stat: undefined };
        if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${current}`);
        if (current !== path && !stat.isDirectory()) throw new Error(`Not a directory: ${current}`);
        nearest = current;
    }
    return { path: await fs.realpath(path), stat: stat ?? await fs.lstat(path) };
}

async function checkedRoot(root: string): Promise<string> {
    const checked = await checkedPath(root);
    if (!checked.stat?.isDirectory()) throw new Error(`Root is not an existing directory: ${root}`);
    return checked.path;
}

async function checkTree(path: string): Promise<void> {
    const pending = [path];
    while (pending.length) {
        const dir = pending.pop()!;
        for (const name of await fs.readdir(dir)) {
            const entry = join(dir, name);
            const stat = await fs.lstat(entry);
            if (stat.isDirectory()) pending.push(entry);
            else if (!stat.isFile() || stat.nlink !== 1) {
                throw new Error(`Unsafe directory entry: ${entry}`);
            }
        }
    }
}

// shortcut: checks cannot prevent concurrent path swaps; use OS isolation for untrusted local writers.
export async function checkAccess(
    toolName: string,
    input: Record<string, unknown>,
    cwd: string,
    readRoots: string[],
    writeRoot: string,
): Promise<string | undefined> {
    if (!fileTools.has(toolName)) return `Tool ${toolName} is not allowed in a dream`;
    try {
        if (!Array.isArray(readRoots) || !readRoots.length) throw new Error("Read roots are missing");
        const readable: string[] = [];
        for (const root of readRoots) readable.push(await checkedRoot(root));
        const writable = await checkedRoot(writeRoot);
        const target = await checkedPath(toolPath(toolName, input, cwd));
        const writing = toolName === "write" || toolName === "edit";
        const roots = writing ? [writable] : readable;
        if (!roots.some((root) => contains(root, target.path))) {
            return `${toolName} path is outside the allowed ${writing ? "write" : "read"} roots`;
        }
        if (target.stat && !target.stat.isDirectory() && (!target.stat.isFile() || target.stat.nlink !== 1)) {
            return "Symlinks, hard links and non-regular files are not allowed";
        }
        if (writing) {
            if (target.stat?.isDirectory()) return "Writes must target regular files";
            if (toolName === "edit" && !target.stat) return "The edit target does not exist";
        } else {
            // Reject missing reads rather than let pi try unchecked macOS filename variants.
            if (!target.stat) return "The read path does not exist";
            if (toolName === "read" && !target.stat.isFile()) return "Read must target a regular file";
            if ((toolName === "ls" || toolName === "find") && !target.stat.isDirectory()) {
                return `${toolName} must target a directory`;
            }
            // Conservatively reject the whole tree, even when a tool would skip the unsafe entry.
            if (target.stat.isDirectory()) await checkTree(target.path);
        }
        return undefined;
    } catch (error) {
        return `Dream access denied: ${error instanceof Error ? error.message : String(error)}`;
    }
}

async function canonicalTarget(path: string): Promise<string> {
    let parent = path;
    while (!(await statIfPresent(parent))) {
        if (dirname(parent) === parent) throw new Error(`Cannot resolve path: ${path}`);
        parent = dirname(parent);
    }
    return resolve(await fs.realpath(parent), relative(parent, path));
}

// This covers write and edit only. Bash and other tools are not protected.
export async function protectStore(
    toolName: string,
    input: Record<string, unknown>,
    cwd: string,
    store: string,
): Promise<string | undefined> {
    if (toolName !== "write" && toolName !== "edit") return undefined;
    try {
        const root = await checkedPath(store);
        if (root.stat && !root.stat.isDirectory()) throw new Error("The store is not a directory");
        const target = toolPath(toolName, input, cwd);
        if (contains(root.path, target) || contains(root.path, await canonicalTarget(target))) {
            return "The memory store is read-only. Use /dream or edit it by hand";
        }
        return undefined;
    } catch (error) {
        return `Memory write denied: ${error instanceof Error ? error.message : String(error)}`;
    }
}

export default function childGate(pi: ExtensionAPI): void {
    let readRoots: string[] = [];
    let writeRoot = "";
    let configurationError: string | undefined;
    try {
        const parsed: unknown = JSON.parse(process.env.PI_DREAM_READ_ROOTS ?? "");
        const write = process.env.PI_DREAM_WRITE_ROOT;
        if (!Array.isArray(parsed) || !parsed.length ||
            !parsed.every((root) => validPath(root) && isAbsolute(root)) ||
            !validPath(write) || !isAbsolute(write)) {
            throw new Error("Expected absolute read roots and a write root");
        }
        readRoots = parsed;
        writeRoot = write;
    } catch {
        configurationError = "Dream access denied: invalid or missing PI_DREAM_READ_ROOTS / PI_DREAM_WRITE_ROOT";
    }
    process.umask(0o077);
    pi.on("tool_call", async (event, ctx) => {
        const reason = configurationError ?? await checkAccess(event.toolName, event.input, ctx.cwd, readRoots, writeRoot);
        return reason ? { block: true, reason } : undefined;
    });
}
