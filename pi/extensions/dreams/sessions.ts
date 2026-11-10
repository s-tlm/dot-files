import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveStore } from "./store.ts";

export interface SessionInfo {
    path: string;
    id: string;
    cwd: string;
    created: number;
    modified: number;
    messageCount: number;
    parentSession?: string;
    storeKey?: string;
}

type Content = string | Record<string, unknown>[] | null | undefined;
type Message = Record<string, unknown> & { role: string; content?: Content };
type Entry = Record<string, unknown> & { type: string; id: string; parentId: string | null };
type ParsedSession = { info: SessionInfo; entries: Entry[] };

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validContent(value: unknown): value is Content {
    return value == null || typeof value === "string" || (Array.isArray(value) && value.every((block) => {
        if (!record(block) || typeof block.type !== "string") return false;
        if (block.type === "text") return typeof block.text === "string";
        if (block.type === "toolCall") return typeof block.name === "string" && record(block.arguments);
        return true;
    }));
}

async function parseSession(path: string): Promise<ParsedSession> {
    const fail = (reason: string): never => { throw new Error(`Invalid session ${path}: ${reason}`); };
    const rows: Record<string, unknown>[] = [];
    for (const [index, line] of (await readFile(path, "utf8")).split("\n").entries()) {
        if (!line.trim()) continue;
        let value: unknown;
        try { value = JSON.parse(line); } catch { fail(`invalid JSON on line ${index + 1}`); }
        if (!record(value)) fail(`expected an object on line ${index + 1}`);
        rows.push(value as Record<string, unknown>);
    }
    const header = rows.shift();
    if (!header || header.type !== "session" || typeof header.id !== "string" ||
        !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(header.id) ||
        typeof header.cwd !== "string" || typeof header.timestamp !== "string" ||
        !Number.isFinite(Date.parse(header.timestamp))) fail("invalid header");
    const version = header.version ?? 1;
    if (version !== 1 && version !== 2 && version !== 3) fail("unsupported version");
    if (header.parentSession !== undefined && typeof header.parentSession !== "string") fail("invalid parent session");
    const ids = new Set<string>();
    let previous: string | null = null;
    for (const [index, row] of rows.entries()) {
        if (version === 1) {
            row.id = `legacy-${index}`;
            row.parentId = previous;
            if (row.type === "compaction" && typeof row.firstKeptEntryIndex === "number") {
                row.firstKeptEntryId = rows[row.firstKeptEntryIndex - 1]?.id;
            }
        }
        if (typeof row.type !== "string" || row.type === "session" || typeof row.id !== "string" || !row.id ||
            (row.parentId !== null && typeof row.parentId !== "string") || ids.has(row.id)) fail("invalid tree entry");
        ids.add(row.id as string);
        previous = row.id as string;
        if (row.type === "message" && (!record(row.message) || typeof row.message.role !== "string" ||
            !validContent(row.message.content))) fail("invalid message");
        if ((row.type === "compaction" || row.type === "branch_summary") && typeof row.summary !== "string") {
            fail("invalid summary");
        }
        if (row.type === "compaction" && typeof row.firstKeptEntryId !== "string") fail("invalid compaction boundary");
        if (row.type === "context_edit" && (typeof row.targetId !== "string" ||
            (row.replacement !== null && (!record(row.replacement) || !Object.hasOwn(row.replacement, "content") || !validContent(row.replacement.content))))) {
            fail("invalid context edit");
        }
        if (row.type === "custom" && row.customType === "dreams:store" &&
            (!record(row.data) || typeof row.data.key !== "string" || !row.data.key)) fail("invalid store tag");
    }
    const entries = rows as Entry[];
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const checked = new Set<string>();
    for (const entry of entries) {
        const visiting = new Set<string>();
        let current: Entry | undefined = entry;
        while (current && !checked.has(current.id)) {
            if (visiting.has(current.id)) fail("cyclic parent chain");
            visiting.add(current.id);
            current = current.parentId === null ? undefined : byId.get(current.parentId);
        }
        for (const id of visiting) checked.add(id);
    }
    const tags = entries.filter((entry) => entry.type === "custom" && entry.customType === "dreams:store");
    const tag = tags.at(-1)?.data as { key: string } | undefined;
    return {
        info: {
            path,
            id: header.id as string,
            cwd: header.cwd as string,
            created: Date.parse(header.timestamp as string),
            modified: (await stat(path)).mtimeMs,
            messageCount: entries.filter((entry) => entry.type === "message").length,
            ...(header.parentSession ? { parentSession: header.parentSession as string } : {}),
            ...(tag ? { storeKey: tag.key } : {}),
        },
        entries,
    };
}

function missing(error: unknown): boolean {
    return record(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

async function sessionFiles(directory: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await sessionFiles(path));
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
    return files;
}

export async function discoverSessions(sessionsRoot: string): Promise<SessionInfo[]> {
    let root: string;
    try { root = await realpath(sessionsRoot); } catch (error) {
        if (missing(error)) return [];
        throw error;
    }
    const sessions: SessionInfo[] = [];
    for (const path of await sessionFiles(root)) {
        try { sessions.push((await parseSession(path)).info); } catch (error) {
            // A session can be half-written while another process appends to it.
            if (!missing(error) && !(error instanceof Error && error.message.startsWith("Invalid session "))) throw error;
        }
    }
    return sessions.sort(oldestFirst);
}

function oldestFirst(a: SessionInfo, b: SessionInfo): number {
    return a.created - b.created || a.path.localeCompare(b.path);
}

function inside(root: string, path: string): boolean {
    const part = relative(root, path);
    return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

async function explicitSessions(root: string, inputs: string[]): Promise<SessionInfo[]> {
    if (!inputs.length || inputs.some((input) => !input.trim())) throw new Error("Explicit sessions cannot be empty");
    const found = new Map<string, SessionInfo>();
    let discovered: SessionInfo[] | undefined;
    for (const input of inputs) {
        const path = resolve(root, input);
        if (!inside(root, path)) throw new Error(`Session input is outside sessionsRoot: ${input}`);
        let exists = true;
        try { await lstat(path); } catch (error) {
            if (!missing(error)) throw error;
            exists = false;
        }
        if (exists) {
            const canonical = await realpath(path);
            if (!inside(root, canonical) || (await lstat(path)).isSymbolicLink()) {
                throw new Error(`Symlinked or outside session input: ${input}`);
            }
            const stats = await stat(canonical);
            const files = stats.isDirectory() ? await sessionFiles(canonical) :
                stats.isFile() && canonical.endsWith(".jsonl") ? [canonical] : [];
            if (!files.length) throw new Error(`No session files in input: ${input}`);
            for (const file of files) {
                const { info } = await parseSession(file);
                found.set(info.path, info);
            }
            continue;
        }
        if (input.includes("/") || input.includes("\\") || input.endsWith(".jsonl")) {
            throw new Error(`Session input does not exist: ${input}`);
        }
        discovered ??= await discoverSessions(root);
        let matches = discovered.filter((session) => session.id === input);
        if (!matches.length) matches = discovered.filter((session) => session.id.startsWith(input));
        if (matches.length !== 1) throw new Error(`${matches.length ? "Ambiguous" : "Unknown"} session ID: ${input}`);
        found.set(matches[0].path, matches[0]);
    }
    return [...found.values()];
}

export async function selectSessions(options: {
    sessionsRoot: string;
    storeKey: string;
    currentSessionFile?: string;
    since?: number;
    explicit?: string[];
    now?: number;
    exec?: Parameters<typeof resolveStore>[2];
}): Promise<{ sessions: SessionInfo[]; skippedUnmatched: number; limited: number }> {
    const now = options.now ?? Date.now();
    if (!options.storeKey || !Number.isFinite(now) ||
        (options.since !== undefined && !Number.isFinite(options.since))) throw new Error("Invalid session selection options");
    const sessions = options.explicit === undefined ? await discoverSessions(options.sessionsRoot) :
        await explicitSessions(await realpath(options.sessionsRoot), options.explicit);
    let current = options.currentSessionFile && resolve(options.currentSessionFile);
    if (current) {
        try { current = await realpath(current); } catch (error) { if (!missing(error)) throw error; }
    }
    const stores = new Map<string, string | null>();
    const selected: SessionInfo[] = [];
    let skippedUnmatched = 0;
    for (const session of sessions) {
        if (session.path === current || session.parentSession || session.messageCount < 2 ||
            session.modified > now - 10 * 60 * 1000 ||
            (options.since !== undefined && session.modified <= options.since)) continue;
        if (options.explicit === undefined) {
            let key: string | null | undefined = session.storeKey;
            if (key === undefined) {
                if (!stores.has(session.cwd)) {
                    let live = false;
                    try {
                        live = Boolean(session.cwd && isAbsolute(session.cwd) && (await stat(session.cwd)).isDirectory());
                    } catch (error) { if (!missing(error)) throw error; }
                    stores.set(session.cwd, live ? (await resolveStore(session.cwd, undefined, options.exec)).key : null);
                }
                key = stores.get(session.cwd);
                if (key === null) skippedUnmatched++;
            }
            if (key !== options.storeKey) continue;
        }
        selected.push(session);
    }
    selected.sort(oldestFirst);
    return { sessions: selected.slice(0, 100), skippedUnmatched, limited: Math.max(0, selected.length - 100) };
}

export function redact(text: string): string {
    return text
        .replace(/-----BEGIN ([A-Z0-9][A-Z0-9 ]*)-----[\s\S]*?(?:-----END \1-----|$)/g, "[REDACTED:pem]")
        .replace(/((?:["']?(?:proxy-)?authorization["']?[ \t]*:[ \t]*["']?)Bearer[ \t]+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED:bearer]")
        .replace(/\bBearer[ \t]+[A-Za-z0-9._~+\/-]{16,}=*/gi, "Bearer [REDACTED:bearer]")
        .replace(/\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g, "[REDACTED:aws]")
        .replace(/((?:["']?aws_(?:secret_access_key|session_token)["']?)[ \t]*[:=][ \t]*["']?)[A-Za-z0-9/+]{40,}=*/gi, "$1[REDACTED:aws]")
        .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g, "[REDACTED:github]")
        .replace(/\bxox[baprs]-(?:2-)?(?:[A-Za-z0-9]{10,}-){0,3}[A-Za-z0-9]{10,}\b/g, "[REDACTED:slack]")
        .replace(/\bxoxe[.-][A-Za-z0-9-]{20,}\b/g, "[REDACTED:slack]")
        .replace(/\bdapi[a-f0-9]{32}\b/gi, "[REDACTED:databricks]")
        .replace(/\bsk-ant-(?:api\d{2}|oat\d{2})-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED:anthropic]")
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, (token) => {
            try {
                const [header, payload] = token.split(".").slice(0, 2).map((part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")));
                return record(header) && typeof header.alg === "string" && record(payload) ? "[REDACTED:jwt]" : token;
            } catch { return token; }
        });
}

function truncate(text: string, head: number, tail = 0): string {
    const bytes = Buffer.from(text);
    if (bytes.length <= head + tail) return text;
    let end = head;
    while ((bytes[end] & 0xc0) === 0x80) end--;
    let start = bytes.length - tail;
    while ((bytes[start] & 0xc0) === 0x80) start++;
    return `${bytes.subarray(0, end).toString()}\n[... truncated ...]${tail ? `\n${bytes.subarray(start).toString()}` : ""}`;
}

function textContent(content: Content): string {
    if (typeof content === "string") return content;
    return content?.filter((block) => block.type === "text").map((block) => block.text).join("\n") ?? "";
}

function data(text: string): string {
    // Indent every data line so transcript labels cannot create new boundaries.
    return text.replace(/\r\n?|\u2028|\u2029/g, "\n").split("\n").map((line) => ` ${line}`).join("\n");
}

function inline(value: unknown): string {
    return redact(typeof value === "string" ? value : "unknown").replace(/\s+/g, " ");
}

function contextEntries(entries: Entry[]): Entry[] {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const branch: Entry[] = [];
    let current = entries.at(-1);
    while (current) {
        branch.push(current);
        current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    branch.reverse();
    const index = branch.findLastIndex((entry) => entry.type === "compaction");
    if (index < 0) return branch;
    const compaction = branch[index];
    const kept = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
    return [compaction, ...(kept >= 0 && kept < index ? branch.slice(kept, index) : []), ...branch.slice(index + 1)];
}

export async function renderSession(path: string): Promise<string> {
    const { info, entries } = await parseSession(path);
    const selected = contextEntries(entries);
    const edits = new Map(selected.filter((entry) => entry.type === "context_edit").map((entry) => [entry.targetId, entry.replacement]));
    const output = [`SESSION ${inline(info.id)}\n${data(redact(`cwd: ${info.cwd}\ncreated: ${new Date(info.created).toISOString()}`))}`];
    const append = (label: string, text: string, head?: number, tail?: number) => {
        const safe = redact(text);
        if (safe) output.push(`${label}\n${data(head === undefined ? safe : truncate(safe, head, tail))}`);
    };
    for (const [index, entry] of selected.entries()) {
        if (entry.type === "compaction") {
            if (index === 0) append("COMPACTION SUMMARY:", entry.summary as string);
            continue;
        }
        if (entry.type === "branch_summary") {
            append("BRANCH SUMMARY:", entry.summary as string);
            continue;
        }
        if (entry.type !== "message") continue;
        const message = entry.message as Message;
        const edit = edits.get(entry.id);
        if (edit === null && ["user", "assistant", "toolResult", "custom"].includes(message.role)) continue;
        const content = record(edit) && ["user", "assistant", "toolResult", "custom"].includes(message.role) ? edit.content as Content : message.content;
        if (message.role === "user") append("USER:", textContent(content));
        if (message.role === "assistant") {
            if (typeof content === "string") append("AGENT:", content);
            else for (const block of content ?? []) {
                if (block.type === "text") append("AGENT:", block.text as string);
                if (block.type === "toolCall") append(`TOOL CALL ${inline(block.name)}:`, JSON.stringify(block.arguments), 2048);
            }
        }
        if (message.role === "toolResult") {
            append(`TOOL RESULT (${inline(message.toolName)})${message.isError ? " [error]" : ""}:`, textContent(content), 2048, 1024);
        }
        if (message.role === "bashExecution" && !message.excludeFromContext) {
            append("TOOL CALL bash:", typeof message.command === "string" ? message.command : "", 2048);
            append(`TOOL RESULT (bash)${message.cancelled || (typeof message.exitCode === "number" && message.exitCode !== 0) ? " [error]" : ""}:`,
                typeof message.output === "string" ? message.output : "", 2048, 1024);
        }
    }
    return `${output.join("\n\n")}\n`;
}
