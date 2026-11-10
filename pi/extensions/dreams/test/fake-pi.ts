import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const model = args[args.indexOf("--model") + 1];
const promptPath = args[args.indexOf("--system-prompt") + 1];
const organizer = promptPath.endsWith("organizer.md");
for (const flag of ["--mode", "-p", "-ne", "-ns", "-nc", "-np", "--no-mcp", "-na", "--session-dir"]) assert.ok(args.includes(flag));
assert.equal(args[args.indexOf("--tools") + 1], "read,write,edit,grep,find,ls");
assert.equal(process.env.PI_DREAM_WRITE_ROOT, process.cwd());
assert.equal(JSON.parse(process.env.PI_DREAM_READ_ROOTS!).length, organizer ? 2 : 3);
assert.ok((await readFile(promptPath, "utf8")).length > 0);
if (model === "fake/hang" || model === "fake/ignore-term") {
  if (model === "fake/ignore-term") {
    process.on("SIGTERM", () => {});
    const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "inherit" });
    await writeFile(join(process.cwd(), "descendant.pid"), String(descendant.pid));
  }
  setInterval(() => {}, 1000);
} else {
  await writeFile(join(process.cwd(), organizer ? "MEMORY.md" : "topic.md"), organizer ? "- [Topic](topic.md) A lasting fact.\n" : "---\nname: topic\ndescription: A lasting fact\nmetadata:\n  node_type: memory\n  type: project\n  originSessionId: fixture\n  modified: 2026-11-06T00:00:00Z\n---\nA lasting fact.\n");
  if (organizer) await writeFile(join(process.cwd(), "retired.md"), "MOVED TO [[topic.md]]\n");
  const usage = { input: 20, output: 10, cacheRead: 5, cacheWrite: 2, cost: { total: model === "fake/budget" ? 1 : 0.01 } };
  const stopReason = model === "fake/fail" && !organizer ? "error" : model === "fake/length" ? "length" : "stop";
  const message = { role: "assistant", content: [{ type: "text", text: "Curated a topic.\u2028Checked links." }], usage, stopReason };
  if (model === "fake/invalid-usage") message.usage.cost.total = NaN;
  if (model === "fake/malformed") process.stdout.write("not json\n");
  else {
    const record = `${JSON.stringify({ type: "message_end", message })}\r\n`;
    process.stdout.write(record.slice(0, 19));
    process.stdout.write(record.slice(19));
    if (model !== "fake/unsettled") process.stdout.write(`${JSON.stringify({ type: "agent_settled", aborted: model === "fake/abort" })}\n`);
  }
}
