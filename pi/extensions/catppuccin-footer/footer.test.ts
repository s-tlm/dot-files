import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import {
    contextColour,
    displayPath,
    type FooterState,
    type FrappeColour,
    FRAPPE,
    formatTokens,
    ICONS,
    type Painter,
    RAINBOW,
    rainbowWave,
    renderFooter,
    sanitiseStatus,
    summariseUsage,
    thinkingColour,
} from "./format.ts";
import { findRepository } from "./repo.ts";

interface Paint {
    colour: FrappeColour;
    text: string;
    bold?: boolean;
}

/** Records colours and measures code points, which matches one-cell Nerd Font glyphs. */
function recordingPainter(): Painter & { calls: Paint[] } {
    const calls: Paint[] = [];
    return {
        calls,
        paint(colour, text, bold) {
            calls.push({ colour, text, bold });
            return text;
        },
        width: (text) => [...text].length,
        truncate(text, maxWidth, ellipsis = "") {
            const chars = [...text];
            if (chars.length <= maxWidth) return text;
            const ellipsisWidth = [...ellipsis].length;
            if (maxWidth <= ellipsisWidth) return chars.slice(0, maxWidth).join("");
            return chars.slice(0, maxWidth - ellipsisWidth).join("") + ellipsis;
        },
    };
}

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number, cost: number) => ({
    input,
    output,
    cacheRead,
    cacheWrite,
    cost: { total: cost },
});

function state(overrides: Partial<FooterState> = {}): FooterState {
    return {
        cwd: "/home/sam/code/pi",
        home: "/home/sam",
        repo: { name: "pi", root: "/home/sam/code/pi" },
        branch: "main",
        usage: summariseUsage([]),
        subscription: false,
        context: { percent: 23.4, contextWindow: 1000000 },
        model: { provider: "anthropic", id: "claude-opus-5-5", reasoning: true },
        thinkingLevel: "high",
        showProvider: true,
        statuses: [],
        ...overrides,
    };
}

const PONYTAIL = "● 🐴 ponytail: ⚡ FULL";

function paintFor(calls: readonly Paint[], fragment: string): Paint | undefined {
    return calls.find((call) => call.text.includes(fragment));
}

describe("summariseUsage", () => {
    test("sums every usage source like the built-in footer", () => {
        const summary = summariseUsage([
            { type: "message", message: { role: "user" } },
            { type: "message", message: { role: "assistant", usage: usage(100, 20, 300, 50, 0.5) } },
            { type: "usage", usage: usage(10, 2, 0, 0, 0.01) },
            { type: "message", message: { role: "toolResult", usage: usage(5, 1, 0, 0, 0.02) } },
            { type: "message", message: { role: "toolResult" } },
            { type: "compaction", usage: usage(7, 3, 0, 0, 0.03) },
            { type: "branch_summary", usage: usage(1, 1, 1, 1, 0.04) },
            { type: "custom" },
        ]);
        const { cost, ...tokens } = summary.totals;
        assert.deepEqual(tokens, { input: 123, output: 27, cacheRead: 301, cacheWrite: 51 });
        assert.ok(Math.abs(cost - 0.6) < 1e-9, `cost ${cost}`);
    });

    test("uses the latest assistant response for the cache hit rate", () => {
        const summary = summariseUsage([
            { type: "message", message: { role: "assistant", usage: usage(100, 0, 0, 0, 0) } },
            { type: "message", message: { role: "assistant", usage: usage(25, 0, 75, 0, 0) } },
        ]);
        assert.equal(summary.cacheHitRate, 75);
    });

    test("leaves the cache hit rate unknown when the latest response has no prompt tokens", () => {
        const summary = summariseUsage([
            { type: "message", message: { role: "assistant", usage: usage(25, 0, 75, 0, 0) } },
            { type: "message", message: { role: "assistant", usage: usage(0, 5, 0, 0, 0) } },
        ]);
        assert.equal(summary.cacheHitRate, undefined);
    });

    test("tolerates missing usage fields", () => {
        const summary = summariseUsage([{ type: "usage", usage: { input: 3 } }]);
        assert.deepEqual(summary.totals, { input: 3, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
    });
});

describe("formatting helpers", () => {
    test("formats tokens at each boundary", () => {
        assert.equal(formatTokens(0), "0");
        assert.equal(formatTokens(999), "999");
        assert.equal(formatTokens(1000), "1.0k");
        assert.equal(formatTokens(9949), "9.9k");
        assert.equal(formatTokens(10000), "10k");
        assert.equal(formatTokens(999499), "999k");
        assert.equal(formatTokens(1000000), "1.0M");
        assert.equal(formatTokens(12345678), "12M");
    });

    test("shortens only paths inside the home directory", () => {
        assert.equal(displayPath("/home/sam", "/home/sam"), "~");
        assert.equal(displayPath("/home/sam/code", "/home/sam"), "~/code");
        assert.equal(displayPath("/home/samuel/code", "/home/sam"), "/home/samuel/code");
        assert.equal(displayPath("/tmp", "/home/sam"), "/tmp");
        assert.equal(displayPath("/tmp", undefined), "/tmp");
    });

    test("colours context usage at the built-in thresholds", () => {
        assert.equal(contextColour(null), "overlay1");
        assert.equal(contextColour(0), "green");
        assert.equal(contextColour(70), "green");
        assert.equal(contextColour(70.1), "yellow");
        assert.equal(contextColour(90), "yellow");
        assert.equal(contextColour(90.1), "red");
    });

    test("colours each thinking level", () => {
        const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "unexpected"];
        assert.deepEqual(levels.map(thinkingColour), [
            "overlay0",
            "teal",
            "sky",
            "blue",
            "mauve",
            "pink",
            "red",
            "overlay0",
        ]);
    });

    test("collapses status text to one line", () => {
        assert.equal(sanitiseStatus("  a\tb\n\r  c  "), "a b c");
    });

    test("uses the Catppuccin Frappé palette", () => {
        assert.equal(Object.keys(FRAPPE).length, 26);
        assert.equal(FRAPPE.base, "#303446");
        assert.equal(FRAPPE.mauve, "#ca9ee6");
        for (const glyph of Object.values(ICONS)) {
            assert.equal([...glyph].length, 1);
            assert.ok(glyph.codePointAt(0)! <= 0xffff, "glyphs stay in the Basic Multilingual Plane");
        }
    });
});

describe("renderFooter location line", () => {
    test("shows the repository and branch at the repository root", () => {
        const painter = recordingPainter();
        const [location] = renderFooter(state(), 100, painter);
        assert.ok(location.startsWith(`${ICONS.repo} pi  ${ICONS.branch} main`));
        assert.deepEqual(paintFor(painter.calls, `${ICONS.repo} pi`), { colour: "mauve", text: `${ICONS.repo} pi`, bold: true });
        assert.equal(paintFor(painter.calls, "main")?.colour, "green");
        assert.equal(painter.calls.some((call) => call.colour === "subtext0"), false);
    });

    test("adds the folder inside the repository", () => {
        const painter = recordingPainter();
        const [location] = renderFooter(state({ cwd: "/home/sam/code/pi/models/staging" }), 100, painter);
        assert.ok(location.includes(`main  models/staging`));
        assert.equal(paintFor(painter.calls, "models/staging")?.colour, "subtext0");
    });

    test("shows the folder outside Git", () => {
        const painter = recordingPainter();
        const [location] = renderFooter(state({ cwd: "/home/sam/notes", repo: undefined, branch: null }), 100, painter);
        assert.equal(location.trimEnd(), `${ICONS.folder} ~/notes`);
        assert.equal(paintFor(painter.calls, "~/notes")?.colour, "blue");
    });

    test("highlights a detached HEAD", () => {
        const painter = recordingPainter();
        const [location] = renderFooter(state({ branch: "detached" }), 100, painter);
        assert.ok(location.includes(`${ICONS.detached} detached`));
        assert.equal(paintFor(painter.calls, "detached")?.colour, "peach");
    });

    test("keeps the branch when repository detection fails", () => {
        const [location] = renderFooter(state({ repo: undefined, cwd: "/srv/app" }), 100, recordingPainter());
        assert.equal(location.trimEnd(), `${ICONS.folder} /srv/app  ${ICONS.branch} main`);
    });

    test("right-aligns the session name", () => {
        const painter = recordingPainter();
        const [location] = renderFooter(state({ sessionName: "dbt\nrefactor" }), 60, painter);
        assert.ok(location.endsWith(`${ICONS.session} dbt refactor`));
        assert.equal([...location].length, 60);
        assert.equal(paintFor(painter.calls, "dbt refactor")?.colour, "lavender");
    });
});

describe("renderFooter metrics line", () => {
    const busyUsage = summariseUsage([
        { type: "message", message: { role: "assistant", usage: usage(12000, 3400, 80000, 5000, 0.42) } },
    ]);

    test("shows tokens, cache, cost, context, model, and thinking level", () => {
        const painter = recordingPainter();
        const [, metrics] = renderFooter(state({ usage: busyUsage }), 140, painter);
        assert.ok(metrics.startsWith(`↑12k ↓3.4k │ R80k W5.0k CH 82.5% │ $0.420 │ ${ICONS.context} 23.4%/1.0M`));
        assert.ok(metrics.endsWith(`${ICONS.model} anthropic claude-opus-5-5 · ${ICONS.thinking} high`));
        assert.equal(paintFor(painter.calls, "↑12k")?.colour, "sapphire");
        assert.equal(paintFor(painter.calls, "↓3.4k")?.colour, "teal");
        assert.equal(paintFor(painter.calls, "CH 82.5%")?.colour, "green");
        assert.equal(paintFor(painter.calls, "$0.420")?.colour, "yellow");
        assert.equal(paintFor(painter.calls, "23.4%")?.colour, "green");
        assert.equal(paintFor(painter.calls, "claude-opus-5-5")?.colour, "blue");
        assert.equal(paintFor(painter.calls, "high")?.colour, "mauve");
        assert.equal(paintFor(painter.calls, "│")?.colour, "surface2");
    });

    test("tags subscription usage even before any cost", () => {
        const painter = recordingPainter();
        const [, metrics] = renderFooter(state({ subscription: true }), 120, painter);
        assert.ok(metrics.startsWith(`$0.000 sub │ ${ICONS.context} 23.4%/1.0M`));
        assert.equal(paintFor(painter.calls, "sub")?.colour, "overlay1");
    });

    test("omits zero cost for paid usage", () => {
        const [, metrics] = renderFooter(state(), 120, recordingPainter());
        assert.ok(metrics.startsWith(`${ICONS.context} 23.4%/1.0M`));
    });

    test("shows unknown context after compaction", () => {
        const painter = recordingPainter();
        const [, metrics] = renderFooter(state({ context: { percent: null, contextWindow: 200000 } }), 120, painter);
        assert.ok(metrics.startsWith(`${ICONS.context} ?/200k`));
        assert.equal(paintFor(painter.calls, "?")?.colour, "overlay1");
    });

    test("warns as context fills", () => {
        const painter = recordingPainter();
        renderFooter(state({ context: { percent: 95, contextWindow: 200000 } }), 120, painter);
        assert.equal(paintFor(painter.calls, "95.0%")?.colour, "red");
    });

    test("omits the thinking level for models without reasoning", () => {
        const model = { provider: "ollama", id: "qwen", reasoning: false };
        const [, metrics] = renderFooter(state({ model, showProvider: false }), 80, recordingPainter());
        assert.ok(metrics.endsWith(`${ICONS.model} qwen`));
        assert.equal(metrics.includes(ICONS.thinking), false);
    });

    test("shows when no model is selected", () => {
        const [, metrics] = renderFooter(state({ model: undefined, context: undefined }), 40, recordingPainter());
        assert.equal(metrics.trimStart(), `${ICONS.model} no model`);
    });

    test("drops the provider before truncating the model", () => {
        // The context group needs 12 columns, the full model label 36, and the compact label 26.
        const wide = renderFooter(state(), 50, recordingPainter())[1];
        const narrow = renderFooter(state(), 49, recordingPainter())[1];
        const tiny = renderFooter(state(), 30, recordingPainter())[1];
        assert.ok(wide.includes("anthropic claude-opus-5-5"));
        assert.ok(narrow.endsWith(`${ICONS.model} claude-opus-5-5 · ${ICONS.thinking} high`));
        assert.equal(narrow.includes("anthropic"), false);
        assert.ok(tiny.startsWith(`${ICONS.context} 23.4%/1.0M  `));
        assert.equal([...tiny].length, 30);
    });

    test("shows the ponytail status before the model", () => {
        const painter = recordingPainter();
        const [, metrics] = renderFooter(state({ ponytail: PONYTAIL }), 120, painter);
        assert.ok(metrics.endsWith(`${PONYTAIL} │ ${ICONS.model} anthropic claude-opus-5-5 · ${ICONS.thinking} high`));
        assert.ok(metrics.startsWith(`${ICONS.context} 23.4%/1.0M  `));
        assert.deepEqual(paintFor(painter.calls, "│"), { colour: "surface2", text: " │ ", bold: undefined });
    });

    test("collapses the ponytail status and ignores a blank one", () => {
        const [, collapsed] = renderFooter(state({ ponytail: "🐴\nFULL" }), 80, recordingPainter());
        assert.ok(collapsed.includes(`🐴 FULL │ ${ICONS.model}`));
        const [, blank] = renderFooter(state({ ponytail: " \n " }), 80, recordingPainter());
        assert.equal(blank, renderFooter(state(), 80, recordingPainter())[1]);
    });

    test("drops the provider, then the ponytail status, before truncating the model", () => {
        // The context group needs 12 columns, the ponytail status and separator 23, and the model labels 36 or 26.
        const render = (width: number) => renderFooter(state({ ponytail: PONYTAIL }), width, recordingPainter())[1];
        const compact = `${ICONS.model} claude-opus-5-5 · ${ICONS.thinking} high`;
        assert.ok(render(73).endsWith(`${PONYTAIL} │ ${ICONS.model} anthropic claude-opus-5-5 · ${ICONS.thinking} high`));
        assert.ok(render(72).endsWith(`${PONYTAIL} │ ${compact}`));
        assert.equal(render(72).includes("anthropic"), false);
        assert.ok(render(63).endsWith(`${PONYTAIL} │ ${compact}`));
        assert.ok(render(62).endsWith(`  ${compact}`));
        assert.equal(render(62).includes("ponytail"), false);
        assert.ok(render(40).endsWith(`  ${compact}`));
        const tiny = render(30);
        assert.equal(tiny.includes("ponytail"), false);
        assert.equal([...tiny].length, 30);
    });
});

describe("rainbowWave", () => {
    test("paints each letter the next rainbow colour and keeps the text", () => {
        const painter = recordingPainter();
        assert.equal(rainbowWave("abc", 0, painter), "abc");
        assert.deepEqual(painter.calls.map((call) => call.colour), RAINBOW.slice(0, 3));
    });

    test("shifts the colours one letter per frame, including past the palette's end", () => {
        const colours = (frame: number) => {
            const painter = recordingPainter();
            rainbowWave("abcdefghijklmn", frame, painter);
            return painter.calls.map((call) => call.colour);
        };
        assert.deepEqual(colours(1).slice(1), colours(0).slice(0, -1));
        assert.equal(colours(1)[0], RAINBOW.at(-1));
        assert.deepEqual(colours(RAINBOW.length), colours(0));
        assert.deepEqual(colours(-3), colours(-3 + RAINBOW.length));
    });

    test("moves a bold crest through the text", () => {
        const crest = (frame: number) => {
            const painter = recordingPainter();
            rainbowWave("a".repeat(20), frame, painter);
            return painter.calls.findIndex((call) => call.bold);
        };
        assert.ok(crest(0) >= 0);
        assert.equal(crest(1), crest(0) + 1);
    });

    test("handles empty text", () => {
        assert.equal(rainbowWave("", 5, recordingPainter()), "");
    });
});

describe("renderFooter fast mode", () => {
    test("draws only the model name as a rainbow wave", () => {
        const painter = recordingPainter();
        const [, metrics] = renderFooter(state({ fastFrame: 0 }), 120, painter);
        assert.ok(metrics.endsWith(`${ICONS.model} anthropic claude-opus-5-5 · ${ICONS.thinking} high`));
        const letters = painter.calls.filter((call) => call.text.length === 1 && "claude-opus-5-5".includes(call.text));
        assert.deepEqual(letters.map((call) => call.colour), [...RAINBOW, ...RAINBOW].slice(0, 15));
        assert.equal(paintFor(painter.calls, "anthropic")?.colour, "overlay1");
    });

    test("keeps the plain blue model name when fast mode is off", () => {
        const painter = recordingPainter();
        renderFooter(state(), 120, painter);
        assert.deepEqual(paintFor(painter.calls, "claude-opus-5-5"), { colour: "blue", text: "claude-opus-5-5", bold: undefined });
    });

    test("keeps fast-mode lines within every width", () => {
        for (let width = 0; width <= 120; width += 1) {
            for (const line of renderFooter(state({ fastFrame: 7, ponytail: PONYTAIL }), width, recordingPainter())) {
                assert.ok([...line].length <= width, `width ${width}: ${line}`);
            }
        }
    });
});

describe("renderFooter statuses and widths", () => {
    test("adds other extensions' statuses on a third line", () => {
        const lines = renderFooter(state({ statuses: ["one\ntwo", "  ", "three"] }), 80, recordingPainter());
        assert.equal(lines.length, 3);
        assert.equal(lines[2], "one two three");
    });

    test("omits the status line when there are no statuses", () => {
        assert.equal(renderFooter(state(), 80, recordingPainter()).length, 2);
    });

    test("keeps the ponytail status off the third line", () => {
        const lines = renderFooter(state({ ponytail: PONYTAIL, statuses: ["other"] }), 120, recordingPainter());
        assert.equal(lines.length, 3);
        assert.ok(lines[1].includes(PONYTAIL));
        assert.equal(lines[2], "other");
    });

    test("never exceeds the available width", () => {
        const busy = state({
            cwd: "/home/sam/code/pi/a/very/long/path/inside/the/repository",
            branch: "feat/an-unusually-long-branch-name",
            sessionName: "a long session name",
            subscription: true,
            usage: summariseUsage([
                { type: "message", message: { role: "assistant", usage: usage(1234567, 76543, 9876543, 12345, 12.3456) } },
            ]),
            ponytail: PONYTAIL,
            statuses: ["status text that is longer than a narrow terminal"],
        });
        for (let width = 0; width <= 160; width += 1) {
            for (const line of renderFooter(busy, width, recordingPainter())) {
                assert.ok([...line].length <= width, `width ${width}: ${line}`);
            }
        }
    });
});

describe("findRepository", () => {
    const root = mkdtempSync(join(tmpdir(), "catppuccin-footer-"));
    after(() => rmSync(root, { recursive: true, force: true }));

    test("finds a normal repository from a nested folder", () => {
        const repo = join(root, "normal");
        mkdirSync(join(repo, ".git"), { recursive: true });
        mkdirSync(join(repo, "models", "staging"), { recursive: true });
        assert.deepEqual(findRepository(join(repo, "models", "staging")), { name: "normal", root: repo });
    });

    test("names a worktree after its main repository", () => {
        const main = join(root, "analytics");
        const gitDir = join(main, ".git", "worktrees", "feature");
        const worktree = join(root, "analytics-feature");
        mkdirSync(gitDir, { recursive: true });
        mkdirSync(worktree, { recursive: true });
        writeFileSync(join(gitDir, "commondir"), "../..\n");
        writeFileSync(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
        assert.deepEqual(findRepository(worktree), { name: "analytics", root: worktree });
    });

    test("names a worktree of a bare repository without the .git suffix", () => {
        const gitDir = join(root, "infra.git", "worktrees", "dev");
        const worktree = join(root, "infra-dev");
        mkdirSync(gitDir, { recursive: true });
        mkdirSync(worktree, { recursive: true });
        writeFileSync(join(gitDir, "commondir"), "../..\n");
        writeFileSync(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
        assert.deepEqual(findRepository(worktree), { name: "infra", root: worktree });
    });

    test("keeps a submodule's own name", () => {
        const parent = join(root, "parent");
        const submodule = join(parent, "vendor", "macros");
        mkdirSync(join(parent, ".git", "modules", "macros"), { recursive: true });
        mkdirSync(submodule, { recursive: true });
        writeFileSync(join(submodule, ".git"), "gitdir: ../../.git/modules/macros\n");
        assert.deepEqual(findRepository(submodule), { name: "macros", root: submodule });
    });

    test("returns nothing outside Git", () => {
        const plain = join(root, "plain");
        mkdirSync(plain, { recursive: true });
        assert.equal(findRepository(plain), undefined);
    });

    test("returns nothing for unreadable Git metadata", () => {
        const broken = join(root, "broken");
        mkdirSync(broken, { recursive: true });
        writeFileSync(join(broken, ".git"), "not a pointer\n");
        assert.equal(findRepository(broken), undefined);
    });
});

/** Optional check against Pi's real ANSI and width handling. Set PI_TUI_MODULE to pi-tui's dist/index.js. */
const tuiModule = process.env.PI_TUI_MODULE;
describe("renderFooter with pi-tui", { skip: tuiModule ? false : "PI_TUI_MODULE is not set" }, () => {
    test("keeps styled lines within every width", async () => {
        const tui = await import(pathToFileURL(tuiModule!).href);
        const painter: Painter = {
            paint: (colour, text, bold) => tui.styleText(text, { fg: tui.parseColor(FRAPPE[colour]), bold }, "truecolor"),
            width: tui.visibleWidth,
            truncate: (text, maxWidth, ellipsis) => tui.truncateToWidth(text, maxWidth, ellipsis),
        };
        const busy = state({
            branch: "feat/an-unusually-long-branch-name",
            sessionName: "long session",
            subscription: true,
            ponytail: PONYTAIL,
            statuses: ["another extension status"],
        });
        const [location] = renderFooter(busy, 100, painter);
        assert.ok(location.includes("\x1b[38;2;202;158;230m"), "repository name uses Frappé mauve");
        for (let width = 0; width <= 160; width += 1) {
            for (const line of renderFooter(busy, width, painter)) {
                assert.ok(tui.visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
            }
        }
    });
});
