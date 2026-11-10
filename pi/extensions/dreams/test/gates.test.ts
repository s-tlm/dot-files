import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import childGate, { checkAccess, protectStore } from "../child-gate.ts";

async function fixture(t: TestContext) {
    const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), "dream-gate-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const read = join(root, "transcripts");
    const output = join(root, "output");
    const outside = join(root, "outside");
    for (const dir of [read, output, outside, join(output, "nested")]) {
        await fs.mkdir(dir, { mode: 0o700 });
    }
    for (const path of [join(read, "session.txt"), join(output, "topic.md"), join(outside, "secret")]) {
        await fs.writeFile(path, "content", { mode: 0o600 });
    }
    const check = (tool: string, input: Record<string, unknown>, cwd = output) =>
        checkAccess(tool, input, cwd, [read, output], output);
    return { root, read, output, outside, check };
}

type Handler = (
    event: { toolName: string; input: Record<string, unknown>; parentToolCallId?: string },
    ctx: { cwd: string },
) => Promise<{ block?: boolean; reason?: string } | undefined>;

function setEnv(t: TestContext, key: string, value: string | undefined): void {
    const previous = process.env[key];
    t.after(() => {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
    });
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
}

function register(t: TestContext, reads: string | undefined, write: string | undefined): Handler {
    setEnv(t, "PI_DREAM_READ_ROOTS", reads);
    setEnv(t, "PI_DREAM_WRITE_ROOT", write);
    const mask = process.umask();
    t.after(() => { process.umask(mask); });
    let handler: Handler | undefined;
    const pi = {
        on(event: string, callback: Handler) {
            assert.equal(event, "tool_call");
            handler = callback;
            return () => {};
        },
    };
    childGate(pi as unknown as Parameters<typeof childGate>[0]);
    assert.ok(handler);
    return handler;
}

for (const tool of ["read", "write", "edit", "grep", "find", "ls"]) {
    test(`${tool} allows an in-scope path and denies outside paths and prefix lookalikes`, async (t) => {
        const { root, output, outside, check } = await fixture(t);
        const directory = ["find", "ls"].includes(tool);
        const path = directory ? "." : "topic.md";
        assert.equal(await check(tool, { path }), undefined);
        assert.ok(await check(tool, { path: directory ? outside : join(outside, "secret") }));
        const lookalike = join(root, "output-other");
        await fs.mkdir(lookalike);
        await fs.writeFile(join(lookalike, "topic.md"), "outside");
        assert.ok(await check(tool, { path: directory ? lookalike : join(lookalike, "topic.md") }));
        assert.equal(await check(tool, { path: join(output, path) }), undefined);
    });
}

test("children read transcripts but never write or edit them", async (t) => {
    const { read, check } = await fixture(t);
    const path = join(read, "session.txt");
    assert.equal(await check("read", { path }), undefined);
    assert.equal(await check("grep", { path, pattern: "content" }), undefined);
    assert.ok(await check("write", { path }));
    assert.ok(await check("edit", { path }));
});

test("directory tools use cwd for omitted and empty paths, including an outside cwd", async (t) => {
    const { check, outside, output } = await fixture(t);
    for (const tool of ["grep", "find", "ls"]) {
        assert.equal(await check(tool, {}, output), undefined);
        assert.equal(await check(tool, { path: "" }, output), undefined);
        assert.ok(await check(tool, {}, outside));
        assert.ok(await check(tool, { path: null }));
    }
});

test("new write paths may have missing parents but edit targets must exist", async (t) => {
    const { check, output } = await fixture(t);
    assert.equal(await check("write", { path: "nested/new/dir/file.md" }), undefined);
    assert.ok(await check("edit", { path: "nested/new/dir/file.md" }));
    assert.ok(await check("write", { path: output }));
    assert.ok(await check("edit", { path: output }));
    assert.ok(await check("write", { path: "topic.md/child" }));
});

test("path traversal is checked after resolution, not by a string prefix", async (t) => {
    const { read, check } = await fixture(t);
    assert.equal(await check("write", { path: "../output/nested/../new.md" }), undefined);
    assert.equal(await check("write", { path: "../output/new.md" }, read), undefined);
    assert.ok(await check("write", { path: "../outside/new.md" }));
    assert.ok(await check("read", { path: "nested/../../outside/secret" }));
});

test("core @, tilde, file URL and Unicode-space path forms receive the same checks", async (t) => {
    const { root, check, output, outside } = await fixture(t);
    setEnv(t, "HOME", root);
    await fs.writeFile(join(output, "a b.md"), "content");
    const allowed = ["@topic.md", "~/output/topic.md", pathToFileURL(join(output, "topic.md")).href,
        "a\u00a0b.md", "a\u202fb.md"];
    for (const path of allowed) assert.equal(await check("read", { path }), undefined, path);
    for (const path of ["@../outside/secret", "~/outside/secret", pathToFileURL(join(outside, "secret")).href]) {
        assert.ok(await check("read", { path }), path);
    }
    for (const path of ["@../outside/new.md", "~/outside/new.md", pathToFileURL(join(outside, "new.md")).href]) {
        assert.ok(await check("write", { path }), path);
    }
});

test("missing reads are denied before pi can try alternative macOS filenames", async (t) => {
    const { output, outside, check } = await fixture(t);
    await fs.symlink(join(outside, "secret"), join(output, "curly’quote.md"));
    assert.ok(await check("read", { path: "curly'quote.md" }));
    assert.ok(await check("read", { path: "missing.md" }));
    assert.ok(await check("grep", { path: "missing.md" }));
    assert.ok(await check("read", { path: "." }));
    assert.ok(await check("find", { path: "topic.md" }));
    assert.ok(await check("ls", { path: "topic.md" }));
});

test("only the six filesystem tools are allowed", async (t) => {
    const { check } = await fixture(t);
    for (const tool of ["bash", "powershell", "codemode", "Agent", "mcp__read", "read_file", "", "toString"]) {
        assert.match((await check(tool, { path: "topic.md" }))!, /not allowed/);
    }
});

test("invalid input paths and working directories fail closed", async (t) => {
    const { check, output } = await fixture(t);
    for (const input of [{}, { path: "" }, { path: "@" }, { path: "\0" }, { path: 1 }, { path: null },
        { paths: [join(output, "topic.md")] }, { file_path: join(output, "topic.md") }]) {
        assert.ok(await check("write", input));
        assert.ok(await check("read", input));
    }
    assert.ok(await check("write", { path: "topic.md" }, "relative"));
    assert.ok(await check("write", { path: "topic.md" }, ""));
    assert.ok(await check("read", { path: "file://invalid-host/etc/passwd" }));
    assert.ok(await check("read", null as unknown as Record<string, unknown>));
    assert.ok(await check("read", [] as unknown as Record<string, unknown>));
});

test("symlink targets, missing descendants, internal aliases and dangling links are denied", async (t) => {
    const { output, outside, check } = await fixture(t);
    await fs.symlink(outside, join(output, "escape"));
    await fs.symlink(join(outside, "secret"), join(output, "secret.md"));
    await fs.symlink(join(output, "topic.md"), join(output, "internal.md"));
    await fs.symlink(join(outside, "missing"), join(output, "broken"));
    for (const path of ["escape/secret", "secret.md", "internal.md", "broken"]) {
        for (const tool of ["read", "write", "edit", "grep"]) assert.ok(await check(tool, { path }));
    }
    assert.ok(await check("write", { path: "escape/missing/child.md" }));
    for (const tool of ["find", "ls"]) assert.ok(await check(tool, { path: "escape" }));
});

for (const tool of ["grep", "find", "ls"]) {
    test(`${tool} denies recursively symlinked trees even when the link is nested or ignored`, async (t) => {
        const { output, outside, check } = await fixture(t);
        await fs.writeFile(join(output, ".gitignore"), "nested/\n");
        await fs.symlink(outside, join(output, "nested", "escape"));
        assert.ok(await check(tool, {}));
        assert.ok(await check(tool, { path: "nested" }));
        assert.equal(await check("read", { path: "topic.md" }), undefined);
    });
}

test("roots reject symlinks, symlink ancestors, missing paths and non-directory files", async (t) => {
    const { root, read, output, check } = await fixture(t);
    const alias = join(root, "alias");
    await fs.symlink(output, alias);
    for (const bad of [alias, join(alias, "nested"), join(root, "missing"), join(output, "topic.md"),
        "relative", "", "\0"]) {
        assert.ok(await checkAccess("read", { path: "topic.md" }, output, [bad], output));
        assert.ok(await checkAccess("write", { path: "new.md" }, output, [read, output], bad));
    }
    assert.ok(await checkAccess("read", { path: "topic.md" }, output, [], output));
    assert.ok(await checkAccess("read", { path: "topic.md" }, output, null as unknown as string[], output));
    assert.equal(await check("read", { path: "topic.md" }), undefined);
});

test("a write root is not implicitly readable unless it is in readRoots", async (t) => {
    const { read, output } = await fixture(t);
    assert.ok(await checkAccess("read", { path: "topic.md" }, output, [read], output));
    assert.equal(await checkAccess("write", { path: "new.md" }, output, [read], output), undefined);
});

test("hard links cannot alias files outside the child scope", async (t) => {
    const { outside, output, check } = await fixture(t);
    await fs.link(join(outside, "secret"), join(output, "linked.md"));
    for (const tool of ["read", "write", "edit", "grep"]) {
        assert.ok(await check(tool, { path: "linked.md" }));
    }
    for (const tool of ["grep", "find", "ls"]) assert.ok(await check(tool, {}));
});

test("non-regular entries are denied for direct and recursive tools", async (t) => {
    const { output, check } = await fixture(t);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(join(output, "socket"), resolve);
    });
    try {
        for (const tool of ["read", "write", "edit", "grep"]) assert.ok(await check(tool, { path: "socket" }));
        for (const tool of ["grep", "find", "ls"]) assert.ok(await check(tool, {}));
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});

test("filesystem inspection errors return a denial rather than reject or allow", async (t) => {
    const { check } = await fixture(t);
    const error = Object.assign(new Error("Permission denied"), { code: "EACCES" });
    const stat = t.mock.method(fs, "lstat", async () => { throw error; });
    assert.match((await check("read", { path: "topic.md" }))!, /Permission denied/);
    stat.mock.restore();
    t.mock.method(fs, "readdir", async () => { throw error; });
    assert.match((await check("grep", {}))!, /Permission denied/);
});

for (const [reads, write] of [
    [undefined, undefined], ["not json", "/tmp"], ["null", "/tmp"], ["{}", "/tmp"], ["[]", "/tmp"],
    ['["relative"]', "/tmp"], ['[""]', "/tmp"], ["[1]", "/tmp"], ['["/tmp"]', undefined],
    ['["/tmp"]', "relative"], ['["/tmp"]', ""],
] as const) {
    test(`the child factory fails closed for invalid configuration ${String(reads)} / ${String(write)}`, async (t) => {
        const handler = register(t, reads, write);
        const result = await handler({ toolName: "read", input: { path: "/etc/passwd" } }, { cwd: "/" });
        assert.equal(result?.block, true);
        assert.match(result?.reason ?? "", /invalid or missing/);
    });
}

test("the child factory registers an async gate and uses private creation modes", async (t) => {
    const { read, output, outside } = await fixture(t);
    const handler = register(t, JSON.stringify([read, output]), output);
    assert.equal(process.umask(), 0o077);
    assert.equal(await handler({ toolName: "read", input: { path: "topic.md" } }, { cwd: output }), undefined);
    assert.equal((await handler({ toolName: "bash", input: { command: "pwd" } }, { cwd: output }))?.block, true);
    assert.equal((await handler({ toolName: "write", input: { path: join(outside, "new") } }, { cwd: output }))?.block, true);
    await fs.mkdir(join(output, "new"));
    await fs.writeFile(join(output, "new", "file.md"), "content");
    assert.equal((await fs.stat(join(output, "new"))).mode & 0o777, 0o700);
    assert.equal((await fs.stat(join(output, "new", "file.md"))).mode & 0o777, 0o600);
});

test("the factory checks roots on each call and captures its initial environment", async (t) => {
    const { read, output } = await fixture(t);
    const handler = register(t, JSON.stringify([read, output]), output);
    setEnv(t, "PI_DREAM_WRITE_ROOT", "/");
    assert.equal(await handler({ toolName: "write", input: { path: "new.md" } }, { cwd: output }), undefined);
    await fs.rename(output, `${output}-moved`);
    await fs.symlink(`${output}-moved`, output);
    assert.equal((await handler({ toolName: "write", input: { path: "new.md" } }, { cwd: output }))?.block, true);
});

test("nested tool calls receive the same child gate and cannot bypass it through codemode", async (t) => {
    const { read, output, outside } = await fixture(t);
    const handler = register(t, JSON.stringify([read, output]), output);
    const parentToolCallId = "codemode-parent";
    assert.equal(await handler({ toolName: "read", input: { path: "topic.md" }, parentToolCallId },
        { cwd: output }), undefined);
    assert.equal((await handler({ toolName: "write", input: { path: join(outside, "new.md") }, parentToolCallId },
        { cwd: output }))?.block, true);
    assert.equal((await handler({ toolName: "write", input: {}, parentToolCallId }, { cwd: output }))?.block, true);
    assert.equal((await handler({ toolName: "codemode", input: {} }, { cwd: output }))?.block, true);
});

for (const tool of ["write", "edit"]) {
    test(`the main ${tool} gate protects absolute, relative, default-cwd and traversal paths`, async (t) => {
        const { root, output, outside } = await fixture(t);
        for (const [cwd, path] of [[root, "output/topic.md"], [output, "topic.md"],
            [outside, "../output/new/child.md"], [output, "nested/../topic.md"],
            [outside, join(output, "topic.md")]] as const) {
            assert.match((await protectStore(tool, { path }, cwd, output))!, /read-only/);
        }
        assert.equal(await protectStore(tool, { path: "secret" }, outside, output), undefined);
        assert.equal(await protectStore(tool, { path: "../outside/new" }, output, output), undefined);
    });
}

test("the main gate blocks symlink aliases to the store and to files within it", async (t) => {
    const { output, outside } = await fixture(t);
    await fs.symlink(output, join(outside, "alias"));
    await fs.symlink(join(output, "topic.md"), join(outside, "topic-alias"));
    await fs.symlink(outside, join(output, "escape"));
    for (const path of ["alias/topic.md", "alias/new/child.md", "topic-alias"]) {
        assert.ok(await protectStore("write", { path }, outside, output));
        assert.ok(await protectStore("edit", { path }, outside, output));
    }
    assert.ok(await protectStore("write", { path: "new.md" }, join(outside, "alias"), output));
    assert.ok(await protectStore("write", { path: "escape/new.md" }, output, output));
});

test("the main gate handles @, tilde, file URLs and Unicode spaces", async (t) => {
    const { root, output } = await fixture(t);
    setEnv(t, "HOME", root);
    for (const path of ["@output/topic.md", "~/output/topic.md", pathToFileURL(join(output, "topic.md")).href,
        "output/a\u00a0b.md"]) {
        assert.ok(await protectStore("write", { path }, root, output));
    }
});

test("the main gate protects an absent store, denies invalid input and rejects unsafe roots", async (t) => {
    const { root, output } = await fixture(t);
    assert.ok(await protectStore("write", { path: "missing/new/file.md" }, root, join(root, "missing")));
    for (const input of [{}, { path: "" }, { path: "\0" }, { path: 1 }, { file_path: "/etc/passwd" }]) {
        assert.ok(await protectStore("write", input, root, output));
    }
    assert.ok(await protectStore("write", { path: "file" }, root, join(output, "topic.md")));
    await fs.symlink(output, join(root, "alias"));
    assert.ok(await protectStore("write", { path: "file" }, root, join(root, "alias")));
    await fs.symlink(join(root, "absent"), join(root, "broken"));
    assert.ok(await protectStore("write", { path: "broken/child" }, root, output));
    t.mock.method(fs, "lstat", async () => { throw new Error("Inspection failed"); });
    assert.ok(await protectStore("edit", { path: "file" }, root, output));
});

test("the main gate allows outside prefix lookalikes and unrelated symlinks", async (t) => {
    const { root, output, outside } = await fixture(t);
    await fs.symlink(outside, join(root, "outside-alias"));
    assert.equal(await protectStore("write", { path: "output-other/file.md" }, root, output), undefined);
    assert.equal(await protectStore("write", { path: "outside-alias/new.md" }, root, output), undefined);
});

test("the main gate leaves reads and bash unprotected, even with invalid configuration", async () => {
    for (const tool of ["read", "grep", "find", "ls", "bash", "powershell", "custom"]) {
        assert.equal(await protectStore(tool, {}, "", ""), undefined);
    }
});
