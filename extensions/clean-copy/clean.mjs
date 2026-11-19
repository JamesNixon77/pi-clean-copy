/**
 * Turn text copied from Pi's fullscreen transcript back into the markdown it was
 * rendered from.
 *
 * Pi's fullscreen selection copies rendered screen rows, so a copy picks up the
 * message's one-column padding, box-drawn table borders, `│ ` quote bars, and a
 * newline wherever a paragraph wrapped at the pane width. Narrow branch panes
 * make the wrapping much worse.
 */

const TABLE_TOP = /^┌─.*─┐$/;
const TABLE_SEPARATOR = /^├─.*─┤$/;
const TABLE_BOTTOM = /^└─.*─┘$/;
const TABLE_ROW = /^│ .* │$/;
const TABLE_DIVIDERS = new Set(["┬", "┼", "┴"]);
const FENCE = /^```/;
const RULE = /^─{3,}$/;
const LIST_ITEM = /^([-*+]|\d+[.)]) (\[[ xX]\] )?/;
const BLOCK_START = /^(#{1,6} |> |\||```|[-*+] |\d+[.)] )/;
/** Pi indents code block lines by two columns inside their fences. */
const CODE_BLOCK_INDENT = 2;

function isTableLine(trimmed) {
	return TABLE_TOP.test(trimmed) || TABLE_SEPARATOR.test(trimmed) || TABLE_BOTTOM.test(trimmed) || TABLE_ROW.test(trimmed);
}

function leadingSpaces(line) {
	return line.length - line.trimStart().length;
}

/** Terminal cell width, close enough for deciding where Pi wrapped a line. */
function cellWidth(text) {
	let width = 0;
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		const wide =
			(code >= 0x1100 && code <= 0x115f) ||
			(code >= 0x2e80 && code <= 0xa4cf) ||
			(code >= 0xac00 && code <= 0xd7a3) ||
			(code >= 0xf900 && code <= 0xfaff) ||
			(code >= 0xfe30 && code <= 0xfe4f) ||
			(code >= 0xff00 && code <= 0xff60) ||
			(code >= 0xffe0 && code <= 0xffe6) ||
			(code >= 0x1f300 && code <= 0x1faff);
		width += wide ? 2 : 1;
	}
	return width;
}

/**
 * Normalize source text the way rendering does, so a phrase that wrapped on
 * screen can be looked up in it: drop emphasis and code markers and collapse
 * whitespace.
 */
export function normalizeSource(text) {
	return text.replace(/[*`]/g, "").replace(/\s+/g, " ");
}

/**
 * Remove the padding Pi adds to every transcript line. The first line is left
 * out of the measurement because a selection can start partway through it.
 */
function dedent(lines) {
	const measured = lines.slice(1).filter((line) => line.trim());
	const candidates = measured.length > 0 ? measured : lines.filter((line) => line.trim());
	if (candidates.length === 0) return lines;
	const common = Math.min(...candidates.map(leadingSpaces));
	if (common === 0) return lines;
	return lines.map((line) => line.slice(Math.min(common, leadingSpaces(line))));
}

/**
 * Decide how to rejoin two pieces of text that a wrap split, or return
 * undefined to keep the newline. With source text, use it to tell a wrap at a
 * space from a long token broken mid-word. Without it, only rejoin at a space
 * when the line stopped short of the edge, since a full line may be a token Pi
 * broke at the width.
 */
function joinSeparator(before, after, { corpus, lineWasFull }) {
	const tail = normalizeSource(before.trimEnd().split(" ").pop() ?? "");
	const head = normalizeSource(after.trimStart().split(" ")[0] ?? "");
	if (corpus && tail && head) {
		if (corpus.includes(`${tail} ${head}`)) return " ";
		if (corpus.includes(`${tail}${head}`)) return "";
		return undefined;
	}
	return lineWasFull ? undefined : " ";
}

function splitTableRow(line, border) {
	if (border && border.length === line.length) {
		const dividers = [];
		for (let index = 0; index < border.length; index++) {
			if (TABLE_DIVIDERS.has(border[index])) dividers.push(index);
		}
		if (dividers.every((index) => line[index] === "│")) {
			const bounds = [0, ...dividers, line.length - 1];
			return bounds.slice(0, -1).map((start, column) => line.slice(start + 1, bounds[column + 1]).trim());
		}
	}
	// Wide characters shift columns, so fall back to the cell borders themselves.
	return line
		.slice(1, -1)
		.split("│")
		.map((cell) => cell.trim());
}

/**
 * Rebuild a markdown table from Pi's box-drawn one. Pi separates every row with
 * a rule and wraps long cells onto extra lines, so the lines between two rules
 * are one row whose cell fragments join back together.
 */
function convertTable(block, indent, corpus) {
	const border = block.find((line) => !TABLE_ROW.test(line));
	const rows = [];
	let fragments;
	const finishRow = () => {
		if (!fragments) return;
		rows.push(
			fragments.map((parts) =>
				parts.filter(Boolean).reduce((cell, part) => {
					if (!cell) return part;
					return cell + (joinSeparator(cell, part, { corpus, lineWasFull: false }) ?? " ") + part;
				}, ""),
			),
		);
		fragments = undefined;
	};
	for (const line of block) {
		if (!TABLE_ROW.test(line)) {
			finishRow();
			continue;
		}
		const cells = splitTableRow(line, border);
		fragments ??= [];
		cells.forEach((cell, column) => {
			fragments[column] ??= [];
			fragments[column].push(cell);
		});
	}
	finishRow();
	if (rows.length === 0) return [];
	const columns = Math.max(...rows.map((row) => row.length));
	const format = (row) =>
		`${indent}| ${Array.from({ length: columns }, (_, column) => (row[column] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
	// A lone row, such as a triple-clicked line, is not a whole table and gets no header rule.
	if (rows.length === 1 && !block.some((line) => TABLE_TOP.test(line))) return [format(rows[0])];
	return [format(rows[0]), `${indent}| ${Array(columns).fill("---").join(" | ")} |`, ...rows.slice(1).map(format)];
}

/**
 * @param {string} text Text as Pi's fullscreen selection copied it.
 * @param {{ wrapWidth?: number, source?: string }} [options]
 *   wrapWidth: the width Pi wrapped transcript text to, which is the pane's
 *   columns minus the message padding. Without it, paragraphs stay as copied.
 *   source: the session text the selection came from, used to rejoin wraps
 *   without guessing at spaces.
 */
export function cleanCopiedText(text, options = {}) {
	const wrapWidth = options.wrapWidth && options.wrapWidth > 0 ? options.wrapWidth : undefined;
	const corpus = options.source ? normalizeSource(options.source) : undefined;
	const lines = dedent(
		text
			.replace(/\r\n?/g, "\n")
			.split("\n")
			.map((line) => line.trimEnd()),
	);

	const output = [];
	/** The previous line, as rendered, while it is prose that a wrap could continue. */
	let paragraph;
	let fenceIndent;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const trimmed = line.trim();
		const indent = leadingSpaces(line);

		if (fenceIndent !== undefined) {
			if (FENCE.test(trimmed)) {
				fenceIndent = undefined;
				output.push(line);
			} else {
				const codeIndent = fenceIndent + CODE_BLOCK_INDENT;
				output.push(indent >= codeIndent ? " ".repeat(fenceIndent) + line.slice(codeIndent) : line);
			}
			continue;
		}

		if (FENCE.test(trimmed)) {
			fenceIndent = indent;
			paragraph = undefined;
			output.push(line);
			continue;
		}

		if (isTableLine(trimmed)) {
			const block = [];
			while (index < lines.length && isTableLine(lines[index].trim())) block.push(lines[index++].trim());
			index--;
			output.push(...convertTable(block, " ".repeat(indent), corpus));
			paragraph = undefined;
			continue;
		}

		if (RULE.test(trimmed)) {
			output.push(`${" ".repeat(indent)}---`);
			paragraph = undefined;
			continue;
		}

		if (trimmed === "│" || trimmed.startsWith("│ ")) {
			output.push(`${" ".repeat(indent)}> ${trimmed.slice(2)}`);
			paragraph = undefined;
			continue;
		}

		if (!trimmed) {
			output.push("");
			paragraph = undefined;
			continue;
		}

		if (paragraph && wrapWidth && indent === paragraph.continuationIndent && !BLOCK_START.test(trimmed)) {
			const previousWidth = cellWidth(paragraph.lastLine);
			const firstWord = trimmed.split(" ")[0];
			// Pi moves a word to the next line only when it would not fit. Allow
			// one column of slack for an always-visible scrollbar.
			const wrapped = previousWidth + 1 + cellWidth(firstWord) > wrapWidth - 1;
			const separator = wrapped
				? joinSeparator(paragraph.lastLine, trimmed, { corpus, lineWasFull: previousWidth >= wrapWidth - 1 })
				: undefined;
			if (separator !== undefined) {
				output[output.length - 1] += separator + trimmed;
				paragraph.lastLine = line;
				continue;
			}
		}

		const marker = LIST_ITEM.exec(trimmed);
		paragraph = { lastLine: line, continuationIndent: indent + (marker ? marker[0].length : 0) };
		output.push(line);
	}

	while (output.length > 0 && output[0] === "") output.shift();
	while (output.length > 0 && output[output.length - 1] === "") output.pop();
	return output.join("\n");
}
