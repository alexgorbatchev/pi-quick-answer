import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { Api, Model, TranscriptContext } from "@earendil-works/pi-ai";
import {
  DefaultResourceLoader,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  getAgentDir,
  initTheme,
  keyHint,
  keyText,
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionActions,
  ExtensionError,
  ExtensionUIContext,
  MessageRenderer,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import quickAnswerExtension, {
  CONFIG_KEY,
  resolveConfig,
  getPromptSource,
  selectModel,
} from "../quickAnswerExtension.js";

type ReportRenderCase = [Parameters<MessageRenderer>[0]["content"], string];

const globalSettingsPath = path.join(getAgentDir(), "settings.json");
let projectDir = "";
let runner: ExtensionRunner;
let session: SessionManager;
let modelRuntime: ModelRuntime;
let provider: ReturnType<typeof fauxProvider>;
let currentModel: Model<Api> | undefined;
let messages: Parameters<ExtensionActions["sendUserMessage"]>[];
let reports: Parameters<ExtensionActions["sendMessage"]>[0][];
let notifications: Parameters<ExtensionUIContext["notify"]>[];
let selections: Parameters<ExtensionUIContext["select"]>[];
let editors: Parameters<ExtensionUIContext["editor"]>[];
let errors: ExtensionError[];
let selected: string | undefined;
let answer: string | undefined;
let signal: AbortSignal | undefined;

beforeEach(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), "pi-quick-answer-behavior-"));
  await mkdir(path.join(projectDir, ".pi"));
  initTheme("dark", false);
  messages = [];
  reports = [];
  notifications = [];
  selections = [];
  editors = [];
  errors = [];
  selected = undefined;
  answer = "  My answer  ";
  signal = undefined;
  currentModel = undefined;
  session = SessionManager.inMemory(projectDir);
  modelRuntime = await ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false, modelsPath: null });
  provider = fauxProvider({ provider: "quick-answer-test", models: [{ id: "balanced" }, { id: "fast-mini" }] });
  const loader = new DefaultResourceLoader({
    cwd: projectDir,
    agentDir: getAgentDir(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [quickAnswerExtension],
  });
  await loader.reload();
  const result = loader.getExtensions();
  expect(result.errors).toEqual([]);
  result.runtime.sendUserMessage = (...args) => {
    messages.push(args);
  };
  result.runtime.sendMessage = (message) => {
    reports.push(message);
  };
  runner = new ExtensionRunner(result.extensions, result.runtime, projectDir, session, new ModelRegistry(modelRuntime));
  runner.bindCore(result.runtime, {
    getModel: () => currentModel,
    getScopedModels: () => [],
    isIdle: () => true,
    isProjectTrusted: () => true,
    getSignal: () => signal,
    abort: () => assert.fail("Unexpected abort"),
    hasPendingMessages: () => false,
    shutdown: () => assert.fail("Unexpected shutdown"),
    getContextUsage: () => undefined,
    compact: () => assert.fail("Unexpected compaction"),
    getSystemPrompt: () => "",
  });
  runner.setUIContext({
    ...runner.getUIContext(),
    notify: (...args) => {
      notifications.push(args);
    },
    select: async (...args) => {
      selections.push(args);
      return selected;
    },
    editor: async (...args) => {
      editors.push(args);
      return answer;
    },
  });
  runner.onError((error) => {
    errors.push(error);
  });
});

afterEach(async () => {
  modelRuntime.unregisterProvider("quick-answer-test");
  await modelRuntime.refresh({ allowNetwork: false });
  await rm(globalSettingsPath, { force: true });
  await rm(projectDir, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

async function enableProvider(): Promise<void> {
  modelRuntime.registerNativeProvider(provider.provider);
  await modelRuntime.refresh({ allowNetwork: false });
}

async function writeSettings(globalValue: unknown, projectValue: unknown): Promise<void> {
  await Bun.write(globalSettingsPath, JSON.stringify({ [CONFIG_KEY]: globalValue }));
  await Bun.write(path.join(projectDir, ".pi/settings.json"), JSON.stringify({ [CONFIG_KEY]: projectValue }));
}

async function runCommand(): Promise<void> {
  const command = runner.getCommand("quick-answer");
  assert(command);
  await command.handler("", runner.createCommandContext());
}

describe("native extraction flow", () => {
  test("uses the local heuristic without a model and trims the submitted answer", async () => {
    session.appendMessage(fauxAssistantMessage("Should we run the test suite?"));
    await runCommand();
    expect(editors).toEqual([["Answer:", "Should we run the test suite? -> "]]);
    expect(selections).toEqual([]);
    expect(messages).toEqual([["My answer"]]);
    expect(notifications).toEqual([["Extracting questions with local heuristic...", "info"]]);
  });

  test("uses the model, caches extraction, and clears the cache on the next turn", async () => {
    await enableProvider();
    const requests: TranscriptContext[] = [];
    provider.setResponses([
      (context) => {
        requests.push(context);
        return fauxAssistantMessage('["Run the tests?", "Review the diff?"]');
      },
      fauxAssistantMessage('["Run the tests?"]'),
    ]);
    session.appendMessage(fauxAssistantMessage("Should we run tests or review the diff?"));
    selected = "Review the diff?";
    await runCommand();
    await runCommand();
    expect(provider.state.callCount).toBe(1);
    expect(selections).toEqual([
      ["Select Question or Option to Answer", ["Run the tests?", "Review the diff?"]],
      ["Select Question or Option to Answer", ["Run the tests?", "Review the diff?"]],
    ]);
    expect(editors).toEqual([
      ["Answer:", "Review the diff? -> "],
      ["Answer:", "Review the diff? -> "],
    ]);
    const request = requests[0];
    assert(request);
    expect(request.messages).toHaveLength(2);
    expect(request.messages[1]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "Should we run tests or review the diff?" }],
    });
    const systemMessage = request.messages[0];
    assert(systemMessage && systemMessage.role === "system");
    expect(systemMessage.content).toMatchInlineSnapshot(`
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
    await runner.emit({ type: "turn_start", turnIndex: 1, timestamp: 1 });
    await runCommand();
    expect(provider.state.callCount).toBe(2);
    expect(messages).toEqual([["My answer"], ["My answer"], ["My answer"]]);
  });

  test("passes configured model, prompt, and cancellation signal through the native provider", async () => {
    await enableProvider();
    await writeSettings(
      { systemPrompt: "Global", models: "fast-mini" },
      { systemPrompt: "Project", models: "balanced" },
    );
    signal = new AbortController().signal;
    provider.setResponses([
      (context, options, _state, model) => {
        expect(model.id).toBe("balanced");
        expect(context.messages[0]).toMatchObject({ role: "system", content: "Project" });
        expect(options?.signal?.aborted).toBe(false);
        return fauxAssistantMessage('["Configured question?"]');
      },
    ]);
    session.appendMessage(fauxAssistantMessage("Original question?"));
    await runCommand();
    expect(provider.state.callCount).toBe(1);
    expect(editors).toEqual([["Answer:", "Configured question? -> "]]);
    expect(notifications).toEqual([["Extracting questions with quick-answer-test/balanced...", "info"]]);
  });

  test("falls back to regex when the model fails", async () => {
    await enableProvider();
    provider.setResponses([() => Promise.reject(new Error("Provider unavailable"))]);
    session.appendMessage(fauxAssistantMessage("Should we retry the request?"));
    await runCommand();
    expect(provider.state.callCount).toBe(1);
    expect(editors).toEqual([["Answer:", "Should we retry the request? -> "]]);
    expect(messages).toEqual([["My answer"]]);
  });

  test("falls back when model output has no usable questions", async () => {
    await enableProvider();
    provider.setResponses([fauxAssistantMessage("Not JSON")]);
    session.appendMessage(fauxAssistantMessage("Should we review this change?"));
    await runCommand();
    expect(editors).toEqual([["Answer:", "Should we review this change? -> "]]);
  });

  test("skips headless execution and startup reports", async () => {
    runner.setUIContext();
    await runCommand();
    await runner.emit({ type: "session_start", reason: "startup" });
    expect(notifications).toEqual([]);
    expect(reports).toEqual([]);
    expect(messages).toEqual([]);
  });

  test("reports missing assistant text without opening an editor", async () => {
    session.appendMessage({ role: "user", content: "User question?", timestamp: 1 });
    session.appendCustomEntry("other", {});
    session.appendMessage(fauxAssistantMessage([{ type: "thinking", thinking: "Hidden" }]));
    await runCommand();
    expect(notifications).toEqual([["No assistant message found to extract questions from", "error"]]);
    expect(editors).toEqual([]);
  });

  test("reports assistant text without questions", async () => {
    session.appendMessage(fauxAssistantMessage("The work is finished."));
    await runCommand();
    expect(notifications).toEqual([
      ["Extracting questions with local heuristic...", "info"],
      ["No questions or options found in last message", "info"],
    ]);
    expect(editors).toEqual([]);
  });

  test("cancelling the selector does not open the editor or submit", async () => {
    session.appendMessage(fauxAssistantMessage("Should we run tests?\nShould we review changes?"));
    await runCommand();
    expect(selections).toEqual([
      ["Select Question or Option to Answer", ["Should we run tests?", "Should we review changes?"]],
    ]);
    expect(editors).toEqual([]);
    expect(messages).toEqual([]);
  });

  test.each([undefined, "", "   "])("does not submit cancelled or empty editor result: %j", async (value) => {
    answer = value;
    session.appendMessage(fauxAssistantMessage("Should we run tests?"));
    await runCommand();
    expect(editors).toEqual([["Answer:", "Should we run tests? -> "]]);
    expect(messages).toEqual([]);
  });
});

describe("settings and reports", () => {
  test("resolves global defaults and project overrides independently", async () => {
    expect(resolveConfig(projectDir)).toEqual({});
    expect(getPromptSource(projectDir)).toBe("default");
    await writeSettings({ systemPrompt: " Global ", models: "balanced" }, { models: ["fast-mini"] });
    expect(resolveConfig(projectDir)).toEqual({ systemPrompt: "Global", models: ["fast-mini"] });
    expect(getPromptSource(projectDir)).toBe("global settings");
    await writeSettings({ models: "balanced" }, { systemPrompt: " Project " });
    expect(resolveConfig(projectDir)).toEqual({ systemPrompt: "Project", models: ["balanced"] });
    expect(getPromptSource(projectDir)).toBe("project settings");
  });

  test("selects fast models, current model, and the first available model in order", async () => {
    expect(selectModel(runner.createContext())).toBeUndefined();
    currentModel = provider.getModel();
    expect(selectModel(runner.createContext())).toEqual(currentModel);
    await enableProvider();
    expect(selectModel(runner.createContext())?.id).toBe("fast-mini");
    expect(selectModel(runner.createContext(), ["balanced"])?.id).toBe("balanced");
    expect(selectModel(runner.createContext(), ["missing"])?.id).toBe("fast-mini");
    provider = fauxProvider({ provider: "quick-answer-test", models: [{ id: "balanced" }] });
    await enableProvider();
    currentModel = undefined;
    expect(selectModel(runner.createContext())?.id).toBe("balanced");
  });

  test("reports the local default at startup", async () => {
    await runner.emit({ type: "session_start", reason: "startup" });
    expect(reports.map((report) => ({ ...report, content: Bun.stripANSI(String(report.content)) }))).toEqual([
      {
        customType: CONFIG_KEY,
        display: true,
        content: "[@alexgorbatchev/pi-quick-answer]\n  model: local heuristic\n  prompt: default",
      },
    ]);
  });

  test("reports the configured model and prompt source", async () => {
    await enableProvider();
    await writeSettings({}, { models: "balanced", systemPrompt: "Project" });
    await runner.emit({ type: "session_start", reason: "startup" });
    expect(reports.map((report) => ({ ...report, content: Bun.stripANSI(String(report.content)) }))).toEqual([
      {
        customType: CONFIG_KEY,
        display: true,
        content: "[@alexgorbatchev/pi-quick-answer]\n  model: quick-answer-test/balanced\n  prompt: project settings",
      },
    ]);
  });

  test("filters only this extension's reports out of model context", async () => {
    const conversation: Parameters<ExtensionRunner["emitContext"]>[0] = [
      { role: "user", content: "User", timestamp: 1 },
      { role: "custom", customType: CONFIG_KEY, content: "Private report", display: true, timestamp: 2 },
      { role: "custom", customType: "other", content: "Other report", display: true, timestamp: 3 },
    ];
    const userMessage = conversation[0];
    const otherReport = conversation[2];
    assert(userMessage && otherReport);
    expect(await runner.emitContext(conversation)).toEqual([userMessage, otherReport]);
    expect(conversation).toHaveLength(3);
  });

  test.each<ReportRenderCase>([
    ["Plain report", "Plain report"],
    [
      [
        { type: "text", text: "First" },
        { type: "image", data: "AA==", mimeType: "image/png" },
        { type: "text", text: "Second" },
      ],
      "First\nSecond",
    ],
  ])("renders only report text", (content, expected) => {
    const renderer = runner.getMessageRenderer(CONFIG_KEY);
    assert(renderer);
    const component = renderer(
      { role: "custom", customType: CONFIG_KEY, content: structuredClone(content), display: true, timestamp: 1 },
      { expanded: false, outputPad: 0, keyText, keyHint },
      runner.getUIContext().theme,
    );
    assert(component);
    expect(
      component
        .render(80)
        .map((line) => Bun.stripANSI(line).trimEnd())
        .join("\n"),
    ).toBe(expected);
  });
});
