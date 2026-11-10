import type { ContextUsage, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Color, parseColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { FRAPPE, type FrappeColour, type Painter, type RepoInfo, renderFooter, type UsageSummary, summariseUsage } from "./format.ts";
import { findRepository } from "./repo.ts";

/** Status key pi-fast-lane publishes while fast mode is on, when its `footer.mode` is `status`. */
const FAST_STATUS_KEY = "pi-fast-lane";
const FAST_FRAME_MS = 100;

const COLOURS = Object.fromEntries(
    Object.entries(FRAPPE).map(([name, hex]) => [name, parseColor(hex)]),
) as Record<FrappeColour, Color>;

export default function (pi: ExtensionAPI) {
    let enabled = true;
    let repo: RepoInfo | undefined;

    function install(ctx: ExtensionContext) {
        ctx.ui.setFooter((tui, theme, footerData) => {
            const painter: Painter = {
                paint: (colour, text, bold) => theme.style(text, { fg: COLOURS[colour], bold }),
                width: visibleWidth,
                truncate: (text, maxWidth, ellipsis) => truncateToWidth(text, maxWidth, ellipsis),
            };

            // Usage and context scans cover the whole session, and the footer renders every frame.
            // Every append moves the leaf, so these values only change with the session, leaf, or model.
            let cacheKey: string | undefined;
            let usage: UsageSummary = summariseUsage([]);
            let contextUsage: ContextUsage | undefined;
            let subscription = false;

            const unsubscribe = footerData.onBranchChange(() => {
                repo = findRepository(ctx.sessionManager.getCwd());
                tui.requestRender();
            });

            // Redraws only while fast mode is on, so an idle footer costs nothing.
            let animation: ReturnType<typeof setInterval> | undefined;
            const animate = (on: boolean) => {
                if (on && !animation) {
                    animation = setInterval(() => tui.requestRender(), FAST_FRAME_MS);
                    animation.unref?.();
                } else if (!on && animation) {
                    clearInterval(animation);
                    animation = undefined;
                }
            };

            return {
                dispose() {
                    animate(false);
                    unsubscribe();
                },
                invalidate() {
                    cacheKey = undefined;
                },
                render(width: number): string[] {
                    try {
                        const sessionManager = ctx.sessionManager;
                        const model = ctx.model;
                        const key = `${sessionManager.getSessionId()}:${sessionManager.getLeafId()}:${model?.provider}/${model?.id}`;
                        if (key !== cacheKey) {
                            usage = summariseUsage(sessionManager.getEntries());
                            contextUsage = ctx.getContextUsage();
                            subscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
                            cacheKey = key;
                        }

                        const context = contextUsage
                            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow }
                            : model
                              ? { percent: 0, contextWindow: model.contextWindow }
                              : undefined;

                        // Ponytail's status sits beside the model, and fast mode is shown by the model's colours,
                        // so both stay off the third line.
                        const extensionStatuses = footerData.getExtensionStatuses();
                        const fast = extensionStatuses.has(FAST_STATUS_KEY);
                        animate(fast);
                        const statuses = Array.from(extensionStatuses.entries())
                            .filter(([key]) => key !== "ponytail" && key !== FAST_STATUS_KEY)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([, text]) => text);

                        return renderFooter(
                            {
                                cwd: sessionManager.getCwd(),
                                home: process.env.HOME ?? process.env.USERPROFILE,
                                repo,
                                branch: footerData.getGitBranch(),
                                sessionName: sessionManager.getSessionName(),
                                usage,
                                subscription,
                                context,
                                model: model ? { provider: model.provider, id: model.id, reasoning: Boolean(model.reasoning) } : undefined,
                                thinkingLevel: ctx.thinkingLevel ?? pi.getThinkingLevel(),
                                showProvider: footerData.getAvailableProviderCount() > 1,
                                fastFrame: fast ? Math.floor(Date.now() / FAST_FRAME_MS) : undefined,
                                ponytail: extensionStatuses.get("ponytail"),
                                statuses,
                            },
                            width,
                            painter,
                        );
                    } catch (error) {
                        // A throwing footer would break every frame; show the problem instead.
                        const message = error instanceof Error ? error.message : String(error);
                        return [truncateToWidth(painter.paint("red", `footer error: ${message} (/footer restores the built-in footer)`), width)];
                    }
                },
            };
        });
    }

    pi.on("session_start", async (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        repo = findRepository(ctx.sessionManager.getCwd());
        if (enabled) install(ctx);
    });

    pi.registerCommand("footer", {
        description: "Switch between the Catppuccin footer and Pi's built-in footer",
        handler: async (_args, ctx) => {
            if (ctx.mode !== "tui") {
                ctx.ui.notify("/footer only works in interactive mode", "warning");
                return;
            }
            enabled = !enabled;
            if (enabled) {
                repo = findRepository(ctx.sessionManager.getCwd());
                install(ctx);
            } else {
                ctx.ui.setFooter(undefined);
            }
            ctx.ui.notify(enabled ? "Catppuccin footer enabled" : "Built-in footer restored", "info");
        },
    });
}
