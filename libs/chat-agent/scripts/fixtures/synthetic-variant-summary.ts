/**
 * Format fixture for variant_summary parsing. Every value is synthetic: VariationIDs in
 * the 9xxxxxxxx range and "SYNTHETIC" names. These are not ClinVar records.
 */
export const HEADER = [
  "#AlleleID",
  "Type",
  "Name",
  "GeneID",
  "GeneSymbol",
  "HGNC_ID",
  "ClinicalSignificance",
  "ClinSigSimple",
  "LastEvaluated",
  "RS# (dbSNP)",
  "nsv/esv (dbVar)",
  "RCVaccession",
  "PhenotypeIDS",
  "PhenotypeList",
  "Origin",
  "OriginSimple",
  "Assembly",
  "ChromosomeAccession",
  "Chromosome",
  "Start",
  "Stop",
  "ReferenceAllele",
  "AlternateAllele",
  "Cytogenetic",
  "ReviewStatus",
  "NumberSubmitters",
  "Guidelines",
  "TestedInGTR",
  "OtherIDs",
  "SubmitterCategories",
  "VariationID",
  "PositionVCF",
  "ReferenceAlleleVCF",
  "AlternateAlleleVCF",
].join("\t");

export function row(o: Partial<Record<string, string>>): string {
  const v: Record<string, string> = {
    Type: "single nucleotide variant",
    Name: "SYNTHETIC(CFTR):c.1A>G (p.Met1Val)",
    GeneSymbol: "CFTR",
    ClinicalSignificance: "Pathogenic",
    LastEvaluated: "Jan 01, 2024",
    "RS# (dbSNP)": "-1",
    RCVaccession: "RCV900000001",
    PhenotypeIDS: "MONDO:MONDO:0009061,MedGen:C0010674,OMIM:219700",
    PhenotypeList: "Cystic fibrosis",
    Assembly: "GRCh38",
    Chromosome: "7",
    ReviewStatus: "criteria provided, multiple submitters, no conflicts",
    NumberSubmitters: "3",
    VariationID: "900000001",
    PositionVCF: "100",
    ReferenceAlleleVCF: "A",
    AlternateAlleleVCF: "G",
    ...o,
  };
  return HEADER.replace(/^#/, "")
    .split("\t")
    .map((h) => v[h] ?? "-")
    .join("\t");
}
