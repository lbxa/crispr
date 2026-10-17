"""Create non-destructive longevity-region metadata and export segmented GLBs.

This file is intended to run inside Blender through Blender MCP's
``execute_blender_code`` tool. The TypeScript wrapper beside this file injects a
``CONFIG`` dictionary before evaluating it.

The source collections and meshes are never edited. Each run replaces only the
generated ``WEB_SEGMENTED_*`` collections, duplicates the source profile, adds
soft vertex groups to the duplicate body, and creates lightweight ellipsoid
proxy meshes whose transforms and custom properties survive glTF export.
"""

from __future__ import annotations

import json
import math
import os
import traceback
from dataclasses import dataclass
from typing import Any

import bmesh
import bpy
import numpy as np


RESULT_MARKER = "HALO_SEGMENTATION_RESULT::"
DEFAULT_CONFIG: dict[str, Any] = {
    "action": "segment",
    "profiles": ["male", "female"],
    "export": True,
    "output_dir": "",
    "semantic_version": "1.0.0",
    "front_sign": -1.0,
    "weight_steps": 24,
}

PROFILE_CONFIG = {
    "male": {
        "collection": "Body Male - Realistic",
        "filename": "realistic-male-segmented.glb",
    },
    "female": {
        "collection": "Body Female - Realistic",
        "filename": "realistic-female-segmented.glb",
    },
}


@dataclass(frozen=True)
class Anchor:
    """An ellipsoid in the same normalized body space as src/anatomy.ts."""

    x: float
    y: float
    z: float
    rx: float
    ry: float
    rz: float
    view: str


@dataclass(frozen=True)
class Region:
    id: int
    slug: str
    label: str
    category: str
    biomarkers: str
    surface_cue: str
    anchors: tuple[Anchor, ...]


# This catalog deliberately mirrors src/anatomy.ts. Normalized coordinates are:
# X = -1 subject-right to +1 subject-left, Y = 0 soles to 1 crown, and
# Z = -1 back to +1 front.
REGIONS: tuple[Region, ...] = (
    Region(
        1,
        "head_brain",
        "Head & brain",
        "neurological",
        "homocysteine,vitamin_b12,folate,omega_3",
        "Whole-head surface association; not a brain outline.",
        (Anchor(0.0, 0.93, 0.0, 0.18, 0.09, 1.05, "both"),),
    ),
    Region(
        2,
        "neck_thyroid",
        "Neck & thyroid",
        "endocrine",
        "tsh,free_t3,free_t4,thyroid_antibodies",
        "Front-neck surface association around the thyroid area.",
        (Anchor(0.0, 0.82, 0.62, 0.13, 0.055, 0.55, "front"),),
    ),
    Region(
        3,
        "heart_circulation",
        "Heart & circulation",
        "cardiometabolic",
        "apob,ldl,hdl,triglycerides,hs_crp,blood_pressure",
        "Front-chest association, slightly toward the subject's left.",
        (Anchor(0.07, 0.69, 0.62, 0.20, 0.105, 0.55, "front"),),
    ),
    Region(
        4,
        "lungs_breathing",
        "Lungs & breathing",
        "respiratory",
        "spo2,vo2_max,respiratory_rate",
        "Bilateral upper-torso surface association.",
        (
            Anchor(-0.16, 0.70, 0.42, 0.20, 0.14, 0.72, "both"),
            Anchor(0.16, 0.70, 0.42, 0.20, 0.14, 0.72, "both"),
        ),
    ),
    Region(
        5,
        "liver",
        "Liver",
        "digestive",
        "alt,ast,ggt,alp,bilirubin,albumin",
        "Upper-right abdominal surface association; not an organ outline.",
        (Anchor(-0.17, 0.58, 0.62, 0.24, 0.095, 0.52, "front"),),
    ),
    Region(
        6,
        "pancreas_metabolism",
        "Pancreas & glucose control",
        "cardiometabolic",
        "fasting_glucose,hba1c,fasting_insulin,homa_ir",
        "Central upper-abdominal surface association.",
        (Anchor(0.03, 0.555, 0.55, 0.25, 0.07, 0.50, "front"),),
    ),
    Region(
        7,
        "digestive_tract",
        "Digestive tract",
        "digestive",
        "calprotectin,iron,b12,vitamin_d,microbiome",
        "Broad abdominal surface association.",
        (Anchor(0.0, 0.48, 0.48, 0.31, 0.14, 0.67, "front"),),
    ),
    Region(
        8,
        "kidneys_urinary",
        "Kidneys & urinary system",
        "renal",
        "creatinine,egfr,cystatin_c,bun,urine_albumin",
        "Bilateral subsurface projection of the kidney areas, visible through the front of the body.",
        (
            Anchor(-0.16, 0.535, -0.65, 0.17, 0.09, 0.48, "back"),
            Anchor(0.16, 0.535, -0.65, 0.17, 0.09, 0.48, "back"),
        ),
    ),
    Region(
        9,
        "pelvic_health",
        "Pelvic health",
        "systemic",
        "testosterone,estradiol,progesterone,shbg,psa",
        "Lower-torso and pelvic surface association.",
        (Anchor(0.0, 0.405, 0.20, 0.30, 0.10, 0.95, "both"),),
    ),
    Region(
        10,
        "upper_limbs",
        "Arms & hands",
        "musculoskeletal",
        "grip_strength,creatine_kinase,mobility",
        "Bilateral arm, forearm, and hand surface association.",
        (
            Anchor(-0.54, 0.60, 0.0, 0.30, 0.23, 1.05, "both"),
            Anchor(0.54, 0.60, 0.0, 0.30, 0.23, 1.05, "both"),
        ),
    ),
    Region(
        11,
        "lower_limbs",
        "Legs & feet",
        "musculoskeletal",
        "vo2_max,gait_speed,lean_mass,mobility",
        "Bilateral thigh, lower-leg, and foot surface association.",
        (
            Anchor(-0.19, 0.22, 0.0, 0.20, 0.23, 1.05, "both"),
            Anchor(0.19, 0.22, 0.0, 0.20, 0.23, 1.05, "both"),
        ),
    ),
    Region(
        12,
        "major_joints",
        "Major joints",
        "musculoskeletal",
        "hs_crp,vitamin_d,uric_acid,bone_density,mobility",
        "Bilateral shoulder, elbow, hip, and knee surface associations.",
        (
            Anchor(-0.28, 0.72, 0.0, 0.14, 0.065, 1.05, "both"),
            Anchor(0.28, 0.72, 0.0, 0.14, 0.065, 1.05, "both"),
            Anchor(-0.48, 0.58, 0.0, 0.12, 0.060, 1.05, "both"),
            Anchor(0.48, 0.58, 0.0, 0.12, 0.060, 1.05, "both"),
            Anchor(-0.17, 0.40, 0.0, 0.14, 0.070, 1.05, "both"),
            Anchor(0.17, 0.40, 0.0, 0.14, 0.070, 1.05, "both"),
            Anchor(-0.17, 0.20, 0.0, 0.13, 0.060, 1.05, "both"),
            Anchor(0.17, 0.20, 0.0, 0.13, 0.060, 1.05, "both"),
        ),
    ),
    Region(
        13,
        "spine_back",
        "Spine & back",
        "musculoskeletal",
        "bone_density,vitamin_d,calcium,posture,mobility",
        "Midline upper- and lower-back surface association.",
        (
            Anchor(0.0, 0.65, -0.70, 0.14, 0.16, 0.45, "back"),
            Anchor(0.0, 0.48, -0.70, 0.15, 0.13, 0.45, "back"),
        ),
    ),
    Region(
        14,
        "skin",
        "Skin",
        "systemic",
        "vitamin_d,inflammation,hydration",
        "Whole visible skin surface.",
        (Anchor(0.0, 0.50, 0.0, 1.08, 0.52, 1.10, "both"),),
    ),
    Region(
        15,
        "whole_body",
        "Whole body",
        "systemic",
        "biological_age,hs_crp,white_blood_cells,epigenetic_age",
        "Systemic association shown across the full body surface.",
        (Anchor(0.0, 0.50, 0.0, 1.08, 0.52, 1.10, "both"),),
    ),
)


def merged_config() -> dict[str, Any]:
    config = dict(DEFAULT_CONFIG)
    injected = globals().get("CONFIG")
    if injected is not None:
        if not isinstance(injected, dict):
            raise TypeError("CONFIG must be a dictionary")
        config.update(injected)

    profiles = config["profiles"]
    if not isinstance(profiles, list) or not profiles:
        raise ValueError("CONFIG.profiles must be a non-empty list")
    unknown = sorted(set(profiles) - set(PROFILE_CONFIG))
    if unknown:
        raise ValueError(f"Unknown profiles: {', '.join(unknown)}")

    config["weight_steps"] = max(4, min(64, int(config["weight_steps"])))
    config["front_sign"] = -1.0 if float(config["front_sign"]) < 0 else 1.0
    return config


def mesh_objects(collection: bpy.types.Collection) -> list[bpy.types.Object]:
    return [obj for obj in collection.all_objects if obj.type == "MESH"]


def source_collection(profile: str) -> bpy.types.Collection:
    name = PROFILE_CONFIG[profile]["collection"]
    collection = bpy.data.collections.get(name)
    if collection is None:
        available = sorted(c.name for c in bpy.data.collections)
        raise RuntimeError(f"Missing source collection {name!r}. Available: {available}")
    meshes = mesh_objects(collection)
    if len(meshes) < 1:
        raise RuntimeError(f"Source collection {name!r} has no mesh objects")
    return collection


def identify_body(objects: list[bpy.types.Object]) -> bpy.types.Object:
    if not objects:
        raise RuntimeError("Cannot identify a body from an empty mesh list")
    return max(
        objects,
        key=lambda obj: (len(obj.data.polygons), len(obj.data.vertices)),
    )


def body_coordinates(
    body: bpy.types.Object,
    front_sign: float,
) -> tuple[np.ndarray, dict[str, float]]:
    count = len(body.data.vertices)
    local = np.empty(count * 3, dtype=np.float64)
    body.data.vertices.foreach_get("co", local)
    local = local.reshape((-1, 3))

    matrix = np.asarray(body.matrix_world, dtype=np.float64)
    world = local @ matrix[:3, :3].T + matrix[:3, 3]
    minimum = world.min(axis=0)
    maximum = world.max(axis=0)
    height = float(maximum[2] - minimum[2])
    if not math.isfinite(height) or height <= 1e-7:
        raise RuntimeError(f"Body {body.name!r} has invalid height {height}")

    center_x = float((minimum[0] + maximum[0]) * 0.5)
    center_y = float((minimum[1] + maximum[1]) * 0.5)
    half_width = float((maximum[0] - minimum[0]) * 0.5)
    half_depth = float((maximum[1] - minimum[1]) * 0.5)
    if half_width <= 1e-7 or half_depth <= 1e-7:
        raise RuntimeError(f"Body {body.name!r} has invalid width or depth")

    normalized = np.empty_like(world)
    normalized[:, 0] = (world[:, 0] - center_x) / half_width
    normalized[:, 1] = (world[:, 2] - minimum[2]) / height
    normalized[:, 2] = front_sign * (world[:, 1] - center_y) / half_depth

    bounds = {
        "min_x": float(minimum[0]),
        "min_y": float(minimum[1]),
        "min_z": float(minimum[2]),
        "max_x": float(maximum[0]),
        "max_y": float(maximum[1]),
        "max_z": float(maximum[2]),
        "center_x": center_x,
        "center_y": center_y,
        "half_width": half_width,
        "half_depth": half_depth,
        "height": height,
    }
    return normalized, bounds


def ellipsoid_weights(points: np.ndarray, anchor: Anchor) -> np.ndarray:
    dx = (points[:, 0] - anchor.x) / anchor.rx
    dy = (points[:, 1] - anchor.y) / anchor.ry
    dz = (points[:, 2] - anchor.z) / anchor.rz
    squared_distance = dx * dx + dy * dy + dz * dz

    # Full intensity in the inner 25% of the ellipsoid, then a cubic smoothstep
    # to zero at its surface. This produces shader-friendly feathered groups.
    falloff = np.clip((1.0 - squared_distance) / 0.75, 0.0, 1.0)
    return falloff * falloff * (3.0 - 2.0 * falloff)


def region_weights(points: np.ndarray, region: Region) -> np.ndarray:
    if region.slug in {"skin", "whole_body"}:
        return np.ones(len(points), dtype=np.float32)
    weights = np.zeros(len(points), dtype=np.float64)
    for anchor in region.anchors:
        np.maximum(weights, ellipsoid_weights(points, anchor), out=weights)
    return weights.astype(np.float32)


def add_weighted_group(
    body: bpy.types.Object,
    group_name: str,
    weights: np.ndarray,
    steps: int,
) -> int:
    existing = body.vertex_groups.get(group_name)
    if existing is not None:
        body.vertex_groups.remove(existing)
    group = body.vertex_groups.new(name=group_name)

    quantized = np.rint(np.clip(weights, 0.0, 1.0) * (steps - 1)).astype(np.uint8)
    assigned = 0
    for bucket in np.unique(quantized):
        bucket_value = int(bucket)
        if bucket_value == 0:
            continue
        indices = np.flatnonzero(quantized == bucket).tolist()
        group.add(indices, bucket_value / (steps - 1), "REPLACE")
        assigned += len(indices)
    return assigned


def add_primary_region_attribute(
    body: bpy.types.Object,
    primary_ids: np.ndarray,
) -> None:
    name = "_health_region_id"
    existing = body.data.attributes.get(name)
    if existing is not None:
        body.data.attributes.remove(existing)
    attribute = body.data.attributes.new(name=name, type="INT", domain="POINT")
    attribute.data.foreach_set("value", primary_ids.astype(np.int32))


def region_catalog() -> list[dict[str, Any]]:
    return [
        {
            "id": region.id,
            "region_id": region.slug,
            "label": region.label,
            "category": region.category,
            "biomarkers": region.biomarkers.split(","),
            "surface_cue": region.surface_cue,
            "proxy_count": len(region.anchors),
        }
        for region in REGIONS
    ]


def add_body_semantics(
    body: bpy.types.Object,
    points: np.ndarray,
    profile: str,
    semantic_version: str,
    weight_steps: int,
) -> dict[str, Any]:
    best_weights = np.zeros(len(points), dtype=np.float32)
    primary_ids = np.zeros(len(points), dtype=np.uint8)
    group_counts: dict[str, int] = {}

    for region in REGIONS:
        weights = region_weights(points, region)
        group_counts[region.slug] = add_weighted_group(
            body,
            f"HL_{region.slug}",
            weights,
            weight_steps,
        )
        if region.slug not in {"skin", "whole_body"}:
            stronger = weights > best_weights
            primary_ids[stronger] = region.id
            best_weights[stronger] = weights[stronger]

    add_primary_region_attribute(body, primary_ids)
    catalog_json = json.dumps(region_catalog(), separators=(",", ":"))
    body["role"] = "anatomy_body"
    body["anatomy_schema"] = "halo.longevity-regions"
    body["semantic_version"] = semantic_version
    body["profile"] = profile
    body["region_catalog_json"] = catalog_json
    body.data["anatomy_schema"] = "halo.longevity-regions"
    body.data["semantic_version"] = semantic_version
    return {
        "vertex_count": len(points),
        "group_counts": group_counts,
        "assigned_primary_vertices": int(np.count_nonzero(primary_ids)),
    }


def remove_generated_collection(name: str) -> None:
    collection = bpy.data.collections.get(name)
    if collection is None:
        return
    for child in list(collection.children):
        remove_generated_collection(child.name)
    meshes = {obj.data for obj in collection.objects if obj.type == "MESH"}
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(collection)
    for mesh in meshes:
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def duplicate_source_profile(
    source: bpy.types.Collection,
    profile: str,
) -> tuple[bpy.types.Collection, bpy.types.Collection, list[bpy.types.Object], bpy.types.Object]:
    root_name = f"WEB_SEGMENTED_{profile.upper()}"
    proxy_name = f"WEB_ANATOMY_REGIONS_{profile.upper()}"
    remove_generated_collection(root_name)

    root = bpy.data.collections.new(root_name)
    proxy_collection = bpy.data.collections.new(proxy_name)
    bpy.context.scene.collection.children.link(root)
    root.children.link(proxy_collection)

    source_meshes = mesh_objects(source)
    source_body = identify_body(source_meshes)
    duplicates: list[bpy.types.Object] = []
    duplicate_body: bpy.types.Object | None = None

    for index, source_object in enumerate(source_meshes):
        world_matrix = source_object.matrix_world.copy()
        duplicate = source_object.copy()
        duplicate.data = source_object.data.copy()
        duplicate.animation_data_clear()
        duplicate.parent = None
        duplicate.matrix_world = world_matrix
        duplicate.hide_viewport = False
        duplicate.hide_render = False
        duplicate.hide_set(False)
        duplicate.name = (
            f"WEB_BODY__{profile}"
            if source_object == source_body
            else f"WEB_AUX__{profile}__{index:02d}"
        )
        duplicate.data.name = f"{duplicate.name}__mesh"
        root.objects.link(duplicate)
        duplicates.append(duplicate)
        if source_object == source_body:
            duplicate_body = duplicate

    if duplicate_body is None:
        raise RuntimeError(f"Failed to duplicate body for {profile}")
    return root, proxy_collection, duplicates, duplicate_body


def unit_proxy_mesh(profile: str) -> bpy.types.Mesh:
    mesh = bpy.data.meshes.new(f"ANATOMY_REGION_PROXY_UNIT__{profile}")
    editable = bmesh.new()
    bmesh.ops.create_icosphere(editable, subdivisions=1, radius=1.0)
    editable.to_mesh(mesh)
    editable.free()
    mesh.update()
    return mesh


def proxy_world_transform(
    anchor: Anchor,
    bounds: dict[str, float],
    front_sign: float,
) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    location = (
        bounds["center_x"] + anchor.x * bounds["half_width"],
        bounds["center_y"] + front_sign * anchor.z * bounds["half_depth"],
        bounds["min_z"] + anchor.y * bounds["height"],
    )
    scale = (
        anchor.rx * bounds["half_width"],
        anchor.rz * bounds["half_depth"],
        anchor.ry * bounds["height"],
    )
    return location, scale


def create_region_proxies(
    collection: bpy.types.Collection,
    profile: str,
    bounds: dict[str, float],
    front_sign: float,
    semantic_version: str,
) -> list[bpy.types.Object]:
    mesh = unit_proxy_mesh(profile)
    proxies: list[bpy.types.Object] = []

    for region in REGIONS:
        for index, anchor in enumerate(region.anchors):
            name = f"ANATOMY_REGION__{region.slug}__{index:02d}"
            proxy = bpy.data.objects.new(name, mesh)
            location, scale = proxy_world_transform(anchor, bounds, front_sign)
            proxy.location = location
            proxy.scale = scale
            proxy.rotation_euler = (0.0, 0.0, 0.0)
            proxy.display_type = "WIRE"
            proxy.show_in_front = True
            proxy["role"] = "anatomy_region_proxy"
            proxy["region_id"] = region.slug
            proxy["region_numeric_id"] = region.id
            proxy["label"] = region.label
            proxy["view"] = anchor.view
            proxy["semantic_version"] = semantic_version
            proxy["profile"] = profile
            proxy["category"] = region.category
            proxy["biomarkers_csv"] = region.biomarkers
            proxy["surface_cue"] = region.surface_cue
            proxy["shape"] = "ellipsoid"
            collection.objects.link(proxy)
            proxies.append(proxy)

    return proxies


def supported_gltf_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties
    supported = set(properties.keys())
    return {key: value for key, value in kwargs.items() if key in supported}


def export_profile(
    objects: list[bpy.types.Object],
    export_path: str,
) -> dict[str, Any]:
    os.makedirs(os.path.dirname(export_path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]

    kwargs: dict[str, Any] = {
        "filepath": export_path,
        "export_format": "GLB",
        "use_selection": True,
        "export_apply": True,
        "export_yup": True,
        "export_cameras": False,
        "export_lights": False,
        "export_extras": True,
        "export_vertex_color": "ACTIVE",
    }
    kwargs = supported_gltf_kwargs(kwargs)
    result = bpy.ops.export_scene.gltf(**kwargs)
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF export did not finish: {sorted(result)}")
    return {
        "path": export_path,
        "bytes": os.path.getsize(export_path),
        "options": sorted(kwargs.keys()),
    }


def inspect_profile(profile: str, front_sign: float) -> dict[str, Any]:
    collection = source_collection(profile)
    meshes = mesh_objects(collection)
    body = identify_body(meshes)
    _, bounds = body_coordinates(body, front_sign)
    return {
        "profile": profile,
        "source_collection": collection.name,
        "body_object": body.name,
        "body_mesh": body.data.name,
        "body_vertices": len(body.data.vertices),
        "body_polygons": len(body.data.polygons),
        "mesh_objects": [
            {
                "object": obj.name,
                "mesh": obj.data.name,
                "vertices": len(obj.data.vertices),
                "polygons": len(obj.data.polygons),
            }
            for obj in meshes
        ],
        "bounds": bounds,
    }


def segment_profile(profile: str, config: dict[str, Any]) -> dict[str, Any]:
    # Blender object names are global, so two profiles cannot simultaneously own
    # the exact same ANATOMY_REGION__* names. Generated data is disposable:
    # clear every generated profile before authoring the next one so each GLB
    # receives the stable, suffix-free node contract.
    for generated_profile in PROFILE_CONFIG:
        remove_generated_collection(f"WEB_SEGMENTED_{generated_profile.upper()}")

    source = source_collection(profile)
    root, proxy_collection, duplicates, body = duplicate_source_profile(source, profile)
    points, bounds = body_coordinates(body, config["front_sign"])
    semantics = add_body_semantics(
        body,
        points,
        profile,
        config["semantic_version"],
        config["weight_steps"],
    )
    proxies = create_region_proxies(
        proxy_collection,
        profile,
        bounds,
        config["front_sign"],
        config["semantic_version"],
    )
    body["proxy_collection"] = proxy_collection.name
    body["proxy_node_prefix"] = "ANATOMY_REGION__"

    export_result = None
    if config["export"]:
        filename = PROFILE_CONFIG[profile]["filename"]
        export_path = os.path.join(config["output_dir"], filename)
        export_result = export_profile([*duplicates, *proxies], export_path)

    return {
        "profile": profile,
        "source_collection": source.name,
        "generated_collection": root.name,
        "proxy_collection": proxy_collection.name,
        "body_object": body.name,
        "semantic_version": config["semantic_version"],
        "region_count": len(REGIONS),
        "proxy_count": len(proxies),
        "semantics": semantics,
        "export": export_result,
    }


def run(config: dict[str, Any]) -> dict[str, Any]:
    if config["action"] == "inspect":
        profiles = [
            inspect_profile(profile, config["front_sign"])
            for profile in config["profiles"]
        ]
    elif config["action"] == "segment":
        if config["export"] and not config["output_dir"]:
            raise ValueError("CONFIG.output_dir is required when export is enabled")
        profiles = [segment_profile(profile, config) for profile in config["profiles"]]
    else:
        raise ValueError(f"Unknown action {config['action']!r}")

    return {
        "status": "ok",
        "action": config["action"],
        "blender_version": bpy.app.version_string,
        "semantic_version": config["semantic_version"],
        "profiles": profiles,
    }


if __name__ == "__main__":
    try:
        print(RESULT_MARKER + json.dumps(run(merged_config()), separators=(",", ":")))
    except Exception as error:
        failure = {
            "status": "error",
            "type": type(error).__name__,
            "message": str(error),
            "traceback": traceback.format_exc(),
        }
        print(RESULT_MARKER + json.dumps(failure, separators=(",", ":")))
        raise
