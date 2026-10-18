import type { AnatomyRegionId } from "@crispr/human-model/anatomy";

// Demo report for the genome dashboard. Disease names, genes and inheritance
// mirror backend/crispr_backend/panel.py; statuses and symptom fit are sample
// values until the page reads a real `/orders/{id}` report.

export type FindingStatus = "likely" | "carrier" | "clear";
export type Inheritance = "Recessive" | "Dominant" | "X-linked";

export type BodySystemId =
  | "blood"
  | "liver"
  | "lungs"
  | "heart"
  | "metabolic"
  | "brain"
  | "bones"
  | "immune";

export interface BodySystem {
  readonly id: BodySystemId;
  readonly label: string;
  readonly regions: readonly AnatomyRegionId[];
}

export interface PanelResult {
  readonly name: string;
  readonly gene: string;
  readonly inheritance: Inheritance;
  readonly system: BodySystemId;
  readonly status: FindingStatus;
  /** Symptom similarity rank, 0–5. */
  readonly fit: number;
  readonly copies: string;
  readonly matchedSymptoms: string;
}

export interface EditPlanStep {
  readonly title: string;
  readonly detail: string;
  readonly done: boolean;
}

export interface GenomeReport {
  readonly kitId: string;
  readonly analysedOn: string;
  readonly summary: string;
  readonly results: readonly PanelResult[];
  readonly editPlan: {
    readonly gene: string;
    readonly condition: string;
    readonly approach: string;
    readonly steps: readonly EditPlanStep[];
    readonly limits: string;
  };
}

export const BODY_SYSTEMS: readonly BodySystem[] = [
  { id: "blood", label: "Blood & clotting", regions: ["whole_body"] },
  { id: "liver", label: "Liver & iron", regions: ["liver"] },
  { id: "lungs", label: "Lungs", regions: ["lungs_breathing"] },
  { id: "heart", label: "Heart & vessels", regions: ["heart_circulation"] },
  { id: "metabolic", label: "Metabolism", regions: ["pancreas_metabolism"] },
  { id: "brain", label: "Brain & nerves", regions: ["head_brain"] },
  {
    id: "bones",
    label: "Bones & growth",
    regions: ["spine_back", "major_joints"],
  },
  {
    id: "immune",
    label: "Immune & inflammation",
    regions: ["digestive_tract"],
  },
];

export const STATUS_LABEL: Record<FindingStatus, string> = {
  likely: "Likely",
  carrier: "Carrier",
  clear: "Clear",
};

/** Shader colours for the 3D highlights; CSS uses the matching tokens. */
export const STATUS_COLOR: Record<FindingStatus, string> = {
  likely: "#d23f8a",
  carrier: "#e3c93a",
  clear: "#2f9e6b",
};

export const STATUS_RANK: Record<FindingStatus, number> = {
  likely: 0,
  carrier: 1,
  clear: 2,
};

type Row = [
  name: string,
  gene: string,
  inheritance: Inheritance,
  system: BodySystemId,
  status: FindingStatus,
  fit: number,
  copies?: string,
  matchedSymptoms?: string,
];

const ROWS: readonly Row[] = [
  [
    "Hereditary hemochromatosis, type 1",
    "HFE",
    "Recessive",
    "liver",
    "likely",
    5,
    "Two copies",
    "Fatigue, joint pain",
  ],
  [
    "Alpha-1 antitrypsin deficiency",
    "SERPINA1",
    "Recessive",
    "lungs",
    "carrier",
    1,
    "One copy",
  ],
  ["Cystic fibrosis", "CFTR", "Recessive", "lungs", "carrier", 0, "One copy"],
  ["Wilson disease", "ATP7B", "Recessive", "liver", "clear", 2],
  ["Sickle cell anemia", "HBB", "Recessive", "blood", "clear", 1],
  ["Hemophilia A", "F8", "X-linked", "blood", "clear", 0],
  ["Hemophilia B", "F9", "X-linked", "blood", "clear", 0],
  ["G6PD deficiency", "G6PD", "X-linked", "blood", "clear", 1],
  ["Marfan syndrome", "FBN1", "Dominant", "heart", "clear", 1],
  [
    "Familial hypertrophic cardiomyopathy 4",
    "MYBPC3",
    "Dominant",
    "heart",
    "clear",
    0,
  ],
  [
    "Hereditary transthyretin amyloidosis",
    "TTR",
    "Dominant",
    "heart",
    "clear",
    1,
  ],
  ["Phenylketonuria", "PAH", "Recessive", "metabolic", "clear", 0],
  [
    "Medium-chain acyl-CoA dehydrogenase deficiency",
    "ACADM",
    "Recessive",
    "metabolic",
    "clear",
    0,
  ],
  ["Maple syrup urine disease", "BCKDHA", "Recessive", "metabolic", "clear", 0],
  [
    "Hereditary fructose intolerance",
    "ALDOB",
    "Recessive",
    "metabolic",
    "clear",
    1,
  ],
  ["Gaucher disease, type I", "GBA1", "Recessive", "metabolic", "clear", 1],
  ["Pompe disease", "GAA", "Recessive", "metabolic", "clear", 1],
  ["Fabry disease", "GLA", "X-linked", "metabolic", "clear", 1],
  ["Tay-Sachs disease", "HEXA", "Recessive", "brain", "clear", 0],
  ["Canavan disease", "ASPA", "Recessive", "brain", "clear", 0],
  ["Rett syndrome", "MECP2", "X-linked", "brain", "clear", 0],
  ["Neurofibromatosis type 1", "NF1", "Dominant", "brain", "clear", 0],
  ["Achondroplasia", "FGFR3", "Dominant", "bones", "clear", 0],
  ["Familial Mediterranean fever", "MEFV", "Recessive", "immune", "clear", 2],
];

export const DEMO_REPORT: GenomeReport = {
  kitId: "CR-2048",
  analysedOn: "2026-10-15",
  summary:
    "Most of your panel is clear. Your genome carries two copies of a known HFE variant linked to hereditary hemochromatosis, a condition where the body stores too much iron. That matches the fatigue and joint aches you described. A blood test for ferritin and transferrin saturation can confirm it.",
  results: ROWS.map(
    ([
      name,
      gene,
      inheritance,
      system,
      status,
      fit,
      copies = "None found",
      matchedSymptoms = "—",
    ]) => ({
      name,
      gene,
      inheritance,
      system,
      status,
      fit,
      copies,
      matchedSymptoms,
    }),
  ),
  editPlan: {
    gene: "HFE",
    condition: "Hereditary hemochromatosis",
    approach:
      "Both copies of HFE carry the same variant, so the plan explores correcting one copy in liver cells, where the iron-regulating protein is made.",
    steps: [
      {
        title: "Variant confirmed in your genome",
        detail:
          "Matched to a ClinVar pathogenic record with two or more review stars.",
        done: true,
      },
      {
        title: "Symptoms fit the condition",
        detail:
          "Your description ranked this condition first of 24 by phenotype similarity.",
        done: true,
      },
      {
        title: "Edit approach drafted",
        detail:
          "Correction of the single-letter change, with base editing noted as a gentler alternative.",
        done: true,
      },
      {
        title: "Review with a genetic counsellor",
        detail:
          "Confirm with a blood test and discuss standard care, which today is regular blood removal.",
        done: false,
      },
    ],
    limits:
      "Off-target effects are not assessed. Delivery, safety and dosing are out of scope. This is a research prototype run on a simulated genome.",
  },
};

export function countByStatus(
  results: readonly PanelResult[],
): Record<FindingStatus, number> {
  const counts: Record<FindingStatus, number> = {
    likely: 0,
    carrier: 0,
    clear: 0,
  };
  for (const result of results) counts[result.status] += 1;
  return counts;
}

export function worstStatus(results: readonly PanelResult[]): FindingStatus {
  return results.reduce<FindingStatus>(
    (worst, { status }) =>
      STATUS_RANK[status] < STATUS_RANK[worst] ? status : worst,
    "clear",
  );
}
