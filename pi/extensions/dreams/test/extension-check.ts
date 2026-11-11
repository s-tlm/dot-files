import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { sanitiseStatus } from "../../catppuccin-footer/format.ts";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import dreams, { parseDreamOptions, splitArgs } from "../index.ts";
import { createJob, jobDirectory, saveJob, transition } from "../jobs.ts";

export default function checks(real: ExtensionAPI) {
  real.on("session_start", async (_event, realContext) => {
    try {
      const handlers = new Map<string, Function>();
      const commands = new Map<string, any>();
      const entries: any[] = [];
      const notifications: string[] = [];
      const calls: string[][] = [];
      let branch: any[] = [];
      let confirm = true;
      const mock = {
        registerFlag() {},
        getFlag() {},
        getSettings: () => ({
          sessionDir: join(
            process.env.PI_CODING_AGENT_DIR!,
            "configured-sessions",
          ),
        }),
        registerEntryRenderer() {},
        on: (event: string, handler: Function) => handlers.set(event, handler),
        registerCommand: (name: string, command: any) =>
          commands.set(name, command),
        appendEntry: (type: string, data: any) => {
          const entry = { type: "custom", customType: type, data };
          entries.push(entry);
          branch.push(entry);
        },
        sendMessage: () =>
          assert.fail("Command output must not enter model context"),
        exec: async (command: string, args: string[], options: any) => {
          calls.push([command, ...args]);
          return real.exec(command, args, options);
        },
      };
      dreams(mock as unknown as ExtensionAPI);
      const agent = process.env.PI_CODING_AGENT_DIR!;
      const cwd = join(agent, "project");
      await mkdir(cwd);
      const ctx: any = {
        cwd,
        hasUI: true,
        mode: "rpc",
        modelRegistry: { getAvailable: () => [] },
        sessionManager: {
          getBranch: () => branch,
          getEntries: () => assert.fail("Use the active branch"),
          getSessionFile: () => undefined,
        },
        ui: {
          notify: (text: string) => notifications.push(text),
          setStatus: () => assert.fail("RPC must not run a footer poller"),
          confirm: async () => confirm,
        },
      };
      await handlers.get("session_start")!({}, ctx);
      assert.equal(entries.length, 0, "Opening a session must not tag it");
      const first: any = { systemPromptOptions: { sections: {} } };
      await handlers.get("before_agent_start")!(first, ctx);
      assert.equal(entries[0].customType, "dreams:store");
      const key = entries[0].data.key;
      const store = join(agent, "memory", key);
      await mkdir(store, { recursive: true, mode: 0o700 });
      await writeFile(
        join(store, "MEMORY.md"),
        "A hand edit that must not change the current prompt.\n",
      );
      const second: any = { systemPromptOptions: { sections: {} } };
      await handlers.get("before_agent_start")!(second, ctx);
      assert.equal(
        second.systemPromptOptions.sections.memory,
        first.systemPromptOptions.sections.memory,
      );
      assert.equal(
        entries.filter((entry) => entry.customType === "dreams:store").length,
        1,
      );
      branch = [];
      await handlers.get("before_agent_start")!(
        { systemPromptOptions: { sections: {} } },
        ctx,
      );
      assert.equal(
        entries.filter((entry) => entry.customType === "dreams:store").length,
        2,
        "A new branch needs its own tag",
      );
      await commands.get("memory").handler("", ctx);
      assert.equal(entries.at(-1).customType, "dreams:result");
      await commands.get("dream").handler("list", ctx);
      assert.equal(entries.at(-1).customType, "dreams:result");
      assert.ok(
        calls.some(
          (call) => call[0] === "git" && call.includes("--git-common-dir"),
        ),
      );
      const blocked = await handlers.get("tool_call")!(
        { toolName: "write", input: { path: join(store, "topic.md") } },
        ctx,
      );
      assert.equal(blocked.block, true);
      const nested = await handlers.get("tool_call")!(
        {
          toolName: "edit",
          parentToolCallId: "codemode/1",
          input: { path: join(store, "topic.md") },
        },
        ctx,
      );
      assert.equal(nested.block, true);
      const missingPath = await handlers.get("tool_call")!(
        { toolName: "write", input: {} },
        ctx,
      );
      assert.equal(missingPath.block, true);
      assert.equal(
        await handlers.get("tool_call")!(
          { toolName: "read", input: { path: join(store, "topic.md") } },
          ctx,
        ),
        undefined,
      );
      const subcommands = await commands
        .get("dream")
        .getArgumentCompletions("ca");
      assert.deepEqual(
        subcommands.map((item: any) => item.value),
        ["cancel"],
      );
      const session = join(agent, "fixture.jsonl");
      await writeFile(session, "fixture");
      const job = await createJob(join(agent, "dreams"), {
        storeKey: key,
        storePath: store,
        repoRoot: cwd,
        sessionFiles: [session],
      });
      const directory = jobDirectory(join(agent, "dreams"), job.id);
      transition(job, "running");
      job.pid = process.pid;
      await saveJob(directory, job);
      const beforeCancel = await readFile(
        join(directory, "dream.json"),
        "utf8",
      );
      await commands.get("dream").handler(`cancel ${job.id}`, ctx);
      assert.equal(await readFile(join(directory, "cancel"), "utf8"), "");
      assert.equal(
        await readFile(join(directory, "dream.json"), "utf8"),
        beforeCancel,
        "Cancel must not write the live job record",
      );
      const ids = await commands
        .get("dream")
        .getArgumentCompletions("show drm_");
      assert.ok(ids.some((item: any) => item.value === `show ${job.id}`));
      transition(job, "completed");
      const output = `${store}.dream-${job.id}`;
      await mkdir(output, { mode: 0o700 });
      await writeFile(
        join(output, "MEMORY.md"),
        `The adopted memory index.\n${Array.from({ length: 201 }, (_, i) => `Memory line ${i + 1}`).join("\n")}\n`,
      );
      job.outputs = [{ type: "memory_store", path: output }];
      job.cloned_at = new Date().toISOString();
      await saveJob(directory, job);
      const beforeAdopt = await readFile(join(directory, "dream.json"), "utf8");
      confirm = false;
      await commands.get("dream").handler(`adopt ${job.id}`, ctx);
      const unchanged: any = { systemPromptOptions: { sections: {} } };
      await handlers.get("before_agent_start")!(unchanged, ctx);
      assert.equal(
        unchanged.systemPromptOptions.sections.memory,
        first.systemPromptOptions.sections.memory,
      );
      confirm = true;
      await commands.get("dream").handler(`adopt ${job.id}`, ctx);
      assert.equal(
        await readFile(join(directory, "dream.json"), "utf8"),
        beforeAdopt,
        "Adoption must not rewrite the job record",
      );
      const adopted: any = { systemPromptOptions: { sections: {} } };
      await handlers.get("before_agent_start")!(adopted, ctx);
      assert.match(
        adopted.systemPromptOptions.sections.memory,
        /The adopted memory index/,
      );
      assert.match(
        adopted.systemPromptOptions.sections.memory,
        /Memory line 199/,
      );
      assert.doesNotMatch(
        adopted.systemPromptOptions.sections.memory,
        /Memory line 200/,
      );
      assert.notEqual(
        adopted.systemPromptOptions.sections.memory,
        first.systemPromptOptions.sections.memory,
      );
      await writeFile(join(store, "MEMORY.md"), "Another hand edit.\n");
      const stable: any = { systemPromptOptions: { sections: {} } };
      await handlers.get("before_agent_start")!(stable, ctx);
      assert.equal(
        stable.systemPromptOptions.sections.memory,
        adopted.systemPromptOptions.sections.memory,
      );
      assert.deepEqual(
        splitArgs('--instructions "keep \\"quoted\\" words" --budget 1'),
        ["--instructions", 'keep "quoted" words', "--budget", "1"],
      );
      for (const input of ['"unclosed', "unfinished\\"])
        assert.throws(() => splitArgs(input));
      const options = parseDreamOptions(
        splitArgs(
          "--since 14d --budget 2.5 --concurrency 2 --keep-transcripts --yes",
        ),
        20 * 86_400_000,
      );
      assert.equal(options.since, 6 * 86_400_000);
      assert.equal(options.budget, 2.5);
      assert.equal(options.concurrency, 2);
      assert.equal(options.keepTranscripts, true);
      assert.equal(options.yes, true);
      for (const input of [
        "--budget 0",
        "--budget Infinity",
        "--concurrency 1.2",
        "--since nonsense",
        "--sessions a,,b",
        "--unknown",
        "--model sonnet",
      ])
        assert.throws(() => parseDreamOptions(splitArgs(input)));
      const intervals = new Map<
        number,
        { callback: () => unknown; delay: number }
      >();
      const statuses: (string | undefined)[] = [];
      const originalSetInterval = globalThis.setInterval;
      const originalClearInterval = globalThis.clearInterval;
      let nextInterval = 0;
      globalThis.setInterval = ((callback: () => unknown, delay: number) => {
        const id = ++nextInterval;
        intervals.set(id, { callback, delay });
        return id;
      }) as unknown as typeof setInterval;
      globalThis.clearInterval = ((id: number) => {
        intervals.delete(id);
      }) as unknown as typeof clearInterval;
      const tui = {
        ...ctx,
        mode: "tui",
        ui: {
          ...ctx.ui,
          setStatus: (_key: string, text: string | undefined) =>
            statuses.push(text),
        },
      };
      try {
        const active = await createJob(join(agent, "dreams"), {
          storeKey: key,
          storePath: store,
          repoRoot: cwd,
          sessionFiles: [session],
        });
        transition(active, "running");
        active.pid = process.pid;
        active.progress = { phase: "analyze", done: 4, total: 22, failed: [] };
        active.usage.cost_usd = 0.41;
        const activeDirectory = jobDirectory(join(agent, "dreams"), active.id);
        await saveJob(activeDirectory, active);
        await handlers.get("session_start")!({}, tui);
        assert.match(statuses.at(-1)!, /\(-_-\).*dreaming 4\/22 · \$0\.41/);
        const animation = [...intervals.values()].find(
          (interval) => interval.delay < 1000,
        );
        const poll = [...intervals.values()].find(
          (interval) => interval.delay === 5000,
        );
        assert.ok(animation, "An active dream needs an animation timer");
        assert.ok(poll, "Job polling must remain every five seconds");
        const frames = new Set<string>();
        for (let i = 0; i < 12; i++) {
          animation.callback();
          frames.add(statuses.at(-1)!);
          assert.match(statuses.at(-1)!, /dreaming 4\/22 · \$0\.41$/);
          const prefix = statuses.at(-1)!.split("dreaming")[0];
          assert.match(prefix, /^[\x20-\x7e]+$/);
          assert.equal(
            visibleWidth(prefix),
            10,
            "The animation must occupy nine columns plus one separator",
          );
          const rendered = sanitiseStatus(statuses.at(-1)!);
          assert.equal(
            visibleWidth(rendered.slice(0, rendered.indexOf("dreaming"))),
            10,
            "The footer must keep the label at the same column",
          );
        }
        assert.equal(
          frames.size,
          6,
          "The ASCII animation must cycle through six frames",
        );
        assert.equal(
          new Set([...frames].map(sanitiseStatus)).size,
          6,
          "Footer formatting must preserve all animation frames",
        );
        assert.equal(
          new Set([...frames].map((frame) => frame.length)).size,
          1,
          "Animation frames must not move the progress text",
        );
        active.progress.done = 5;
        active.usage.cost_usd = 0.52;
        await saveJob(activeDirectory, active);
        await poll.callback();
        assert.match(statuses.at(-1)!, /dreaming 5\/22 · \$0\.52$/);
        transition(active, "completed");
        await saveJob(activeDirectory, active);
        await poll.callback();
        assert.equal(statuses.at(-1), undefined);
        assert.equal(
          intervals.size,
          1,
          "Completion must stop the animation, but leave job polling active",
        );
        const count = statuses.length;
        animation.callback();
        assert.equal(
          statuses.length,
          count,
          "A queued frame must not redraw after completion",
        );
        await handlers.get("session_shutdown")!({}, tui);
        await handlers.get("session_shutdown")!({}, tui);
        assert.equal(
          intervals.size,
          0,
          "Shutdown must clean up every timer and be safe twice",
        );
        await handlers.get("session_start")!({}, tui);
        assert.equal(intervals.size, 1, "An idle TUI must not animate");
        await handlers.get("session_shutdown")!({}, tui);
        const pending = await createJob(join(agent, "dreams"), {
          storeKey: key,
          storePath: store,
          repoRoot: cwd,
          sessionFiles: [session],
        });
        const rpc = { ...tui, mode: "rpc" };
        await handlers.get("session_start")!({}, rpc);
        assert.equal(
          intervals.size,
          0,
          "RPC must not start footer timers, even for an active dream",
        );
        await handlers.get("session_shutdown")!({}, rpc);
        await handlers.get("session_start")!({}, tui);
        assert.equal(intervals.size, 2, "Pending dreams must also animate");
        const queuedFrame = [...intervals.values()].find(
          (interval) => interval.delay < 1000,
        )!;
        await handlers.get("session_shutdown")!({}, tui);
        assert.equal(
          intervals.size,
          0,
          "Shutdown must stop an active animation",
        );
        const stoppedCount = statuses.length;
        queuedFrame.callback();
        assert.equal(
          statuses.length,
          stoppedCount,
          "A queued frame must not redraw after shutdown",
        );
        const pendingRecord = JSON.parse(
          await readFile(
            join(jobDirectory(join(agent, "dreams"), pending.id), "dream.json"),
            "utf8",
          ),
        );
        assert.equal(
          pendingRecord.status,
          "pending",
          "Stopping the TUI must leave its dream alone",
        );
      } finally {
        await handlers.get("session_shutdown")!({}, tui);
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
      }
      process.stdout.write("EXTENSION_CHECKS_PASSED\n");
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.stack : String(error)}\n`,
      );
      process.exitCode = 1;
    } finally {
      realContext.shutdown();
    }
  });
}
