import { KnowledgeGraph } from "./graph";
import { ingestPatient, type PatientFinding } from "./ingest";
import {
  makeEdge,
  makeNode,
  type DiseaseProps,
  type GeneProps,
  type VariantProps,
} from "./types";

/**
 * ILLUSTRATIVE SEED, NOT CLINICAL DATA.
 *
 * Written from general knowledge without access to ClinVar, HPO, Ensembl or gnomAD, so
 * nothing here has been checked against those sources. In particular:
 *   - genomic coordinates are unverified (locus.verified === false). Use
 *     EnsemblSequenceProvider's refCheck to test them where the network is available.
 *   - review stars and phenotype frequencies are coarse placeholders
 *     (frequency bands: 0.9 very frequent, 0.55 frequent, 0.17 occasional).
 *   - gnomAD allele frequencies are null (not loaded).
 * Every node carries prov: 'illustrative-seed' and the UI payloads forward it.
 * Replace this module's output with your ClinVar import; the retrieval layer does not care.
 */
export const SEED_NOTICE =
  "Illustrative seed data (unverified, not from ClinVar/HPO/gnomAD). Simulated patients only. Not medical advice.";

type GeneSeed = Omit<GeneProps, "assembly"> & { aliases: string[] };

const GENES: GeneSeed[] = [
  {
    symbol: "CFTR",
    name: "CF transmembrane conductance regulator",
    chrom: "7",
    strand: "+",
    proteinLength: 1480,
    aliases: ["cystic fibrosis gene"],
  },
  {
    symbol: "HBB",
    name: "Hemoglobin subunit beta",
    chrom: "11",
    strand: "-",
    proteinLength: 147,
    aliases: ["beta globin", "hemoglobin beta"],
  },
  {
    symbol: "ATP7B",
    name: "ATPase copper transporting beta",
    chrom: "13",
    strand: "-",
    proteinLength: 1465,
    aliases: ["wilson disease gene"],
  },
  {
    symbol: "SERPINA1",
    name: "Serpin family A member 1 (alpha-1 antitrypsin)",
    chrom: "14",
    strand: "-",
    proteinLength: 418,
    aliases: ["A1AT", "AAT", "alpha 1 antitrypsin gene"],
  },
  {
    symbol: "HFE",
    name: "Homeostatic iron regulator",
    chrom: "6",
    strand: "+",
    proteinLength: 348,
    aliases: ["hemochromatosis gene"],
  },
];

interface VariantSeed {
  id: string;
  gene: string;
  diseases: string[];
  aliases: string[];
  props: VariantProps;
}

const unverified = (chrom: string, pos: number, ref: string, alt: string) => ({
  chrom,
  pos,
  ref,
  alt,
  assembly: "GRCh38" as const,
  verified: false,
});

const VARIANTS: VariantSeed[] = [
  {
    id: "var:CFTR:F508del",
    gene: "CFTR",
    diseases: ["dis:cystic-fibrosis"],
    aliases: [
      "F508del",
      "p.Phe508del",
      "Phe508del",
      "c.1521_1523del",
      "rs113993960",
      "delta F508",
      "deltaF508",
    ],
    props: {
      hgvsc: "c.1521_1523del",
      hgvsp: "p.Phe508del",
      rsid: "rs113993960",
      proteinPos: 508,
      consequence: "inframe_deletion",
      clinvarSignificance: "Pathogenic",
      reviewStars: 3,
      gnomadAf: null,
      locus: unverified("7", 117559590, "CTT", ""),
    },
  },
  {
    id: "var:CFTR:G542X",
    gene: "CFTR",
    diseases: ["dis:cystic-fibrosis"],
    aliases: ["G542X", "p.Gly542Ter", "c.1624G>T", "rs113993959"],
    props: {
      hgvsc: "c.1624G>T",
      hgvsp: "p.Gly542Ter",
      rsid: "rs113993959",
      proteinPos: 542,
      consequence: "nonsense",
      clinvarSignificance: "Pathogenic",
      reviewStars: 3,
      gnomadAf: null,
      locus: null,
    },
  },
  {
    id: "var:CFTR:G551D",
    gene: "CFTR",
    diseases: ["dis:cystic-fibrosis"],
    aliases: ["G551D", "p.Gly551Asp", "c.1652G>A", "rs75527207"],
    props: {
      hgvsc: "c.1652G>A",
      hgvsp: "p.Gly551Asp",
      rsid: "rs75527207",
      proteinPos: 551,
      consequence: "missense",
      clinvarSignificance: "Pathogenic",
      reviewStars: 3,
      gnomadAf: null,
      locus: null,
    },
  },
  {
    id: "var:HBB:E6V",
    gene: "HBB",
    diseases: ["dis:sickle-cell-disease"],
    aliases: [
      "E6V",
      "Glu6Val",
      "p.Glu7Val",
      "c.20A>T",
      "rs334",
      "HbS",
      "sickle variant",
    ],
    props: {
      hgvsc: "c.20A>T",
      hgvsp: "p.Glu7Val",
      legacyName: "Glu6Val",
      rsid: "rs334",
      proteinPos: 7,
      consequence: "missense",
      clinvarSignificance: "Pathogenic",
      reviewStars: 3,
      gnomadAf: null,
      // HBB is on the minus strand, so the coding A>T is T>A on the forward strand.
      locus: unverified("11", 5227002, "T", "A"),
    },
  },
  {
    id: "var:ATP7B:H1069Q",
    gene: "ATP7B",
    diseases: ["dis:wilson-disease"],
    aliases: [
      "H1069Q",
      "p.His1069Gln",
      "His1069Gln",
      "c.3207C>A",
      "rs76151636",
    ],
    props: {
      hgvsc: "c.3207C>A",
      hgvsp: "p.His1069Gln",
      rsid: "rs76151636",
      proteinPos: 1069,
      consequence: "missense",
      clinvarSignificance: "Pathogenic",
      reviewStars: 2,
      gnomadAf: null,
      // Minus-strand gene: coding C>A is G>T on the forward strand.
      locus: unverified("13", 51944145, "G", "T"),
    },
  },
  {
    id: "var:SERPINA1:Z",
    gene: "SERPINA1",
    diseases: ["dis:alpha1-antitrypsin-deficiency"],
    aliases: [
      "Z allele",
      "PiZ",
      "E342K",
      "Glu342Lys",
      "p.Glu366Lys",
      "c.1096G>A",
      "rs28929474",
    ],
    props: {
      hgvsc: "c.1096G>A",
      hgvsp: "p.Glu366Lys",
      legacyName: "Glu342Lys",
      rsid: "rs28929474",
      proteinPos: 366,
      consequence: "missense",
      clinvarSignificance: "Pathogenic",
      reviewStars: 3,
      gnomadAf: null,
      // Minus-strand gene: coding G>A is C>T on the forward strand.
      locus: unverified("14", 94378610, "C", "T"),
    },
  },
  {
    id: "var:HFE:C282Y",
    gene: "HFE",
    diseases: ["dis:hereditary-hemochromatosis"],
    aliases: ["C282Y", "Cys282Tyr", "p.Cys282Tyr", "c.845G>A", "rs1800562"],
    props: {
      hgvsc: "c.845G>A",
      hgvsp: "p.Cys282Tyr",
      rsid: "rs1800562",
      proteinPos: 282,
      consequence: "missense",
      clinvarSignificance: "Pathogenic",
      reviewStars: 3,
      gnomadAf: null,
      locus: unverified("6", 26092913, "G", "A"),
    },
  },
];

interface DiseaseSeed {
  id: string;
  label: string;
  aliases: string[];
  props: Omit<DiseaseProps, "name">;
  organs: Array<{ organ: string; primary: boolean }>;
  /** [hpo id, frequency] */
  phenotypes: Array<[string, number]>;
}

const DISEASES: DiseaseSeed[] = [
  {
    id: "dis:cystic-fibrosis",
    label: "Cystic fibrosis",
    aliases: ["CF", "mucoviscidosis"],
    props: { inheritance: "AR", mechanism: "loss_of_function", omim: "219700" },
    organs: [
      { organ: "org:lung", primary: true },
      { organ: "org:pancreas", primary: true },
      { organ: "org:liver", primary: false },
    ],
    phenotypes: [
      ["hp:0006538", 0.9],
      ["hp:0001738", 0.9],
      ["hp:0012735", 0.9],
      ["hp:0000027", 0.9],
      ["hp:0002110", 0.55],
      ["hp:0001508", 0.55],
      ["hp:0002024", 0.55],
      ["hp:0002094", 0.55],
      ["hp:0001394", 0.17],
      ["hp:0000819", 0.17],
    ],
  },
  {
    id: "dis:sickle-cell-disease",
    label: "Sickle cell disease",
    aliases: [
      "sickle cell anemia",
      "sickle cell anaemia",
      "sickle cell",
      "SCD",
      "HbSS disease",
    ],
    props: { inheritance: "AR", mechanism: "gain_of_function", omim: "603903" },
    organs: [{ organ: "org:blood", primary: true }],
    phenotypes: [
      ["hp:0001878", 0.9],
      ["hp:0001903", 0.9],
      ["hp:0012378", 0.55],
      ["hp:0000952", 0.55],
      ["hp:0001744", 0.55],
      ["hp:0002829", 0.55],
      ["hp:0001297", 0.17],
    ],
  },
  {
    id: "dis:wilson-disease",
    label: "Wilson disease",
    aliases: ["hepatolenticular degeneration", "copper overload disease"],
    props: { inheritance: "AR", mechanism: "loss_of_function", omim: "277900" },
    organs: [
      { organ: "org:liver", primary: true },
      { organ: "org:brain", primary: false },
    ],
    phenotypes: [
      ["hp:0002910", 0.9],
      ["hp:0001394", 0.55],
      ["hp:0002240", 0.55],
      ["hp:0001337", 0.55],
      ["hp:0001260", 0.55],
      ["hp:0012378", 0.55],
      ["hp:0000716", 0.17],
      ["hp:0000952", 0.17],
      ["hp:0001878", 0.17],
      ["hp:0002829", 0.17],
    ],
  },
  {
    id: "dis:alpha1-antitrypsin-deficiency",
    label: "Alpha-1 antitrypsin deficiency",
    aliases: ["AATD", "A1AT deficiency", "alpha 1 antitrypsin deficiency"],
    props: {
      inheritance: "AR",
      mechanism: "mixed",
      omim: "613490",
      note: "Toxic gain of function in the liver plus loss of function in the lung.",
    },
    organs: [
      { organ: "org:liver", primary: true },
      { organ: "org:lung", primary: true },
    ],
    phenotypes: [
      ["hp:0002097", 0.55],
      ["hp:0002094", 0.55],
      ["hp:0002910", 0.55],
      ["hp:0001394", 0.17],
      ["hp:0000952", 0.17],
      ["hp:0002240", 0.17],
    ],
  },
  {
    id: "dis:hereditary-hemochromatosis",
    label: "Hereditary hemochromatosis",
    aliases: [
      "HFE hemochromatosis",
      "iron overload",
      "haemochromatosis",
      "hemochromatosis",
    ],
    props: {
      inheritance: "AR",
      mechanism: "loss_of_function",
      omim: "235200",
      note: "Reduced penetrance: many homozygotes never develop disease.",
    },
    organs: [
      { organ: "org:liver", primary: true },
      { organ: "org:pancreas", primary: false },
    ],
    phenotypes: [
      ["hp:0012378", 0.55],
      ["hp:0002829", 0.55],
      ["hp:0000953", 0.55],
      ["hp:0002240", 0.55],
      ["hp:0002910", 0.55],
      ["hp:0000819", 0.17],
      ["hp:0001394", 0.17],
    ],
  },
];

const PHENOTYPES: Array<[id: string, label: string, synonyms: string[]]> = [
  ["hp:0002110", "Bronchiectasis", []],
  [
    "hp:0006538",
    "Recurrent bronchopulmonary infections",
    [
      "recurrent chest infections",
      "recurrent lung infections",
      "chest infections",
      "frequent chest infections",
    ],
  ],
  [
    "hp:0001738",
    "Exocrine pancreatic insufficiency",
    ["pancreatic insufficiency", "poor fat digestion"],
  ],
  [
    "hp:0001508",
    "Failure to thrive",
    ["poor weight gain", "not gaining weight"],
  ],
  ["hp:0002024", "Malabsorption", []],
  ["hp:0012735", "Cough", ["persistent cough", "chronic cough"]],
  [
    "hp:0002094",
    "Dyspnea",
    ["shortness of breath", "breathlessness", "short of breath"],
  ],
  ["hp:0001903", "Anemia", ["anaemia", "low hemoglobin"]],
  [
    "hp:0001878",
    "Hemolytic anemia",
    ["haemolytic anaemia", "haemolytic anemia"],
  ],
  [
    "hp:0000952",
    "Jaundice",
    [
      "yellow eyes",
      "yellow skin",
      "yellowing of the eyes",
      "yellowing of the skin",
      "yellow eyes and skin",
    ],
  ],
  ["hp:0012378", "Fatigue", ["tired", "tiredness", "exhaustion", "exhausted"]],
  ["hp:0002829", "Arthralgia", ["joint pain", "achy joints", "painful joints"]],
  ["hp:0001744", "Splenomegaly", ["enlarged spleen"]],
  ["hp:0002240", "Hepatomegaly", ["enlarged liver"]],
  ["hp:0001394", "Cirrhosis", ["liver scarring"]],
  [
    "hp:0002910",
    "Elevated hepatic transaminase",
    ["elevated liver enzymes", "raised liver enzymes", "high liver enzymes"],
  ],
  ["hp:0001337", "Tremor", ["shaking hands", "hand tremor"]],
  ["hp:0001260", "Dysarthria", ["slurred speech"]],
  ["hp:0000716", "Depression", []],
  [
    "hp:0000953",
    "Hyperpigmentation of the skin",
    ["skin darkening", "bronze skin", "bronzing of the skin"],
  ],
  ["hp:0000819", "Diabetes mellitus", ["diabetes"]],
  ["hp:0002097", "Emphysema", []],
  ["hp:0001297", "Stroke", []],
  ["hp:0000027", "Azoospermia", ["male infertility"]],
];

const ORGANS: Array<
  [id: string, label: string, uberon: string, aliases: string[]]
> = [
  ["org:liver", "Liver", "UBERON:0002107", ["hepatic"]],
  ["org:lung", "Lung", "UBERON:0002048", ["lungs", "pulmonary", "respiratory"]],
  [
    "org:blood",
    "Blood",
    "UBERON:0000178",
    ["hematologic", "haematological", "red blood cells"],
  ],
  ["org:pancreas", "Pancreas", "UBERON:0001264", ["pancreatic"]],
  ["org:brain", "Brain", "UBERON:0000955", ["neurological"]],
];

const EXPRESSION: Array<
  [gene: string, organ: string, level: "high" | "medium" | "low"]
> = [
  ["CFTR", "org:lung", "high"],
  ["CFTR", "org:pancreas", "high"],
  ["CFTR", "org:liver", "low"],
  ["HBB", "org:blood", "high"],
  ["ATP7B", "org:liver", "high"],
  ["ATP7B", "org:brain", "medium"],
  ["SERPINA1", "org:liver", "high"],
  ["SERPINA1", "org:lung", "medium"],
  ["HFE", "org:liver", "high"],
];

export const SEED_PATIENTS: PatientFinding[] = [
  {
    patientId: "sim-001",
    sex: "F",
    aliases: ["patient 1", "patient one"],
    variants: [{ variant: "var:CFTR:F508del", zygosity: "hom" }],
    phenotypes: ["hp:0002110", "hp:0006538", "hp:0001738", "hp:0012378"],
  },
  {
    patientId: "sim-002",
    sex: "M",
    aliases: ["patient 2", "patient two"],
    variants: [{ variant: "var:HBB:E6V", zygosity: "het" }],
    phenotypes: ["hp:0012378", "hp:0000952"],
  },
  {
    patientId: "sim-003",
    sex: "F",
    aliases: ["patient 3", "patient three"],
    variants: [{ variant: "var:ATP7B:H1069Q", zygosity: "hom" }],
    phenotypes: ["hp:0002910", "hp:0001337", "hp:0000716", "hp:0012378"],
  },
  {
    patientId: "sim-004",
    sex: "M",
    aliases: ["patient 4", "patient four"],
    variants: [{ variant: "var:HFE:C282Y", zygosity: "hom" }],
    phenotypes: ["hp:0002829", "hp:0012378", "hp:0000953"],
  },
];

export function buildSeedGraph(): KnowledgeGraph {
  const g = new KnowledgeGraph();

  for (const o of ORGANS)
    g.addNode(
      makeNode("Organ", o[0], o[1], { uberon: o[2] }, { aliases: o[3] }),
    );
  for (const [id, label, syn] of PHENOTYPES) {
    g.addNode(
      makeNode(
        "Phenotype",
        id,
        label,
        { hpo: id.replace("hp:", "HP:") },
        { aliases: [id.replace("hp:", "HP:"), ...syn] },
      ),
    );
  }
  for (const gene of GENES) {
    const { aliases, ...rest } = gene;
    g.addNode(
      makeNode(
        "Gene",
        `gene:${gene.symbol}`,
        gene.symbol,
        { ...rest, assembly: "GRCh38" },
        { aliases: [gene.name, ...aliases] },
      ),
    );
  }
  for (const d of DISEASES) {
    g.addNode(
      makeNode(
        "Disease",
        d.id,
        d.label,
        { name: d.label, ...d.props },
        { aliases: d.aliases },
      ),
    );
    for (const o of d.organs)
      g.addEdge(makeEdge("AFFECTS", d.id, o.organ, { primary: o.primary }));
    for (const [hp, frequency] of d.phenotypes)
      g.addEdge(makeEdge("PRESENTS_WITH", d.id, hp, { frequency }));
  }
  for (const [gene, organ, level] of EXPRESSION)
    g.addEdge(makeEdge("EXPRESSED_IN", `gene:${gene}`, organ, { level }));
  for (const v of VARIANTS) {
    const label = `${v.gene} ${v.props.hgvsp}`;
    g.addNode(
      makeNode("Variant", v.id, label, v.props, { aliases: v.aliases }),
    );
    g.addEdge(makeEdge("IN_GENE", v.id, `gene:${v.gene}`, {}));
    for (const d of v.diseases) g.addEdge(makeEdge("CAUSES", v.id, d, {}));
  }

  for (const p of SEED_PATIENTS) ingestPatient(g, p, "illustrative-seed");
  return g;
}
