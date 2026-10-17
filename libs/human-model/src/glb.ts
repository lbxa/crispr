export interface GlbMetadata {
  declaredLength: number;
  json: {
    asset?: { generator?: string; version?: string };
    meshes?: Array<{ name?: string }>;
    nodes?: Array<{ name?: string }>;
    scenes?: Array<{ name?: string }>;
  };
  version: number;
}

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK_TYPE = 0x4e4f534a;

export function inspectGlb(data: ArrayBuffer): GlbMetadata {
  const view = new DataView(data);
  if (view.byteLength < 20) throw new Error("GLB is too small to contain a header.");
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Invalid GLB magic.");

  const version = view.getUint32(4, true);
  const declaredLength = view.getUint32(8, true);
  const jsonLength = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);

  if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`);
  if (declaredLength !== data.byteLength) throw new Error("GLB length header is incorrect.");
  if (jsonType !== JSON_CHUNK_TYPE) throw new Error("First GLB chunk is not JSON.");

  const jsonBytes = new Uint8Array(data, 20, jsonLength);
  const jsonText = new TextDecoder().decode(jsonBytes).replace(/\0+$/u, "").trimEnd();

  return {
    declaredLength,
    json: JSON.parse(jsonText) as GlbMetadata["json"],
    version,
  };
}
