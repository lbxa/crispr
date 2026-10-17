import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectRoot = resolve(import.meta.dir, "..");
const serverCommand = resolve(
  projectRoot,
  ".mcp/blender-mcp/.venv/bin/blender-mcp",
);

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
const client = new Client({ name: "human-model-mcp-verifier", version: "1.0.0" });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  if (tools.length === 0) throw new Error("Blender MCP returned no tools.");

  const sceneTool = tools.find((tool) => tool.name === "get_scene_info");
  if (!sceneTool) throw new Error("Blender MCP is missing get_scene_info.");

  const result = await client.callTool({
    name: sceneTool.name,
    arguments: {
      user_prompt: "Verify that the currently open Blender scene is readable.",
    },
  });
  if (result.isError) {
    throw new Error(
      `Blender rejected get_scene_info: ${JSON.stringify(result.content)}`,
    );
  }

  console.log(`Verified Blender MCP connection with ${tools.length} available tools.`);
} finally {
  await client.close();
}
