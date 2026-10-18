export interface DiseasePhenotype {
  id: string;
  label: string;
  /** Fraction of patients with the disease who show this feature (0..1). */
  frequency: number;
}

export interface PhenotypeMatch {
  /** Share of the patient's terms that the disease explains. */
  coverage: number;
  /** Share of the disease's key features (frequency >= keyThreshold) the patient shows. */
  recall: number;
  /** Frequency mass of matched features / frequency mass of all disease features. */
  freqWeighted: number;
  matched: string[];
  /** Patient terms the disease does not explain. */
  unexplained: string[];
  /** Key disease features the patient does not report. */
  missingKey: string[];
  keyThreshold: number;
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

/** Pure set arithmetic over HPO-style term ids. No ontology-ancestor similarity yet. */
export function scorePhenotypes(
  patientTerms: readonly string[],
  disease: readonly DiseasePhenotype[],
  keyThreshold = 0.3,
): PhenotypeMatch {
  const patient = new Set(patientTerms);
  const byId = new Map(disease.map((d) => [d.id, d]));
  const matched = [...patient].filter((id) => byId.has(id));
  const unexplained = [...patient].filter((id) => !byId.has(id));
  const key = disease.filter((d) => d.frequency >= keyThreshold);
  const keyHit = key.filter((d) => patient.has(d.id));
  const totalMass = disease.reduce((s, d) => s + d.frequency, 0);
  const matchedMass = matched.reduce(
    (s, id) => s + (byId.get(id)?.frequency ?? 0),
    0,
  );
  return {
    coverage: ratio(matched.length, patient.size),
    recall: ratio(keyHit.length, key.length),
    freqWeighted: ratio(matchedMass, totalMass),
    matched,
    unexplained,
    missingKey: key.filter((d) => !patient.has(d.id)).map((d) => d.id),
    keyThreshold,
  };
}

export const round2 = (x: number) => Math.round(x * 100) / 100;
