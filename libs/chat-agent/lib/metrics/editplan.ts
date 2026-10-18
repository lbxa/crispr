import type { DiseaseProps, VariantProps } from "../graph/types";
import { classifyEdit, type Guide } from "./guides";

export type EditType = "hdr" | "base_edit" | "prime_edit" | "knockout";

export interface EditCriterion {
  label: string;
  value: string;
  /** true = favourable, false = unfavourable, null = informational. */
  ok: boolean | null;
}

export interface EditOption {
  type: EditType;
  label: string;
  feasible: boolean;
  criteria: EditCriterion[];
  caveat?: string;
  /** Present on every option on purpose. */
  offTarget: "not_assessed";
}

export const HDR_MAX_CUT_DISTANCE = 10;
export const PRIME_MAX_EDIT_SIZE = 30;

export interface PlanInput {
  variant: VariantProps;
  disease?: DiseaseProps;
  guides: Guide[];
  sequenceSource: string;
}

/**
 * Compare edit strategies for one variant against the same criteria.
 * Rules of thumb only; these are screening heuristics, not protocols.
 */
export function planEdits({
  variant,
  disease,
  guides,
  sequenceSource,
}: PlanInput): EditOption[] {
  const locus = variant.locus;
  const synthetic = sequenceSource === "synthetic";
  const seqNote: EditCriterion = {
    label: "Sequence source",
    value: synthetic ? "synthetic placeholder" : sequenceSource,
    ok: synthetic ? false : null,
  };
  const best = guides[0];
  const editClass = locus ? classifyEdit(locus.ref, locus.alt) : null;
  const options: EditOption[] = [];

  // HDR / correction
  {
    const criteria: EditCriterion[] = [seqNote];
    let feasible = false;
    if (!locus) {
      criteria.push({ label: "Locus", value: "not loaded", ok: false });
    } else if (!best) {
      criteria.push({
        label: "Guides",
        value: "no PAM within 30 bp of the variant",
        ok: false,
      });
    } else {
      feasible = best.cutDistance <= HDR_MAX_CUT_DISTANCE;
      criteria.push(
        {
          label: "Cut-to-variant distance",
          value: `${best.cutDistance} bp`,
          ok: feasible,
        },
        { label: "Donor template", value: "not designed here", ok: null },
      );
    }
    options.push({
      type: "hdr",
      label: "HDR correction",
      feasible,
      criteria,
      caveat:
        "Homology-directed repair is inefficient in non-dividing cells and competes with indel-forming repair.",
      offTarget: "not_assessed",
    });
  }

  // Base editing
  {
    const criteria: EditCriterion[] = [seqNote];
    let feasible = false;
    if (!locus) {
      criteria.push({ label: "Locus", value: "not loaded", ok: false });
    } else if (editClass !== "transition") {
      criteria.push({
        label: "Edit class",
        value: editClass === "indel" ? "insertion/deletion" : "transversion",
        ok: false,
      });
    } else {
      const fits = guides.filter((g) => g.baseEdit?.inWindow);
      const pick = [...fits].sort(
        (a, b) =>
          a.baseEdit!.bystanders - b.baseEdit!.bystanders || a.rank - b.rank,
      )[0];
      if (pick?.baseEdit) {
        feasible = true;
        criteria.push(
          { label: "Editor", value: pick.baseEdit.editor, ok: true },
          {
            label: "Position in protospacer",
            value: `${pick.baseEdit.position} (window 4-8)`,
            ok: true,
          },
          {
            label: "Bystander edits in window",
            value: String(pick.baseEdit.bystanders),
            ok: pick.baseEdit.bystanders === 0,
          },
        );
      } else {
        criteria.push({
          label: "Guides",
          value: "no nearby PAM puts the base in the editing window",
          ok: false,
        });
      }
    }
    options.push({
      type: "base_edit",
      label: "Base editing",
      feasible,
      criteria,
      caveat:
        "Window and editor choice vary by deaminase; bystander edits can change neighbouring codons.",
      offTarget: "not_assessed",
    });
  }

  // Prime editing
  {
    const size = locus ? Math.max(locus.ref.length, locus.alt.length) : null;
    const feasible = size !== null && size <= PRIME_MAX_EDIT_SIZE;
    options.push({
      type: "prime_edit",
      label: "Prime editing",
      feasible,
      criteria: [
        seqNote,
        {
          label: "Edit size",
          value: size === null ? "locus not loaded" : `${size} bp`,
          ok: size === null ? false : feasible,
        },
        { label: "pegRNA design", value: "not performed here", ok: null },
      ],
      caveat:
        "Flexible across edit types, but generally lower and more variable efficiency than the alternatives.",
      offTarget: "not_assessed",
    });
  }

  // Knockout: only sensible when a healthy copy remains and the faulty copy is itself harmful.
  {
    const dominantHarm =
      disease !== undefined &&
      (disease.inheritance === "AD" || disease.inheritance === "XLD") &&
      (disease.mechanism === "gain_of_function" ||
        disease.mechanism === "dominant_negative");
    options.push({
      type: "knockout",
      label: "Disrupt the faulty copy",
      feasible: dominantHarm,
      criteria: [
        {
          label: "Inheritance",
          value: disease?.inheritance ?? "unknown",
          ok: dominantHarm ? true : null,
        },
        {
          label: "Mechanism",
          value: disease?.mechanism.replace(/_/g, " ") ?? "unknown",
          ok: dominantHarm ? true : null,
        },
      ],
      caveat: dominantHarm
        ? "Leaves one healthy copy; haploinsufficiency of the remaining copy still needs checking."
        : "Only considered for dominant gain-of-function or dominant-negative disease where a healthy copy remains. Recessive disease needs the function restored, not removed.",
      offTarget: "not_assessed",
    });
  }

  return options;
}
