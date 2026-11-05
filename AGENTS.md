---
created_on: 2026-11-05 11:45
last_modified: 2026-11-05 11:45
status: current
---

# pi-quick-answer

Pi extension for extracting questions and decisions from the latest assistant response and composing an answer in the editor.

## Commands

- `just setup`: install locked dependencies with Bun 1.4 or newer.
- `just run`: start Pi with the local extension and real user settings.
- `just check`: read-only formatting, lint, types, unused code, and coverage checks.
- `just test`: execute tests through the shared isolation supervisor.
- `just fmt`: format source, configuration, and the justfile.

## Runtime contracts

- Preserve the default export from `src/index.ts`; keep package exports and the Pi extension manifest aligned.
- Use the maintained `@earendil-works` SDK and explicit compatible peer ranges. Prefer native SDK types to duplicate local structures.
- Resolve project settings over global settings independently for the system prompt and model patterns.
- Select configured models in pattern order, then a fast model, then the current or first available model. Fall back to local extraction when model extraction fails or yields no questions.
- Cache questions for unchanged assistant text and clear the cache on each turn start.
- Keep interactive selection and editing behind `ctx.hasUI`. Cancelling a selector or submitting an empty editor must not send a message.
- Keep startup reports visible to the user but filter only this extension's reports from model context.

## Tests and artifacts

- Update behavioral tests whenever executable behavior changes. Exercise the installed Pi loader and event runner; use its scripted provider for model extraction without network calls or credentials.
- Enforce at least 90% line and function coverage of non-test source, including unexecuted modules through the coverage preload. Exclude tests and fixtures; exclude `scripts/` if introduced.
- Consume the shared `@alexgorbatchev/pi-test-isolation` runner and preload from a pinned GitHub tag; never copy the implementation here.
- Keep Bun environment-file loading disabled. Direct `bun test` must fail outside isolation.
- Tests remove owned files and processes on every outcome. The supervisor waits for its process group before removing private home, caches, sessions, and scratch; it is not a filesystem sandbox.
- Compare checkout scratch, system temporary files, and processes before and after test changes.
- Use task-owned `.tmp/` children for disposable artifacts, `.state/` for retained records, and `.cache/` for regenerable caches. Never delete shared scratch by name.
- Keep tests and tooling out of published packages; inspect the actual package contents before publication.

## Publication

- Commit the lockfile and keep CI on the verified Bun version.
- Publish required versions through the existing tag workflow after checks pass, with matching package and tag versions.
- Never publish credentials, private hostnames, or private tracker references.
