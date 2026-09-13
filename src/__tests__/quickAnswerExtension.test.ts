import assert from "node:assert";
import { describe, expect, it } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import quickAnswerExtension, {
  CONFIG_KEY,
  DEFAULT_EXTRACTION_SYSTEM_PROMPT,
  fallbackRegexExtract,
  findMatchingModel,
  formatConfigReport,
  type IThemeFormatter,
  matchesModelPattern,
  parseModelOutput,
  parseQuickAnswerConfig,
  selectModel,
} from "../quickAnswerExtension.js";

interface IMockCommandOptions {
  description: string;
}

const mockTheme: IThemeFormatter = {
  fg: (_color: string, text: string) => text,
};

const mockModelFlash: Model<Api> = {
  id: "gemini-2.5-flash",
  provider: "google",
  name: "Gemini 2.5 Flash",
  api: "openai-chat-completions",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  reasoning: false,
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 1000000,
  maxTokens: 8192,
};

const mockModelGpt4oMini: Model<Api> = {
  id: "gpt-4o-mini",
  provider: "openai",
  name: "GPT-4o Mini",
  api: "openai-chat-completions",
  baseUrl: "https://api.openai.com/v1",
  reasoning: false,
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 128000,
  maxTokens: 4096,
};

const mockModelSonnet: Model<Api> = {
  id: "claude-3-5-sonnet",
  provider: "anthropic",
  name: "Claude 3.5 Sonnet",
  api: "anthropic-messages",
  baseUrl: "https://api.anthropic.com/v1",
  reasoning: false,
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 200000,
  maxTokens: 8192,
};

describe("fallbackRegexExtract", () => {
  it("extracts questions ending with question mark", () => {
    const text = "We have finished the refactor.\nShould we proceed with running the test suite?";
    const extracted = fallbackRegexExtract(text);

    expect(extracted).toEqual(["Should we proceed with running the test suite?"]);
  });

  it("extracts numbered options and choices", () => {
    const text = [
      "Here are the available options:",
      "Option 1: Explicit Docker Network Label Pinning",
      "Option 2: Automatic Network Discovery",
      "Which approach would you like to take?",
    ].join("\n");

    const extracted = fallbackRegexExtract(text);

    expect(extracted).toEqual([
      "Explicit Docker Network Label Pinning",
      "Automatic Network Discovery",
      "Which approach would you like to take?",
    ]);
  });

  it("returns empty array when text contains no questions or options", () => {
    const text = "All tasks have been successfully completed.\nReady for next command.";
    const extracted = fallbackRegexExtract(text);

    expect(extracted).toEqual([]);
  });
});

describe("parseModelOutput", () => {
  it("parses clean JSON array string", () => {
    const output = '["Question 1?", "Option 2: Redis cache"]';
    expect(parseModelOutput(output)).toEqual(["Question 1?", "Option 2: Redis cache"]);
  });

  it("parses JSON array wrapped in markdown code fence", () => {
    const output = '```json\n["Question 1?", "Option 2: Redis cache"]\n```';
    expect(parseModelOutput(output)).toEqual(["Question 1?", "Option 2: Redis cache"]);
  });

  it("parses JSON array embedded in commentary text", () => {
    const output = 'Here are the extracted questions:\n["Question 1?", "Option 2: Redis cache"]\nHope this helps!';
    expect(parseModelOutput(output)).toEqual(["Question 1?", "Option 2: Redis cache"]);
  });

  it("returns empty array for invalid or non-array output", () => {
    expect(parseModelOutput("No questions found")).toEqual([]);
    expect(parseModelOutput('{"question": "Not an array"}')).toEqual([]);
  });
});

describe("parseQuickAnswerConfig", () => {
  it("returns undefined when settings is not an object or missing config key", () => {
    expect(parseQuickAnswerConfig(null)).toBeUndefined();
    expect(parseQuickAnswerConfig({})).toBeUndefined();
    expect(parseQuickAnswerConfig({ otherKey: {} })).toBeUndefined();
  });

  it("parses systemPrompt and models array", () => {
    const settings = {
      [CONFIG_KEY]: {
        systemPrompt: "Custom extraction prompt",
        models: ["google/gemini-2.5-flash", "openai/gpt-4o-mini"],
      },
    };

    const config = parseQuickAnswerConfig(settings);
    assert(config !== undefined);
    expect(config.systemPrompt).toBe("Custom extraction prompt");
    expect(config.models).toEqual(["google/gemini-2.5-flash", "openai/gpt-4o-mini"]);
  });

  it("parses single model string as an array", () => {
    const settings = {
      [CONFIG_KEY]: {
        models: "openai/gpt-4o-mini",
      },
    };

    const config = parseQuickAnswerConfig(settings);
    assert(config !== undefined);
    expect(config.models).toEqual(["openai/gpt-4o-mini"]);
  });
});

describe("formatConfigReport", () => {
  it("formats report with resolved model and default prompt", () => {
    const report = formatConfigReport(mockTheme, "google/gemini-2.5-flash", "default");
    expect(report).toMatchInlineSnapshot(`
      "[@alexgorbatchev/pi-quick-answer]
        model: google/gemini-2.5-flash
        prompt: default"
    `);
  });

  it("formats report with resolved model and project settings prompt", () => {
    const report = formatConfigReport(mockTheme, "google/gemini-2.5-flash", "project settings");
    expect(report).toMatchInlineSnapshot(`
      "[@alexgorbatchev/pi-quick-answer]
        model: google/gemini-2.5-flash
        prompt: project settings"
    `);
  });

  it("formats report with resolved model and global settings prompt", () => {
    const report = formatConfigReport(mockTheme, "openai/gpt-4o-mini", "global settings");
    expect(report).toMatchInlineSnapshot(`
      "[@alexgorbatchev/pi-quick-answer]
        model: openai/gpt-4o-mini
        prompt: global settings"
    `);
  });
});

describe("matchesModelPattern", () => {
  it("matches exact provider and model id", () => {
    expect(matchesModelPattern("google/gemini-2.5-flash", mockModelFlash)).toBe(true);
    expect(matchesModelPattern("openai/gpt-4o-mini", mockModelGpt4oMini)).toBe(true);
    expect(matchesModelPattern("openai/gpt-4o-mini", mockModelFlash)).toBe(false);
  });

  it("matches wildcard provider or wildcard id", () => {
    expect(matchesModelPattern("google/*", mockModelFlash)).toBe(true);
    expect(matchesModelPattern("*/gpt-4o-mini", mockModelGpt4oMini)).toBe(true);
    expect(matchesModelPattern("anthropic/*", mockModelGpt4oMini)).toBe(false);
  });

  it("matches substring patterns", () => {
    expect(matchesModelPattern("flash", mockModelFlash)).toBe(true);
    expect(matchesModelPattern("sonnet", mockModelSonnet)).toBe(true);
    expect(matchesModelPattern("gpt", mockModelGpt4oMini)).toBe(true);
    expect(matchesModelPattern("claude", mockModelFlash)).toBe(false);
  });
});

describe("findMatchingModel", () => {
  it("finds the first matching model in order of configured patterns", () => {
    const available = [mockModelSonnet, mockModelGpt4oMini, mockModelFlash];
    const match = findMatchingModel(["openai/*", "google/*"], available);

    assert(match !== undefined);
    expect(match.id).toBe("gpt-4o-mini");
  });

  it("returns undefined when no pattern matches", () => {
    const available = [mockModelSonnet];
    const match = findMatchingModel(["mistral/*"], available);

    expect(match).toBeUndefined();
  });
});

describe("selectModel", () => {
  it("prioritizes configured model patterns over default heuristics", () => {
    const mockCtx = {
      modelRegistry: {
        getAvailable: () => [mockModelSonnet, mockModelGpt4oMini, mockModelFlash],
      },
      model: mockModelSonnet,
    } as unknown as ExtensionContext;

    const selected = selectModel(mockCtx, ["openai/gpt-4o-mini"]);
    assert(selected !== undefined);
    expect(selected.id).toBe("gpt-4o-mini");
  });

  it("falls back to fast flash/mini/haiku model when no configuration is provided", () => {
    const mockCtx = {
      modelRegistry: {
        getAvailable: () => [mockModelSonnet, mockModelFlash],
      },
      model: mockModelSonnet,
    } as unknown as ExtensionContext;

    const selected = selectModel(mockCtx);
    assert(selected !== undefined);
    expect(selected.id).toBe("gemini-2.5-flash");
  });
});

describe("quickAnswerExtension", () => {
  it("registers quick-answer command", () => {
    const registeredCommands: Record<string, string> = {};
    const registeredEvents: string[] = [];

    const mockPi = {
      registerCommand: (name: string, options: IMockCommandOptions) => {
        registeredCommands[name] = options.description;
      },
      registerMessageRenderer: () => {},
      on: (event: string) => {
        registeredEvents.push(event);
      },
      sendMessage: () => {},
      sendUserMessage: () => {},
    } as unknown as ExtensionAPI;

    quickAnswerExtension(mockPi);

    expect(Object.keys(registeredCommands).sort()).toEqual(["quick-answer"]);
    expect(registeredEvents).toEqual(["context", "turn_start", "session_start"]);
  });

  it("exports the default extraction prompt", () => {
    expect(DEFAULT_EXTRACTION_SYSTEM_PROMPT).toMatchInlineSnapshot(`
      "You are an exact question and decision extractor.
      Given an assistant's response from a conversation, extract any open questions, proposed options, or decisions presented to the user.

      RULES:
      1. Extract the EXACT question or option text as written by the assistant. Do NOT paraphrase, summarize, rephrase, or reword it into your own phrasing.
      2. If the assistant asked "Question: Should we audit all multi-network compose configurations...?", extract the exact text "Should we audit all multi-network compose configurations...?".
      3. If options are listed like "Option 1: Explicit Docker Network Label Pinning", extract the exact title/description.
      4. Include both distinct options/solutions and trailing questions as separate items if they offer different choices.
      5. Keep the original wording intact so the user and model recognize the exact context.

      Output format:
      - Return ONLY a JSON array of strings containing the exact phrases/questions: ["Exact question 1?", "Exact option or question 2?"]
      - No markdown formatting or extra text.
      - Return [] if no questions or options exist."
    `);
  });
});
