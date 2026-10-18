export type LibraryGenome = Readonly<{
  id: string;
  fileName: string;
  sampleId: string;
}>;

// Curated panel genomes only; whole-genome files continue to use direct IBM uploads.
export const MAX_LIBRARY_GENOME_BYTES = 1024 * 1024;
export const LIBRARY_GENOMES: readonly LibraryGenome[] = [
  {
    id: "ibm-demo-90",
    fileName: "IBM-demo-90-MEFV-G6PD.vcf",
    sampleId: "NA19437",
  },
];
