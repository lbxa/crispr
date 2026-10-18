/** GRCh38 chromosome lengths and p/q centromere boundaries (UCSC cytoBand, hg38), in bases. */
export const KARYOTYPE_GEOMETRY = [
  { id: "1", length: 248956422, centromere: 123400000 },
  { id: "2", length: 242193529, centromere: 93900000 },
  { id: "3", length: 198295559, centromere: 90900000 },
  { id: "4", length: 190214555, centromere: 50000000 },
  { id: "5", length: 181538259, centromere: 48800000 },
  { id: "6", length: 170805979, centromere: 59800000 },
  { id: "7", length: 159345973, centromere: 60100000 },
  { id: "8", length: 145138636, centromere: 45200000 },
  { id: "9", length: 138394717, centromere: 43000000 },
  { id: "10", length: 133797422, centromere: 39800000 },
  { id: "11", length: 135086622, centromere: 53400000 },
  { id: "12", length: 133275309, centromere: 35500000 },
  { id: "13", length: 114364328, centromere: 17700000 },
  { id: "14", length: 107043718, centromere: 17200000 },
  { id: "15", length: 101991189, centromere: 19000000 },
  { id: "16", length: 90338345, centromere: 36800000 },
  { id: "17", length: 83257441, centromere: 25100000 },
  { id: "18", length: 80373285, centromere: 18500000 },
  { id: "19", length: 58617616, centromere: 26200000 },
  { id: "20", length: 64444167, centromere: 28100000 },
  { id: "21", length: 46709983, centromere: 12000000 },
  { id: "22", length: 50818468, centromere: 15000000 },
  { id: "X", length: 156040895, centromere: 61000000 },
  { id: "Y", length: 57227415, centromere: 10400000 },
] as const;

export type KaryotypeChromosomeId = (typeof KARYOTYPE_GEOMETRY)[number]["id"];
