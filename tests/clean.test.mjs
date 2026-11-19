import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { cleanCopiedText } from "../extensions/clean-copy/clean.mjs";

/**
 * The round-trip tests render with Pi's own Markdown component. Pi supplies
 * pi-tui at runtime, so it is not a dependency: CI installs it with --no-save,
 * and inside a Pi session PI_PACKAGE_DIR points at Pi's copy. PI_TUI_MODULE
 * overrides both. Without any of them those tests skip.
 */
async function loadPiTui() {
	const candidates = [
		process.env.PI_TUI_MODULE,
		"@earendil-works/pi-tui",
		process.env.PI_PACKAGE_DIR &&
			join(process.env.PI_PACKAGE_DIR, "node_modules", "@earendil-works", "pi-tui", "dist", "index.js"),
	].filter(Boolean);
	for (const candidate of candidates) {
		const specifier = existsSync(candidate) ? pathToFileURL(candidate).href : candidate;
		try {
			return await import(specifier);
		} catch {
			// Try the next location.
		}
	}
	return undefined;
}

const tui = await loadPiTui();
const skip = tui ? false : "pi-tui not found; set PI_TUI_MODULE or run npm install --no-save @earendil-works/pi-tui";

const plain = (text) => text;
const THEME = {
	heading: plain,
	link: plain,
	linkUrl: plain,
	code: (text) => `\x1b[36m${text}\x1b[39m`,
	codeBlock: plain,
	codeBlockBorder: plain,
	quote: plain,
	quoteBorder: plain,
	hr: plain,
	listBullet: plain,
	bold: (text) => `\x1b[1m${text}\x1b[22m`,
	italic: plain,
	strikethrough: plain,
	underline: plain,
};

/**
 * Render markdown the way Pi renders an assistant reply in a pane `columns`
 * wide, then copy every row the way TuiAltScreen.getActiveSelectionText does.
 */
function renderAndCopy(markdown, columns) {
	const component = new tui.Markdown(markdown, 1, 0, THEME);
	return component
		.render(columns)
		.map((line) => tui.stripTerminalSequences(line).trimEnd())
		.join("\n");
}

const clean = (copied, columns, source) => cleanCopiedText(copied, { wrapWidth: columns - 2, source });

test("box-drawn tables copy as markdown tables", { skip }, () => {
	const markdown = [
		"| PR | Status | Notes |",
		"| --- | --- | --- |",
		"| #101 | merged | Shipped the new settings page behind a feature flag for every eligible account |",
		"| #102 | open | Waiting on design review |",
	].join("\n");
	const copied = renderAndCopy(markdown, 60);
	assert.match(copied, /┌─/, "the renderer draws a box table");
	assert.equal(
		clean(copied, 60, markdown),
		[
			"| PR | Status | Notes |",
			"| --- | --- | --- |",
			"| #101 | merged | Shipped the new settings page behind a feature flag for every eligible account |",
			"| #102 | open | Waiting on design review |",
		].join("\n"),
	);
});

test("wrapped paragraphs and list items rejoin; padding goes", { skip }, () => {
	const markdown = [
		"The sidebar now offers Minimize, which shrinks a pane to a narrow strip while Pi keeps running underneath it.",
		"",
		"- Expanding restores the size the pane had before it was minimized, measured in cells.",
		"- Dragging the divider back also counts as expanding.",
	].join("\n");
	const words = (text) => text.split(/\s+/).filter(Boolean);
	for (const columns of [40, 57, 80]) {
		const copied = renderAndCopy(markdown, columns);
		assert.equal(clean(copied, columns, markdown), markdown, `at ${columns} columns`);
		// Without source text, lines that reach the edge keep their newline, but no
		// words are ever glued together or lost.
		const fallback = clean(copied, columns);
		assert.deepEqual(words(fallback), words(markdown), `at ${columns} columns without source text`);
		assert.ok(fallback.split("\n").length < copied.split("\n").length, `at ${columns} columns some wraps rejoin`);
	}
});

test("code blocks lose Pi's indentation and keep their lines", { skip }, () => {
	const markdown = ["Run this:", "", "```sh", "cd ~/src/app", "  node --test tests/*.test.mjs", "```"].join("\n");
	const copied = renderAndCopy(markdown, 60);
	assert.equal(clean(copied, 60, markdown), markdown);
});

test("quotes and rules come back as markdown", { skip }, () => {
	const markdown = ["> Quoted text stays quoted.", "", "---", "", "After the rule."].join("\n");
	const copied = renderAndCopy(markdown, 60);
	assert.equal(clean(copied, 60, markdown), markdown);
});

test("a token Pi broke at the edge rejoins without a space when the source shows it", { skip }, () => {
	const url = "https://example.com/acme/widgets/pull/101/files?file=app/models/settings/notification_preferences.rb";
	const markdown = `See ${url} for the change.`;
	const copied = renderAndCopy(markdown, 50);
	assert.ok(copied.split("\n").length > 2, "the URL wraps");
	assert.equal(clean(copied, 50, markdown), markdown);
});

test("without source text a full line is never glued with a guessed space", () => {
	const copied = [" abcdefghij", " klmnop"].join("\n");
	assert.equal(cleanCopiedText(copied, { wrapWidth: 10 }), "abcdefghij\nklmnop");
});

test("short lines that were not wrapped keep their newlines", () => {
	const copied = [" total 64", " drwxr-xr-x  3 james  staff", " -rw-r--r--  1 james  staff"].join("\n");
	const source = "total 64\ndrwxr-xr-x  3 james  staff\n-rw-r--r--  1 james  staff";
	assert.equal(cleanCopiedText(copied, { wrapWidth: 78, source }), source);
});

test("a selection starting mid-line keeps the rest of its lines aligned", () => {
	const copied = ["second half of a line", " - next item", " - last item"].join("\n");
	assert.equal(cleanCopiedText(copied, { wrapWidth: 78 }), "second half of a line\n- next item\n- last item");
});

test("the copied table from the bug report converts", () => {
	const copied = [
		" Open pull requests",
		"",
		" ┌───────┬────────┬──────────┐",
		" │ PR    │ Status │ CI       │",
		" ├───────┼────────┼──────────┤",
		" │ #101 │ open   │ green    │",
		" ├───────┼────────┼──────────┤",
		" │ #102 │ draft  │ 2 failed │",
		" └───────┴────────┴──────────┘",
	].join("\n");
	assert.equal(
		cleanCopiedText(copied, { wrapWidth: 268 }),
		[
			"Open pull requests",
			"",
			"| PR | Status | CI |",
			"| --- | --- | --- |",
			"| #101 | open | green |",
			"| #102 | draft | 2 failed |",
		].join("\n"),
	);
});

test("a single copied table row stays a single row", () => {
	assert.equal(cleanCopiedText(" │ #101 │ open   │ green    │", { wrapWidth: 78 }), "| #101 | open | green |");
});
