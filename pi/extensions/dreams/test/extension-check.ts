import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { sanitiseStatus } from "../../catppuccin-footer/format.ts";
import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import dreams, {
  estimateCost,
  formatDream,
  parseDreamOptions,
  splitArgs,
} from "../index.ts";
import { createJob, jobDirectory, saveJob, transition } from "../jobs.ts";
import { fingerprintStore } from "../store.ts";

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
      await writeFile(
        join(directory, "base.json"),
        JSON.stringify({ "gone.md": "0" }),
      );
      confirm = true;
      await commands.get("dream").handler(`adopt ${job.id}`, ctx);
      assert.match(
        notifications.at(-1)!,
        /The store changed after this dream copied it[\s\S]*removed gone\.md/,
      );
      await writeFile(
        join(directory, "base.json"),
        JSON.stringify(await fingerprintStore(store)),
      );
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
      const rejected = await createJob(join(agent, "dreams"), {
        storeKey: key,
        storePath: store,
        repoRoot: cwd,
        sessionFiles: [session],
      });
      const rejectedDirectory = jobDirectory(
        join(agent, "dreams"),
        rejected.id,
      );
      const rejectedOutput = `${store}.dream-${rejected.id}`;
      await mkdir(rejectedOutput, { mode: 0o700 });
      await writeFile(join(rejectedOutput, "MEMORY.md"), "Rejected.\n");
      transition(rejected, "running");
      transition(rejected, "completed");
      rejected.outputs = [{ type: "memory_store", path: rejectedOutput }];
      await saveJob(rejectedDirectory, rejected);
      await commands.get("dream").handler(`discard ${rejected.id}`, ctx);
      for (const path of [rejectedOutput, rejectedDirectory])
        await assert.rejects(stat(path), { code: "ENOENT" });
      const legacy = await createJob(join(agent, "dreams"), {
        storeKey: key,
        storePath: store,
        repoRoot: cwd,
        sessionFiles: [session],
      });
      const legacyDirectory = jobDirectory(join(agent, "dreams"), legacy.id);
      transition(legacy, "running");
      transition(legacy, "failed", {
        type: "internal_error",
        message: "fixture",
      });
      await saveJob(legacyDirectory, legacy);
      await writeFile(join(legacyDirectory, "output-state"), "discarded");
      await commands.get("dream").handler(`discard ${legacy.id}`, ctx);
      await assert.rejects(stat(legacyDirectory), { code: "ENOENT" });
      await mkdir(join(directory, "sessions"));
      await writeFile(join(directory, "sessions", "child.jsonl"), "{}\n");
      const oldBackups = [
        "2000-01-01T00-00-00-000Z-a",
        "2001-01-01T00-00-00-000Z-b",
      ].map((suffix) => `${store}.bak-${suffix}`);
      for (const backup of oldBackups) await mkdir(backup, { mode: 0o700 });
      confirm = false;
      await commands.get("dream").handler("prune", ctx);
      await stat(join(directory, "sessions"));
      confirm = true;
      await commands.get("dream").handler("prune", ctx);
      assert.match(notifications.at(-1)!, /Pruned 1 log folders and 2 backups/);
      await assert.rejects(stat(join(directory, "sessions")), {
        code: "ENOENT",
      });
      for (const backup of oldBackups)
        await assert.rejects(stat(backup), { code: "ENOENT" });
      await stat(join(directory, "dream.json"));
      await commands.get("dream").handler("prune", ctx);
      assert.equal(notifications.at(-1), "Nothing to prune");
      const shown = formatDream(
        {
          ...job,
          estimate_usd: 7.4,
          cost_by_phase: { analyze: 7.05, organize: 0.24 },
          analyses: [
            { session: "/s/a.jsonl", error: "did not read lines 2-9" },
          ],
          checks: {
            problems: ['not in MEMORY.md: "x.md"'],
            duplicates: [["a.md", "b.md"]],
          },
          summary: JSON.stringify({
            index_entries: 3,
            changes: ["Merged a into b"],
          }),
        },
        "/record/dream.json",
      );
      for (const expected of [
        /\(estimate \$7\.40\)/,
        /Cost: analyse \$7\.05, organise \$0\.24/,
        /- \/s\/a\.jsonl: did not read lines 2-9/,
        /Organiser changes \(3 index entries\):\n- Merged a into b/,
        /- not in MEMORY\.md: "x\.md"/,
        /- a\.md and b\.md/,
        /Full record: \/record\/dream\.json/,
      ])
        assert.match(shown, expected);
      assert.match(
        formatDream({ ...job, summary: "plain text" }, "/r"),
        /- plain text/,
      );
      // Run 2 of the benchmark: 4.02 MB of transcripts on Sonnet cost $7.29.
      const estimate = estimateCost(4_024_601, 40_000, 2, 2);
      assert.ok(estimate > 6.5 && estimate < 8, String(estimate));
      assert.equal(estimateCost(1000, 1000, 0, 0), 0);
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
      assert.equal(
        parseDreamOptions(
          splitArgs("--organizer-model anthropic/claude-haiku-5-5"),
        ).organizerModel,
        "anthropic/claude-haiku-5-5",
      );
      for (const input of [
        "--budget 0",
        "--budget Infinity",
        "--concurrency 1.2",
        "--since nonsense",
        "--sessions a,,b",
        "--unknown",
        "--model sonnet",
        "--organizer-model haiku",
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
