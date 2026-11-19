/**
 * Clean copy: makes text copied from Pi's fullscreen transcript paste as the
 * markdown it was rendered from.
 *
 * Fullscreen Pi copies selected screen rows as drawn, so a copied reply carries
 * box-drawn table borders (┌─┬─┐ │ ├─┼─┤), the message's one-column padding,
 * `│ ` quote bars, and a hard newline wherever a paragraph wrapped. Narrow
 * Ghostty branch panes wrap far more often. This rewrites the selection before
 * Pi puts it on the clipboard: tables become markdown tables, padding and
 * code-block indentation go, quote bars become `>`, and wrapped paragraphs are
 * rejoined. Wraps are checked against the session's own text so a long token
 * Pi broke at the edge (a URL, an ID, tool output) is not glued back with a
 * stray space.
 *
 * Pi has no public hook for this, so it wraps the fullscreen TUI's
 * `copySelection` callback, reached through a zero-height widget. If a Pi update
 * renames that callback, the hook silently does nothing and copying behaves as
 * stock. Regular (non-fullscreen) mode leaves selection to the terminal and is
 * unaffected.
 *
 * Set PI_CLEAN_COPY=off to disable. Set PI_CLEAN_COPY_LOG to a file path to
 * append each copy's raw and cleaned text, for diagnosing a bad conversion.
 * `/copy` still copies the last reply's raw markdown.
 */

import { appendFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { cleanCopiedText } from "./clean.mjs";

/** Pi's message padding on each side of transcript text. */
const TRANSCRIPT_PADDING = 2;
/** Recent entries to search when deciding how a wrapped line rejoins. */
const SOURCE_ENTRY_LIMIT = 200;
const HOOK = "__cleanCopy";

type CopySelection = (text: string) => Promise<boolean | string>;
/** Stored on the TUI so a reloaded extension instance can take over the existing wrapper. */
interface CleanCopyHook {
	original: CopySelection;
	clean: (text: string, columns: number) => string;
}
interface PatchableTui {
	terminal?: { columns?: number };
	copySelection?: CopySelection;
	[HOOK]?: CleanCopyHook;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const candidate = part as { type?: unknown; text?: unknown };
			return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
		})
		.join("\n");
}

function entryText(entry: SessionEntry): string {
	if (entry.type === "custom_message") return textOf(entry.content);
	if (entry.type !== "message") return "";
	return textOf(entry.message.content);
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_CLEAN_COPY === "off") return;
	let activeContext: ExtensionContext | undefined;
	let patchedTui: PatchableTui | undefined;

	const sessionSource = (): string | undefined => {
		try {
			const entries = activeContext?.sessionManager.getBranch() ?? [];
			const source = entries.slice(-SOURCE_ENTRY_LIMIT).map(entryText).filter(Boolean).join("\n");
			return source || undefined;
		} catch {
			return undefined;
		}
	};

	const clean = (text: string, columns: number): string => {
		const cleaned = cleanCopiedText(text, {
			wrapWidth: columns > TRANSCRIPT_PADDING ? columns - TRANSCRIPT_PADDING : undefined,
			source: sessionSource(),
		});
		const logPath = process.env.PI_CLEAN_COPY_LOG;
		if (logPath) {
			try {
				appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), columns, raw: text, cleaned })}\n`);
			} catch {
				// Diagnostics only.
			}
		}
		return cleaned;
	};

	/**
	 * Wrap the TUI's copy callback once per TUI. The hook lives on the TUI, so a
	 * /reload hands the existing wrapper to the new extension instance, and a
	 * renderer Pi swaps in later (after changing the TUI mode) is wrapped afresh
	 * on its next render.
	 */
	const patch = (tui: PatchableTui): void => {
		const existing = tui[HOOK];
		if (existing) {
			existing.clean = clean;
			return;
		}
		const original = tui.copySelection;
		if (typeof original !== "function") return;
		const hook: CleanCopyHook = { original, clean };
		tui[HOOK] = hook;
		tui.copySelection = async (text: string) => {
			let cleaned = text;
			try {
				cleaned = hook.clean(text, tui.terminal?.columns ?? 0) || text;
			} catch {
				cleaned = text;
			}
			return hook.original(cleaned);
		};
	};

	pi.on("session_start", (_event, ctx) => {
		activeContext = ctx;
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget(
			"clean-copy",
			(tui) => {
				const target = tui as unknown as PatchableTui;
				patchedTui = target;
				patch(target);
				return {
					render() {
						patch(target);
						return [];
					},
					invalidate() {},
				};
			},
			{ placement: "belowEditor" },
		);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		activeContext = undefined;
		// Leave copying untouched until a reloaded instance claims the hook.
		const hook = patchedTui?.[HOOK];
		if (hook) hook.clean = (text) => text;
		patchedTui = undefined;
		if (ctx.mode === "tui") ctx.ui.setWidget("clean-copy", undefined, { placement: "belowEditor" });
	});
}
