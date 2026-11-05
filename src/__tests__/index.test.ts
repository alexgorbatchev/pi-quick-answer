import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));

describe("pi-quick-answer extension entry", () => {
  let projectDir = "";

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("loads through Pi's extension loader and registers the quick-answer command", async () => {
    projectDir = mkdtempSync(path.join(tmpdir(), "pi-quick-answer-project-"));
    const loader = new DefaultResourceLoader({
      cwd: projectDir,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalExtensionPaths: [extensionPath],
    });

    await loader.reload();
    const { extensions, errors } = loader.getExtensions();

    expect(errors).toEqual([]);
    expect(
      extensions.map((extension) => [
        extension.path,
        [...extension.commands.keys()],
        [...extension.handlers.keys()],
        [...extension.messageRenderers.keys()],
      ]),
    ).toEqual([
      [
        extensionPath,
        ["quick-answer"],
        ["context", "turn_start", "session_start"],
        ["@alexgorbatchev/pi-quick-answer"],
      ],
    ]);
  });
});
