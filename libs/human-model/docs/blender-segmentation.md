# Blender Longevity Segmentation

The segmentation pipeline preserves the canonical objects in `Body Male -
Realistic` and `Body Female - Realistic`. It creates generated
`WEB_SEGMENTED_*` collections containing body/eye copies, then adds a child
`WEB_ANATOMY_REGIONS_*` collection with lightweight region proxies.

## Region Contract

Each region proxy is a shared low-poly unit sphere named:

```text
ANATOMY_REGION__<region_id>__<index>
```

Its node position is the region center and its scale is the ellipsoid radius.
Compound regions such as lungs and kidneys have two nodes. glTF node extras
become Three.js `Object3D.userData` and include:

```json
{
  "role": "anatomy_region_proxy",
  "region_id": "liver",
  "view": "front",
  "semantic_version": "1.0.0",
  "category": "digestive",
  "biomarkers_csv": "alt,ast,ggt,alp,bilirubin,albumin"
}
```

The web viewer should hide proxy meshes, index them by `region_id`, and use
their world-space ellipsoids to drive the teal hover shader. The generated
Blender body also contains feathered `HL_<region_id>` vertex groups and an
integer `_health_region_id` working attribute for inspection or future mask
baking. Those dense authoring attributes are intentionally omitted from the
web GLBs; the lightweight proxies are the stable web contract.

Blender object names are global, while both profile GLBs require the same exact
proxy names. An `all` export therefore authors and exports profiles
sequentially; the last profile remains visible in Blender. Use `--no-export`
with one profile when visually reviewing its vertex groups and proxies.

The initial 15-region catalog exactly matches `src/anatomy.ts`: `head_brain`,
`neck_thyroid`, `heart_circulation`, `lungs_breathing`, `liver`,
`pancreas_metabolism`, `digestive_tract`, `kidneys_urinary`, `pelvic_health`,
`upper_limbs`, `lower_limbs`, `major_joints`, `spine_back`, `skin`, and
`whole_body`.

## Run Through Blender MCP

Open the canonical `.blend`, connect the project Blender MCP add-on, then run:

```sh
# Read-only: confirm collection names, body selection, topology, and bounds.
bun run scripts/blender/export-segmented-models.ts --inspect all

# Author collections in the open scene for visual review; write no GLBs.
bun run scripts/blender/export-segmented-models.ts male --no-export

# Rebuild both profiles and export web assets.
bun run scripts/blender/export-segmented-models.ts all
```

Exports are written to `public/models/segmented/realistic-*-segmented.glb`.
Use `--output-dir <project-relative-path>` to override the location. The script
is idempotent: it removes only its previous generated collections. It does not
save the `.blend`; save a copy if the authored vertex groups should persist.

## Assumptions and Review

The source is Z-up, centered consistently, and faces Blender `-Y`
(`front_sign = -1`). The TypeScript coordinate contract maps to Blender as:
X by half-width, vertical Y by body height into Blender Z, and front/back Z by
half-depth into Blender Y. Positive X is anatomical left when viewed from the
front. The ellipsoids are product-oriented surface approximations, not
diagnostic anatomy. Review front/back orientation and region placement in
Blender before shipping.
