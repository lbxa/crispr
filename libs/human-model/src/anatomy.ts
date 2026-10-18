/**
 * Semantic surface projections shared by the male and female models.
 *
 * Normalized body space is independent of either mesh:
 * - x: -1 subject right, +1 subject left
 * - y: 0 soles, 1 crown
 * - z: -1 back, +1 front
 *
 * Anchors describe soft ellipsoids projected onto the skin. They are interaction
 * cues, not anatomical boundaries or diagnostic claims.
 */

export type AnatomyRegionId =
  | "head_brain"
  | "neck_thyroid"
  | "heart_circulation"
  | "lungs_breathing"
  | "liver"
  | "pancreas_metabolism"
  | "digestive_tract"
  | "kidneys_urinary"
  | "pelvic_health"
  | "upper_limbs"
  | "lower_limbs"
  | "major_joints"
  | "spine_back"
  | "skin"
  | "whole_body";

export type BodyView = "front" | "back" | "both";
export type NormalizedPoint = readonly [x: number, y: number, z: number];

export interface RegionAnchor {
  readonly center: NormalizedPoint;
  readonly radius: NormalizedPoint;
  readonly view: BodyView;
}

export interface AnatomyRegion {
  readonly id: AnatomyRegionId;
  readonly label: string;
  readonly category:
    | "cardiometabolic"
    | "digestive"
    | "endocrine"
    | "musculoskeletal"
    | "neurological"
    | "renal"
    | "respiratory"
    | "systemic";
  readonly anchors: readonly RegionAnchor[];
  readonly surfaceCue: string;
}

const anchor = (
  center: NormalizedPoint,
  radius: NormalizedPoint,
  view: BodyView,
): RegionAnchor => ({ center, radius, view });

export const ANATOMY_REGIONS = [
  {
    id: "head_brain",
    label: "Head & brain",
    category: "neurological",
    anchors: [anchor([0, 0.93, 0], [0.18, 0.09, 1.05], "both")],
    surfaceCue: "Whole-head surface association; not a brain outline.",
  },
  {
    id: "neck_thyroid",
    label: "Neck & thyroid",
    category: "endocrine",
    anchors: [anchor([0, 0.82, 0.62], [0.13, 0.055, 0.55], "front")],
    surfaceCue: "Front-neck surface association around the thyroid area.",
  },
  {
    id: "heart_circulation",
    label: "Heart & circulation",
    category: "cardiometabolic",
    anchors: [anchor([0.07, 0.69, 0.62], [0.2, 0.105, 0.55], "front")],
    surfaceCue: "Front-chest association, slightly toward the subject's left.",
  },
  {
    id: "lungs_breathing",
    label: "Lungs & breathing",
    category: "respiratory",
    anchors: [
      anchor([-0.16, 0.7, 0.42], [0.2, 0.14, 0.72], "both"),
      anchor([0.16, 0.7, 0.42], [0.2, 0.14, 0.72], "both"),
    ],
    surfaceCue: "Bilateral upper-torso surface association.",
  },
  {
    id: "liver",
    label: "Liver",
    category: "digestive",
    anchors: [anchor([-0.17, 0.58, 0.62], [0.24, 0.095, 0.52], "front")],
    surfaceCue:
      "Upper-right abdominal surface association; not an organ outline.",
  },
  {
    id: "pancreas_metabolism",
    label: "Pancreas & glucose regulation",
    category: "cardiometabolic",
    anchors: [anchor([0.03, 0.555, 0.55], [0.25, 0.07, 0.5], "front")],
    surfaceCue: "Central upper-abdominal surface association.",
  },
  {
    id: "digestive_tract",
    label: "Digestive tract",
    category: "digestive",
    anchors: [anchor([0, 0.48, 0.48], [0.31, 0.14, 0.67], "front")],
    surfaceCue: "Broad abdominal surface association.",
  },
  {
    id: "kidneys_urinary",
    label: "Kidneys & urinary system",
    category: "renal",
    anchors: [
      anchor([-0.16, 0.535, -0.65], [0.17, 0.09, 0.48], "back"),
      anchor([0.16, 0.535, -0.65], [0.17, 0.09, 0.48], "back"),
    ],
    surfaceCue:
      "Bilateral subsurface projection of the kidney areas, visible through the front of the body.",
  },
  {
    id: "pelvic_health",
    label: "Pelvic health",
    category: "systemic",
    anchors: [anchor([0, 0.405, 0.2], [0.3, 0.1, 0.95], "both")],
    surfaceCue: "Lower-torso and pelvic surface association.",
  },
  {
    id: "upper_limbs",
    label: "Arms & hands",
    category: "musculoskeletal",
    anchors: [
      anchor([-0.54, 0.6, 0], [0.3, 0.23, 1.05], "both"),
      anchor([0.54, 0.6, 0], [0.3, 0.23, 1.05], "both"),
    ],
    surfaceCue: "Bilateral arm, forearm, and hand surface association.",
  },
  {
    id: "lower_limbs",
    label: "Legs & feet",
    category: "musculoskeletal",
    anchors: [
      anchor([-0.19, 0.22, 0], [0.2, 0.23, 1.05], "both"),
      anchor([0.19, 0.22, 0], [0.2, 0.23, 1.05], "both"),
    ],
    surfaceCue: "Bilateral thigh, lower-leg, and foot surface association.",
  },
  {
    id: "major_joints",
    label: "Major joints",
    category: "musculoskeletal",
    anchors: [
      anchor([-0.28, 0.72, 0], [0.14, 0.065, 1.05], "both"),
      anchor([0.28, 0.72, 0], [0.14, 0.065, 1.05], "both"),
      anchor([-0.48, 0.58, 0], [0.12, 0.06, 1.05], "both"),
      anchor([0.48, 0.58, 0], [0.12, 0.06, 1.05], "both"),
      anchor([-0.17, 0.4, 0], [0.14, 0.07, 1.05], "both"),
      anchor([0.17, 0.4, 0], [0.14, 0.07, 1.05], "both"),
      anchor([-0.17, 0.2, 0], [0.13, 0.06, 1.05], "both"),
      anchor([0.17, 0.2, 0], [0.13, 0.06, 1.05], "both"),
    ],
    surfaceCue:
      "Bilateral shoulder, elbow, hip, and knee surface associations.",
  },
  {
    id: "spine_back",
    label: "Spine & back",
    category: "musculoskeletal",
    anchors: [
      anchor([0, 0.65, -0.7], [0.14, 0.16, 0.45], "back"),
      anchor([0, 0.48, -0.7], [0.15, 0.13, 0.45], "back"),
    ],
    surfaceCue: "Midline upper- and lower-back surface association.",
  },
  {
    id: "skin",
    label: "Skin",
    category: "systemic",
    anchors: [anchor([0, 0.5, 0], [1.08, 0.52, 1.1], "both")],
    surfaceCue: "Whole visible skin surface.",
  },
  {
    id: "whole_body",
    label: "Whole body",
    category: "systemic",
    anchors: [anchor([0, 0.5, 0], [1.08, 0.52, 1.1], "both")],
    surfaceCue: "Systemic association shown across the full body surface.",
  },
] as const satisfies readonly AnatomyRegion[];

export type ResultRegionStrength = "primary" | "secondary";

export interface HealthResultRegion {
  readonly regionId: AnatomyRegionId;
  readonly strength: ResultRegionStrength;
}

export interface HealthResultMapping {
  readonly key: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly regions: readonly HealthResultRegion[];
  readonly association: string;
}

export const HEALTH_RESULT_MAPPINGS = [
  {
    key: "phenylketonuria",
    label: "Phenylketonuria",
    aliases: ["PKU", "Phenylalanine hydroxylase deficiency"],
    regions: [{ regionId: "head_brain", strength: "primary" }],
    // https://medlineplus.gov/genetics/condition/phenylketonuria/
    association:
      "Shows the primary neurological association of PKU, without inferring current symptoms or treatment status.",
  },
  {
    key: "apob",
    label: "Apolipoprotein B",
    aliases: ["apo b"],
    regions: [
      { regionId: "heart_circulation", strength: "primary" },
      { regionId: "whole_body", strength: "secondary" },
    ],
    association:
      "Presented as a cardiovascular risk association, not a diagnosis.",
  },
  {
    key: "ldl_cholesterol",
    label: "LDL cholesterol",
    aliases: ["ldl", "ldl-c"],
    regions: [{ regionId: "heart_circulation", strength: "primary" }],
    association:
      "Presented as a cardiovascular risk association, not a diagnosis.",
  },
  {
    key: "blood_pressure",
    label: "Blood pressure",
    aliases: ["systolic blood pressure", "diastolic blood pressure"],
    regions: [
      { regionId: "heart_circulation", strength: "primary" },
      { regionId: "kidneys_urinary", strength: "secondary" },
      { regionId: "head_brain", strength: "secondary" },
    ],
    association: "Highlights commonly monitored cardiovascular target areas.",
  },
  {
    key: "hba1c",
    label: "HbA1c",
    aliases: ["a1c", "glycated hemoglobin"],
    regions: [
      { regionId: "pancreas_metabolism", strength: "primary" },
      { regionId: "whole_body", strength: "secondary" },
    ],
    association: "Shows glucose-regulation and systemic associations.",
  },
  {
    key: "fasting_glucose",
    label: "Fasting glucose",
    aliases: ["glucose"],
    regions: [
      { regionId: "pancreas_metabolism", strength: "primary" },
      { regionId: "whole_body", strength: "secondary" },
    ],
    association: "Shows glucose-regulation and systemic associations.",
  },
  {
    key: "alt_ast_ggt",
    label: "Liver enzymes",
    aliases: ["alt", "ast", "ggt", "alanine transaminase"],
    regions: [{ regionId: "liver", strength: "primary" }],
    association: "Surface association for liver-related laboratory results.",
  },
  {
    key: "egfr_creatinine",
    label: "Kidney function",
    aliases: ["egfr", "creatinine", "cystatin c"],
    regions: [{ regionId: "kidneys_urinary", strength: "primary" }],
    association:
      "Bilateral subsurface kidney projection visible through the front of the body.",
  },
  {
    key: "tsh",
    label: "Thyroid-stimulating hormone",
    aliases: ["thyroid stimulating hormone", "free t4", "free t3"],
    regions: [{ regionId: "neck_thyroid", strength: "primary" }],
    association: "Front-neck surface association for thyroid-related results.",
  },
  {
    key: "hs_crp",
    label: "High-sensitivity CRP",
    aliases: ["hs-crp", "crp", "c-reactive protein"],
    regions: [
      { regionId: "whole_body", strength: "primary" },
      { regionId: "heart_circulation", strength: "secondary" },
    ],
    association: "Uses a systemic cue because the marker is non-specific.",
  },
  {
    key: "vo2_max",
    label: "VO₂ max",
    aliases: ["vo2max", "cardiorespiratory fitness"],
    regions: [
      { regionId: "lungs_breathing", strength: "primary" },
      { regionId: "heart_circulation", strength: "primary" },
      { regionId: "lower_limbs", strength: "secondary" },
    ],
    association: "Shows cardiorespiratory and active-muscle associations.",
  },
  {
    key: "body_composition",
    label: "Body composition",
    aliases: ["body fat percentage", "lean mass", "visceral fat"],
    regions: [
      { regionId: "whole_body", strength: "primary" },
      { regionId: "pancreas_metabolism", strength: "secondary" },
    ],
    association: "Uses whole-body and metabolic surface cues.",
  },
  {
    key: "bone_density",
    label: "Bone density",
    aliases: ["bmd", "dexa", "osteoporosis risk"],
    regions: [
      { regionId: "spine_back", strength: "primary" },
      { regionId: "major_joints", strength: "secondary" },
    ],
    association:
      "Highlights common skeletal assessment areas without depicting bone.",
  },
  {
    key: "grip_strength",
    label: "Grip strength",
    aliases: ["hand grip strength"],
    regions: [
      { regionId: "upper_limbs", strength: "primary" },
      { regionId: "whole_body", strength: "secondary" },
    ],
    association:
      "Shows the tested limbs and a secondary whole-body fitness association.",
  },
  {
    key: "cognitive_health",
    label: "Cognitive health",
    aliases: ["cognitive score", "memory", "reaction time"],
    regions: [{ regionId: "head_brain", strength: "primary" }],
    association:
      "Uses a whole-head cue rather than implying a localized finding.",
  },
  {
    key: "digestive_health",
    label: "Digestive health",
    aliases: ["microbiome", "gut health", "stool test"],
    regions: [{ regionId: "digestive_tract", strength: "primary" }],
    association:
      "Uses a broad abdominal cue because results are not spatially diagnostic.",
  },
  {
    key: "sex_hormones",
    label: "Sex hormones",
    aliases: ["testosterone", "estradiol", "progesterone"],
    regions: [
      { regionId: "pelvic_health", strength: "primary" },
      { regionId: "whole_body", strength: "secondary" },
    ],
    association:
      "Shows pelvic and systemic associations shared across model profiles.",
  },
  {
    key: "vitamin_d",
    label: "Vitamin D",
    aliases: ["25-oh vitamin d", "25 hydroxy vitamin d"],
    regions: [
      { regionId: "major_joints", strength: "primary" },
      { regionId: "whole_body", strength: "secondary" },
    ],
    association: "Shows musculoskeletal and systemic associations.",
  },
  {
    key: "skin_health",
    label: "Skin health",
    aliases: ["dermatology", "skin age"],
    regions: [{ regionId: "skin", strength: "primary" }],
    association: "Highlights the visible skin surface only.",
  },
] as const satisfies readonly HealthResultMapping[];

const normalizeResultKey = (value: string): string =>
  value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");

export function getAnatomyRegion(id: AnatomyRegionId): AnatomyRegion {
  const region = ANATOMY_REGIONS.find((candidate) => candidate.id === id);
  if (!region) throw new Error(`Unknown anatomy region: ${id}`);
  return region;
}

export function findHealthResultMapping(
  resultName: string,
): HealthResultMapping | undefined {
  const normalized = normalizeResultKey(resultName);
  return HEALTH_RESULT_MAPPINGS.find(({ key, label, aliases }) =>
    [key, label, ...aliases].some(
      (candidate) => normalizeResultKey(candidate) === normalized,
    ),
  );
}

/**
 * Returns a smooth 0–1 mask value for a normalized surface position.
 * Multiple anchors combine using their strongest influence.
 */
export function calculateRegionInfluence(
  regionId: AnatomyRegionId,
  point: NormalizedPoint,
): number {
  const region = getAnatomyRegion(regionId);
  let strongest = 0;

  for (const { center, radius } of region.anchors) {
    const dx = (point[0] - center[0]) / radius[0];
    const dy = (point[1] - center[1]) / radius[1];
    const dz = (point[2] - center[2]) / radius[2];
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    const influence = Math.max(0, 1 - distanceSquared);
    strongest = Math.max(strongest, influence * influence);
  }

  return strongest;
}
