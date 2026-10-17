import { mkdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const RESULT_MARKER = "HALO_SEGMENTATION_RESULT::";
const VALID_PROFILES = new Set(["male", "female", "all"]);

interface BlenderResult {
  status: "ok" | "error";
  action?: string;
  message?: string;
  profiles?: unknown[];
}

interface CliOptions {
  action: "inspect" | "segment";
  export: boolean;
  outputDir: string;
  profiles: Array<"male" | "female">;
}

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  bun run scripts/blender/export-segmented-models.ts --inspect [male|female|all]",
      "  bun run scripts/blender/export-segmented-models.ts [male|female|all] [--no-export]",
      "      [--output-dir public/models/segmented]",
    ].join("\n"),
  );
}

function parseArgs(projectRoot: string): CliOptions {
  const args = Bun.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (positional.length > 1) usage();

  const requestedProfile = positional[0] ?? "all";
  if (!VALID_PROFILES.has(requestedProfile)) usage();

  let outputArgument = "public/models/segmented";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output-dir") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) usage();
      outputArgument = value;
      index += 1;
    } else if (arg?.startsWith("--output-dir=")) {
      outputArgument = arg.slice("--output-dir=".length);
    } else if (
      arg?.startsWith("--") &&
      arg !== "--inspect" &&
      arg !== "--no-export"
    ) {
      usage();
    }
  }

  const outputDir = resolve(projectRoot, outputArgument);
  const relativeOutput = relative(projectRoot, outputDir);
  if (relativeOutput.startsWith("..") || isAbsolute(relativeOutput)) {
    throw new Error("The segmented model output directory must be inside the project.");
  }

  const profiles: Array<"male" | "female"> =
    requestedProfile === "all"
      ? ["male", "female"]
      : [requestedProfile as "male" | "female"];

  return {
    action: args.includes("--inspect") ? "inspect" : "segment",
    export: !args.includes("--no-export"),
    outputDir,
    profiles,
  };
}

function parseBlenderResult(text: string): BlenderResult {
  const markerIndex = text.lastIndexOf(RESULT_MARKER);
  if (markerIndex === -1) {
    throw new Error(`Blender did not return structured output.\n${text}`);
  }

  const payload = text
    .slice(markerIndex + RESULT_MARKER.length)
    .split(/\r?\n/, 1)[0];
  if (!payload) throw new Error("Blender returned an empty structured result.");
  return JSON.parse(payload) as BlenderResult;
}

const projectRoot = resolve(import.meta.dir, "../..");
const options = parseArgs(projectRoot);
const scriptPath = resolve(import.meta.dir, "create_longevity_regions.py");
const serverCommand = resolve(
  projectRoot,
  ".mcp/blender-mcp/.venv/bin/blender-mcp",
);

if (options.action === "segment" && options.export) {
  await mkdir(options.outputDir, { recursive: true });
}

const config = {
  action: options.action,
  profiles: options.profiles,
  export: options.action === "segment" && options.export,
  output_dir: options.outputDir,
  semantic_version: "1.0.0",
  front_sign: -1,
  weight_steps: 24,
};
const configJson = JSON.stringify(config);
const pythonSource = await readFile(scriptPath, "utf8");
const blenderCode = [
  "import json as _halo_json",
  `CONFIG = _halo_json.loads(${JSON.stringify(configJson)})`,
  `_halo_namespace = {"__name__": "__main__", "CONFIG": CONFIG}`,
  `exec(compile(${JSON.stringify(pythonSource)}, ${JSON.stringify(scriptPath)}, "exec"), _halo_namespace)`,
].join("\n");

const transport = new StdioClientTransport({
  command: serverCommand,
  cwd: projectRoot,
  env: {
    BLENDER_HOST: "localhost",
    BLENDER_PORT: "9876",
    DISABLE_TELEMETRY: "true",
  },
  stderr: "inherit",
});
const client = new Client({
  name: "human-model-segmentation-exporter",
  version: "1.0.0",
});

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: "execute_blender_code",
    arguments: {
      code: blenderCode,
      user_prompt:
        options.action === "inspect"
          ? "Inspect the realistic body source collections without changing the scene."
          : `Create non-destructive longevity regions for ${options.profiles.join(
              " and ",
            )}${options.export ? " and export segmented GLBs" : ""}.`,
    },
  });

  const content = Array.isArray(result.content) ? result.content : [];
  const textOutput = content
    .flatMap((item): string[] => {
      if (
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string"
      ) {
        return [item.text];
      }
      return [];
    })
    .join("\n");
  if (result.isError) {
    throw new Error(`Blender MCP failed.\n${textOutput}`);
  }

  const parsed = parseBlenderResult(textOutput);
  if (parsed.status !== "ok") {
    throw new Error(parsed.message ?? "Blender segmentation failed.");
  }
  console.log(JSON.stringify(parsed, null, 2));
} finally {
  await client.close();
}
