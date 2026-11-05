import type { Api, Model, TextContent, UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export const CONFIG_KEY = "@alexgorbatchev/pi-quick-answer";

export type PromptSource = "default" | "global settings" | "project settings";

export interface IQuickAnswerConfig {
  systemPrompt?: string;
  models?: string[];
}

export interface IThemeFormatter {
  fg(color: string, text: string): string;
}

interface IQuestionCache {
  assistantText: string | null;
  questions: string[];
}

export const DEFAULT_EXTRACTION_SYSTEM_PROMPT = `You are an exact question and decision extractor.
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
- Return [] if no questions or options exist.`;

function isTextContentPart(part: unknown): part is TextContent {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    part.type === "text" &&
    "text" in part &&
    typeof part.text === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseQuickAnswerConfig(settings: unknown): IQuickAnswerConfig | undefined {
  if (typeof settings !== "object" || settings === null) {
    return undefined;
  }

  const configValue = Reflect.get(settings, CONFIG_KEY);
  if (typeof configValue !== "object" || configValue === null) {
    return undefined;
  }

  const result: IQuickAnswerConfig = {};

  const promptValue = Reflect.get(configValue, "systemPrompt");
  if (typeof promptValue === "string" && promptValue.trim().length > 0) {
    result.systemPrompt = promptValue.trim();
  }

  const modelsValue = Reflect.get(configValue, "models");
  if (Array.isArray(modelsValue)) {
    const stringModels = modelsValue
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (stringModels.length > 0) {
      result.models = stringModels;
    }
  } else if (typeof modelsValue === "string" && modelsValue.trim().length > 0) {
    result.models = [modelsValue.trim()];
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function getPromptSource(cwd: string): PromptSource {
  const settingsManager = SettingsManager.create(cwd);
  const projectConfig = parseQuickAnswerConfig(settingsManager.getProjectSettings());
  if (projectConfig?.systemPrompt) {
    return "project settings";
  }

  const globalConfig = parseQuickAnswerConfig(settingsManager.getGlobalSettings());
  if (globalConfig?.systemPrompt) {
    return "global settings";
  }

  return "default";
}

export function formatConfigReport(
  theme: IThemeFormatter,
  resolvedModelLabel: string,
  promptSource: PromptSource,
): string {
  let reportText = theme.fg("mdHeading", `[${CONFIG_KEY}]`) + "\n";
  reportText += theme.fg("accent", "  model: ") + theme.fg("dim", resolvedModelLabel) + "\n";
  reportText += theme.fg("accent", "  prompt: ") + theme.fg("dim", promptSource);
  return reportText;
}

function sendConfigReport(pi: ExtensionAPI, reportText: string): void {
  pi.sendMessage({
    customType: CONFIG_KEY,
    content: reportText,
    display: true,
  });
}

export function resolveConfig(cwd: string): IQuickAnswerConfig {
  const settingsManager = SettingsManager.create(cwd);
  const globalConfig = parseQuickAnswerConfig(settingsManager.getGlobalSettings());
  const projectConfig = parseQuickAnswerConfig(settingsManager.getProjectSettings());

  const merged: IQuickAnswerConfig = {};

  if (globalConfig?.systemPrompt) {
    merged.systemPrompt = globalConfig.systemPrompt;
  }
  if (globalConfig?.models) {
    merged.models = globalConfig.models;
  }

  if (projectConfig?.systemPrompt) {
    merged.systemPrompt = projectConfig.systemPrompt;
  }
  if (projectConfig?.models) {
    merged.models = projectConfig.models;
  }

  return merged;
}

export function matchesModelPattern(pattern: string, model: Model<Api>): boolean {
  const normalizedPattern = pattern.trim().toLowerCase();
  const normalizedModelId = model.id.toLowerCase();
  const normalizedProvider = model.provider.toLowerCase();
  const fullModelKey = `${normalizedProvider}/${normalizedModelId}`;

  if (normalizedPattern.includes("/")) {
    const slashIndex = normalizedPattern.indexOf("/");
    const patternProvider = normalizedPattern.slice(0, slashIndex);
    const patternId = normalizedPattern.slice(slashIndex + 1);

    const isProviderMatch = patternProvider === "*" || normalizedProvider === patternProvider;
    if (!isProviderMatch) {
      return false;
    }

    if (patternId === "*" || patternId.length === 0) {
      return true;
    }

    return normalizedModelId === patternId || normalizedModelId.includes(patternId);
  }

  return (
    normalizedModelId === normalizedPattern ||
    normalizedModelId.includes(normalizedPattern) ||
    normalizedProvider === normalizedPattern ||
    fullModelKey === normalizedPattern
  );
}

export function findMatchingModel(
  configuredPatterns: readonly string[],
  available: readonly Model<Api>[],
): Model<Api> | undefined {
  for (const pattern of configuredPatterns) {
    const matched = available.find((model) => matchesModelPattern(pattern, model));
    if (matched) {
      return matched;
    }
  }
  return undefined;
}

export function selectModel(ctx: ExtensionContext, configuredPatterns?: readonly string[]): Model<Api> | undefined {
  const available = ctx.modelRegistry.getAvailable();

  if (configuredPatterns && configuredPatterns.length > 0) {
    const configuredMatch = findMatchingModel(configuredPatterns, available);
    if (configuredMatch) {
      return configuredMatch;
    }
  }

  const fastModel = available.find(
    (model: Model<Api>) =>
      model.id.toLowerCase().includes("flash") ||
      model.id.toLowerCase().includes("mini") ||
      model.id.toLowerCase().includes("haiku"),
  );
  if (fastModel) {
    return fastModel;
  }

  return ctx.model ?? available[0];
}

function getLastAssistantText(ctx: ExtensionContext): string | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry && entry.type === "message") {
      const message = entry.message;
      if ("role" in message && message.role === "assistant") {
        if (typeof message.content === "string") {
          return message.content;
        }
        if (Array.isArray(message.content)) {
          const textParts = message.content.filter(isTextContentPart).map((part: TextContent) => part.text);
          if (textParts.length > 0) {
            return textParts.join("\n");
          }
        }
      }
    }
  }
  return undefined;
}

export function fallbackRegexExtract(text: string): string[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const items: string[] = [];

  for (const line of lines) {
    const cleanLine = line.replace(/[*_`]/g, "").trim();

    if (cleanLine.endsWith("?")) {
      const clean = cleanLine.replace(/^(?:\d+[.)]|\*|-|•)\s+/, "").trim();
      if (clean.length > 8) {
        items.push(clean);
      }
      continue;
    }

    const optionMatch = cleanLine.match(/^(?:Option\s+\d+|Approach\s+\d+|\d+[.)]|\*|-|•)\s*[:-]?\s*(.+)$/i);
    const candidate = optionMatch?.[1]?.trim();
    if (candidate && candidate.length > 8 && candidate.length < 200) {
      items.push(candidate);
    }
  }

  return Array.from(new Set(items));
}

export function parseModelOutput(rawText: string): string[] {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (isStringArray(parsed)) {
      return parsed.map((item) => item.trim()).filter((item) => item.length > 0);
    }
  } catch {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch?.[0]) {
      try {
        const parsed: unknown = JSON.parse(arrayMatch[0]);
        if (isStringArray(parsed)) {
          return parsed.map((item) => item.trim()).filter((item) => item.length > 0);
        }
      } catch {
        // Fall through to empty array
      }
    }
  }

  return [];
}

async function extractQuestionsFromText(
  assistantText: string,
  ctx: ExtensionContext,
  model: Model<Api> | undefined,
  systemPrompt: string,
): Promise<string[]> {
  let extracted: string[] = [];

  if (model) {
    try {
      const userMessage: UserMessage = {
        role: "user",
        content: [{ type: "text", text: assistantText }],
        timestamp: Date.now(),
      };

      const options = ctx.signal ? { signal: ctx.signal } : undefined;
      const response = await ctx.modelRegistry.complete(
        model,
        {
          systemPrompt,
          messages: [userMessage],
        },
        options,
      );

      const responseText = response.content
        .filter(isTextContentPart)
        .map((part: TextContent) => part.text)
        .join("")
        .trim();

      extracted = parseModelOutput(responseText);
    } catch {
      // Model extraction failure falls back to regex
    }
  }

  if (extracted.length === 0) {
    extracted = fallbackRegexExtract(assistantText);
  }

  return extracted;
}

async function executeQuickAnswerFlow(pi: ExtensionAPI, ctx: ExtensionContext, cache: IQuestionCache): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }

  const assistantText = getLastAssistantText(ctx);
  if (!assistantText) {
    ctx.ui.notify("No assistant message found to extract questions from", "error");
    return;
  }

  let questions: string[];
  if (cache.assistantText === assistantText && cache.questions.length > 0) {
    questions = cache.questions;
  } else {
    const config = resolveConfig(ctx.cwd);
    const systemPrompt = config.systemPrompt ?? DEFAULT_EXTRACTION_SYSTEM_PROMPT;
    const model = selectModel(ctx, config.models);
    const modelLabel = model ? `${model.provider}/${model.id}` : "local heuristic";
    ctx.ui.notify(`Extracting questions with ${modelLabel}...`, "info");
    questions = await extractQuestionsFromText(assistantText, ctx, model, systemPrompt);
    cache.assistantText = assistantText;
    cache.questions = questions;
  }

  if (questions.length === 0) {
    ctx.ui.notify("No questions or options found in last message", "info");
    return;
  }

  let targetQuestion = questions[0];
  if (targetQuestion === undefined) {
    return;
  }

  if (questions.length > 1) {
    const selected = await ctx.ui.select("Select Question or Option to Answer", questions);
    if (!selected) {
      return;
    }
    targetQuestion = selected;
  }

  const prefilled = `${targetQuestion} -> `;
  const answer = await ctx.ui.editor("Answer:", prefilled);
  if (answer && answer.trim().length > 0) {
    pi.sendUserMessage(answer.trim());
  }
}

export default function quickAnswerExtension(pi: ExtensionAPI): void {
  const cache: IQuestionCache = {
    assistantText: null,
    questions: [],
  };

  pi.registerMessageRenderer(CONFIG_KEY, (message) => {
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter(isTextContentPart)
            .map((part: TextContent) => part.text)
            .join("\n");

    return new Text(text, 0, 0);
  });

  pi.on("context", async (event) => ({
    messages: event.messages.filter((message) => message.role !== "custom" || message.customType !== CONFIG_KEY),
  }));

  pi.on("turn_start", async () => {
    cache.assistantText = null;
    cache.questions = [];
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }

    const config = resolveConfig(ctx.cwd);
    const promptSource = getPromptSource(ctx.cwd);
    const selectedModel = selectModel(ctx, config.models);
    const modelLabel = selectedModel ? `${selectedModel.provider}/${selectedModel.id}` : "local heuristic";

    sendConfigReport(pi, formatConfigReport(ctx.ui.theme, modelLabel, promptSource));
  });

  const commandHandler = async (_args: string, ctx: ExtensionContext): Promise<void> => {
    await executeQuickAnswerFlow(pi, ctx, cache);
  };

  const commandDescription = "Extract questions/options from last assistant message and select an answer";

  pi.registerCommand("quick-answer", {
    description: commandDescription,
    handler: commandHandler,
  });
}
