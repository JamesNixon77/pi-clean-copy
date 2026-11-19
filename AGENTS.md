# Repository instructions

This repository is the canonical source for the Pi Clean Copy extension.

- Make all functional changes here, not in `~/.pi/agent/extensions/`. The local `~/.pi/agent/extensions/clean-copy.ts` is only a development shim that re-exports this checkout.
- Keep the extension clipboard-only: it rewrites the text of a fullscreen selection copy and must never change session messages, model context, or rendering.
- Any failure must fall back to copying the original selection unchanged.
- Never glue two pieces of wrapped text together with a guessed space when the line reached the wrap width; that corrupts URLs, IDs, and tool output.
- Before committing, run `node --experimental-strip-types --test tests/*.test.mjs` with Pi's `pi-tui` available (inside a Pi session `PI_PACKAGE_DIR` provides it), so the renderer round-trip tests run instead of skipping. Smoke-load the package through Pi when package layout or extension APIs change.
- Commit and push every functional change to `main`; bump the package version and document user-visible releases.
