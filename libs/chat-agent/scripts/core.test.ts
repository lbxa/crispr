import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeedGraph } from "../lib/graph/seed";
import { linkEntities } from "../lib/graph/linker";
import { rankDiagnoses } from "../lib/graph/scoring";
import { designGuides, revcomp } from "../lib/metrics/guides";
import {
  sanitizeText,
  buildQuery,
  searchEuropePmc,
} from "../lib/papers/europepmc";
import { checkGrounding } from "../agent/grounding";
import { TurnRegistry } from "../lib/retrieval/registry";
import { routeIntent } from "../lib/retrieval/router";

const g = buildSeedGraph();
const labels = (t: string) => linkEntities(g, t).map((e) => e.label);

test("graph integrity", () => {
  assert.doesNotThrow(() => g.validate());
});

test("linker", () => {
  assert.ok(labels("tell me about CFTR").some((l) => /CFTR/.test(l)));
  assert.ok(labels("what does F508del do").length > 0);
  assert.ok(labels("p.Phe508del").length > 0);
  assert.ok(labels("cystic fibrosus").length > 0, "fuzzy typo");
  assert.ok(labels("I have yellow eyes").length > 0);
  assert.ok(labels("liver").length > 0);
});

test("ranking: sim-001 affected+likely, sim-002 carrier no tier", () => {
  const f1 = rankDiagnoses(g, "pt:sim-001")[0]!;
  assert.equal(f1.status, "affected");
  assert.equal(f1.tier, "likely");
  const f2 = rankDiagnoses(g, "pt:sim-002").find((f) => f.status === "carrier");
  assert.ok(f2);
  assert.equal(f2!.tier, null);
});

test("guide geometry: forward and reverse cut positions", () => {
  const pre = "ACGTACGTACGTACGTACGTACGTACGTAC"; // 30
  const proto = "GACTGCATGCATGCAGTCAG";
  const seq = pre + proto + "TGG" + "ACGTACGTACGTACGTACGT";
  const fwd = designGuides(seq, {
    start: 45,
    end: 46,
    ref: seq[45]!,
    alt: "A",
  }).find((x) => x.strand === "+" && x.start === 30);
  assert.ok(fwd);
  assert.equal(fwd!.pamStart, 50);
  assert.equal(fwd!.cut, 47);
  const rseq = pre + "CCA" + revcomp(proto) + "ACGTACGTACGTACGTACGT";
  const rev = designGuides(rseq, {
    start: 36,
    end: 37,
    ref: rseq[36]!,
    alt: "A",
  }).find((x) => x.strand === "-" && x.protospacer === proto);
  assert.ok(rev, "reverse-strand guide found");
  assert.equal(rev!.cut, 36);
  assert.equal(rev!.start, 33);
  for (const gd of [fwd!, rev!]) {
    assert.equal(gd.onTarget.score, null);
    assert.equal(gd.offTarget.status, "not_assessed");
  }
});

test("router", () => {
  assert.equal(routeIntent("latest papers on CFTR", []).needsPapers, true);
  assert.equal(
    routeIntent("design a guide for F508del", []).intent,
    "edit_design",
  );
});

test("europepmc: sanitize, query quoting, failure and parsing", async () => {
  assert.equal(
    sanitizeText("<b>Hi</b> &amp; <script>x</script>\u0000there"),
    "Hi & x there",
  );
  assert.ok(sanitizeText("a".repeat(2000)).length <= 705);
  const q = buildQuery({ entities: ['CFTR" OR (x'], topics: [] });
  assert.ok(!q.includes('" OR ('), q);
  const fetchOk = (async () =>
    new Response(
      JSON.stringify({
        resultList: {
          result: [
            {
              id: "1",
              source: "PPR",
              title: "A <i>preprint</i>",
              abstractText: "x",
              pubYear: "2024",
            },
            { source: "MED" },
          ],
        },
      }),
    )) as typeof fetch;
  const recs = await searchEuropePmc("CFTR", { fetch: fetchOk });
  assert.equal(recs.length, 1);
  assert.equal(recs[0]!.title, "A preprint");
  const fetchBad = (async () =>
    new Response("no", { status: 500 })) as typeof fetch;
  await assert.rejects(searchEuropePmc("CFTR", { fetch: fetchBad }));
});

test("grounding flags handles never issued", () => {
  const reg = new TurnRegistry();
  reg.addFact("a", [], "derived");
  const r = checkGrounding(
    "Yes [F1] and [F99], also the F1 score and [P1, F1].",
    reg,
  );
  assert.deepEqual(r.citedFacts, ["F1"]);
  assert.ok(r.unknown.includes("F99"));
  assert.ok(r.unknown.includes("P1"));
  assert.equal(r.offTarget, "not_assessed");
});
