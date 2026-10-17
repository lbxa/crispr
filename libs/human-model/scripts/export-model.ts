import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MODEL_EXPORTS = {
  female: {
    collection: "Body Female - Realistic",
    filename: "realistic-female.glb",
  },
  male: {
    collection: "Body Male - Realistic",
    filename: "realistic-male.glb",
  },
} as const;

type ModelKey = keyof typeof MODEL_EXPORTS;

const requestedModel = Bun.argv[2] as ModelKey | undefined;
if (!requestedModel || !(requestedModel in MODEL_EXPORTS)) {
  throw new Error("Usage: bun run scripts/export-model.ts <female|male>");
}

const projectRoot = resolve(import.meta.dir, "..");
const serverCommand = resolve(
  projectRoot,
  ".mcp/blender-mcp/.venv/bin/blender-mcp",
);
const exportConfig = MODEL_EXPORTS[requestedModel];
const exportPath = resolve(projectRoot, "public/models", exportConfig.filename);
const blenderCode = `
import bpy

collection = bpy.data.collections.get(${JSON.stringify(exportConfig.collection)})
if collection is None:
    raise RuntimeError("Missing collection: ${exportConfig.collection}")

objects = [obj for obj in collection.all_objects if obj.type == "MESH"]
if len(objects) != 3:
    raise RuntimeError(f"Expected body and two eye meshes, found {len(objects)}")

bpy.ops.object.select_all(action="DESELECT")
for obj in objects:
    obj.hide_set(False)
    obj.select_set(True)

bpy.context.view_layer.objects.active = objects[0]
result = bpy.ops.export_scene.gltf(
    filepath=${JSON.stringify(exportPath)},
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_cameras=False,
    export_lights=False,
)
print({"result": list(result), "objects": [obj.name for obj in objects]})
`;

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
const client = new Client({ name: "human-model-exporter", version: "1.0.0" });

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: "execute_blender_code",
    arguments: {
      code: blenderCode,
      user_prompt: `Export the complete realistic ${requestedModel} body for the Three.js viewer.`,
    },
  });

  if (result.isError) {
    throw new Error(`Blender export failed: ${JSON.stringify(result.content)}`);
  }

  console.log(`Exported ${exportConfig.collection} to ${exportPath}.`);
} finally {
  await client.close();
}
