# @alexgorbatchev/pi-quick-answer

A Pi extension that extracts open questions, options, and decisions from the assistant's latest response, presents an interactive selector, and opens a prefilled modal editor to quickly submit your answer.

## Workflow

1. Run `/quick-answer`.
2. The extension extracts questions and options from the last assistant turn using a fast model (or regex heuristic). Extraction results are cached per turn for instant repeat invocations.
3. If multiple questions/options exist, select one using the inline interactive picker (`ctx.ui.select`).
4. Enter your answer in the prefilled modal editor dialog (`[Selected Question] -> `).
5. Press Enter to submit; the message is sent directly to the assistant.

## Installation

To install globally:

```bash
pi install npm:@alexgorbatchev/pi-quick-answer
```

To install locally for a specific project:

```bash
pi install npm:@alexgorbatchev/pi-quick-answer -l
```

## Configuration

You can optionally configure preferred extraction models and custom system prompts in your global or project `.pi/settings.json` under the `"@alexgorbatchev/pi-quick-answer"` key.

```json
{
  "@alexgorbatchev/pi-quick-answer": {
    "models": ["google/gemini-2.5-flash", "openai/gpt-4o-mini"],
    "systemPrompt": "Custom extraction prompt..."
  }
}
```

### Options

- `models` (`string[]` or `string`): Preferred model identifier(s) or wildcard patterns (e.g. `"google/gemini-2.5-flash"`, `"openai/gpt-4o-mini"`, `"flash"`). Evaluated in order against available models. If omitted, defaults to fast models (`flash`, `mini`, `haiku`) or the current active model.
- `systemPrompt` (`string`): Overrides the default extraction prompt.

### Startup Summary

On startup, the extension reports the resolved model and the prompt source:

```
[@alexgorbatchev/pi-quick-answer]
  model: google/gemini-2.5-flash
  prompt: default
```

Or if a custom prompt is configured:

```
[@alexgorbatchev/pi-quick-answer]
  model: google/gemini-2.5-flash
  prompt: project settings
```

## Development

Use Bun 1.4 or newer and `just`. The extension requires Pi 1.x (1.5 or newer) from `@earendil-works` and Node.js 22.19 or newer.

```bash
just setup
just check
just run
```

`just run` opens Pi with the local extension and your real settings. `just test` uses the GitHub-pinned [pi-test-isolation](https://github.com/alexgorbatchev/pi-test-isolation) supervisor and guard to isolate home, caches, sessions, scratch, and child processes. Direct `bun test` is rejected outside isolation.

Tests exercise the installed Pi loader, event runner, model provider, extraction cache, settings precedence, selection and editor flows, and report rendering. Linux and macOS CI enforce at least 90% line and function coverage, including unexecuted source. Tests and development tooling are excluded from the published package.
