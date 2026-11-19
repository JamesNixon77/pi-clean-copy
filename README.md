# Pi Clean Copy

A small [Pi](https://github.com/earendil-works/pi) extension that makes text copied from Pi's fullscreen transcript paste as the markdown it was rendered from.

Fullscreen Pi copies a mouse selection exactly as it is drawn on screen. A copied reply therefore carries:

- box-drawn table borders and row rules (`┌─┬─┐`, `│`, `├─┼─┤`);
- the one-column padding on every transcript line;
- `│ ` quote bars and Pi's two-column code-block indentation;
- a hard newline wherever a paragraph, list item, or table cell wrapped at the pane width. Narrow split panes make this much worse.

This extension rewrites the selection before Pi puts it on the clipboard:

| On screen | Copied as |
| --- | --- |
| Box-drawn table, including wrapped cells | Markdown table, one line per row |
| Wrapped paragraphs and list items | One line per paragraph or item |
| `│ quote` | `> quote` |
| Indented code inside ```` ``` ```` fences | The code at its original indentation |
| `────` rule | `---` |

Wrapped lines are checked against the session's own text before they are rejoined. A long token Pi broke at the edge, such as a URL, an ID, or a line of tool output, is rejoined without a space, and nothing is joined with a guessed space when the session text cannot confirm it.

## Install

```bash
pi install git:github.com/JamesNixon77/pi-clean-copy
```

Restart Pi or run `/reload` in every open Pi pane.

If Shopify's experimental third-party package gate is enabled:

```bash
SHOPIFY_PI_ALLOW_3P=1 pi install git:github.com/JamesNixon77/pi-clean-copy
```

## Usage

There are no commands. Select text with the mouse in Pi's fullscreen mode (the default) as usual; with `fullscreenCopyOnSelect` off, copy the selection with `Ctrl+X`. Regular (non-fullscreen) mode leaves selection to the terminal and is unaffected.

`/copy` still copies the whole last reply as raw markdown.

| Environment variable | Effect |
| --- | --- |
| `PI_CLEAN_COPY=off` | Disable the extension |
| `PI_CLEAN_COPY_LOG=<file>` | Append each copy's raw and cleaned text as JSON lines, for diagnosing a bad conversion |

## How it hooks in

Pi has no public hook for selection copies, so the extension wraps the fullscreen TUI's internal `copySelection` callback, reached through a zero-height widget. If a Pi update renames that callback, the hook does nothing and copying behaves as stock. Any error while cleaning falls back to copying the original selection.

The extension only changes the copied text. It does not modify rendering, session messages, or model context.

## Development

Canonical repository:

```text
https://github.com/JamesNixon77/pi-clean-copy
```

Run tests:

```bash
node --experimental-strip-types --test tests/*.test.mjs
```

The round-trip tests render real markdown with Pi's `Markdown` component and copy it the way fullscreen Pi does. They need Pi's `pi-tui`: inside a Pi session `PI_PACKAGE_DIR` provides it; elsewhere run `npm install --no-save @earendil-works/pi-tui` or set `PI_TUI_MODULE`. Without it, those tests skip.

Smoke-load the package through Pi after changing extension APIs or package layout:

```bash
PI_CODING_AGENT_DIR="$(mktemp -d)" \
  pi --no-extensions -e "$PWD" --mode json --no-session </dev/null
```

All functional changes should be made in this repository, tested, committed, and pushed.

## License

MIT
