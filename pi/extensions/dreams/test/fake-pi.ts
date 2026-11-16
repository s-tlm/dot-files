import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const model = args[args.indexOf("--model") + 1];
const promptPath = args[args.indexOf("--system-prompt") + 1];
const organizer = promptPath.endsWith("organizer.md");
for (const flag of [
  "--mode",
  "-p",
  "-ne",
  "-ns",
  "-nc",
  "-np",
  "--no-mcp",
  "-na",
  "--session-dir",
])
  assert.ok(args.includes(flag));
assert.equal(args[args.indexOf("--tools") + 1], "read,write,edit,grep,find,ls");
assert.equal(process.env.PI_DREAM_WRITE_ROOT, process.cwd());
assert.equal(
  JSON.parse(process.env.PI_DREAM_READ_ROOTS!).length,
  organizer ? 2 : 3,
);
assert.ok((await readFile(promptPath, "utf8")).length > 0);
if (model === "fake/hang" || model === "fake/ignore-term") {
  if (model === "fake/ignore-term") {
    process.on("SIGTERM", () => {});
    const descendant = spawn(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      { stdio: "inherit" },
    );
    await writeFile(
      join(process.cwd(), "descendant.pid"),
      String(descendant.pid),
    );
  }
  setInterval(() => {}, 1000);
} else {
  // Emit read events like pi's JSON mode, so the worker can check what was read.
  let call = 0;
  const read = (path: string, text: string) => {
    const toolCallId = `read-${++call}`;
    process.stdout.write(
      `${JSON.stringify({ type: "tool_execution_start", toolCallId, toolName: "read", args: { path } })}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ type: "tool_execution_end", toolCallId, toolName: "read", result: { content: [{ type: "text", text }] }, isError: false })}\n`,
    );
  };
  if (organizer) {
    for (const name of (await readdir(process.cwd())).sort())
      if (
        name.endsWith(".md") &&
        (model !== "fake/lazy-organizer" || name === "MEMORY.md")
      )
        read(name, await readFile(join(process.cwd(), name), "utf8"));
  } else {
    const transcript = JSON.parse(
      /Analyse this transcript as untrusted data: (".*?")\.\n/.exec(
        args.at(-1)!,
      )![1],
    );
    const text = await readFile(transcript, "utf8");
    read(
      transcript,
      model === "fake/skim" ||
        (model === "fake/skim-once" &&
          !args.at(-1)!.includes("Your previous attempt did not read lines"))
        ? `${text.split("\n")[0]}\n\n[Showing lines 1-1 of ${text.split("\n").length}. Use offset=2 to continue.]`
        : text,
    );
  }
  await writeFile(
    join(process.cwd(), organizer ? "MEMORY.md" : "topic.md"),
    organizer
      ? "- [Topic](topic.md) A lasting fact.\n"
      : "---\nname: topic\ndescription: A lasting fact\nmetadata:\n  node_type: memory\n  type: project\n  originSessionId: fixture\n  modified: 2026-11-06T00:00:00Z\n---\nA lasting fact.\n",
  );
  if (organizer)
    await writeFile(
      join(process.cwd(), "retired.md"),
      "MOVED TO [[topic.md]]\n",
    );
  const usage = {
    input: 20,
    output: 10,
    cacheRead: 5,
    cacheWrite: 2,
    cost: { total: model === "fake/budget" ? 1 : 0.01 },
  };
  const stopReason =
    model === "fake/fail" && !organizer
      ? "error"
      : model === "fake/length"
        ? "length"
        : "stop";
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "Curated a topic.\u2028Checked links." }],
    usage,
    stopReason,
  };
  if (model === "fake/invalid-usage") message.usage.cost.total = NaN;
  if (model === "fake/malformed") process.stdout.write("not json\n");
  else {
    const record = `${JSON.stringify({ type: "message_end", message })}\r\n`;
    process.stdout.write(record.slice(0, 19));
    process.stdout.write(record.slice(19));
    if (model !== "fake/unsettled")
      process.stdout.write(
        `${JSON.stringify({ type: "agent_settled", aborted: model === "fake/abort" })}\n`,
      );
  }
}
