# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Consumers who ordered a genome kit and are reading their own results, in the
way a Superpower member reads their blood-test dashboard. They are not
clinicians; they need plain-language findings and a clear sense of what is
fine, what to watch, and what could be acted on.

## Product Purpose

Crispr takes a genome (single-sample VCF, GRCh38) and a symptom description,
finds disease-causing variants that fit both, and proposes a CRISPR-Cas9 edit.
Success: a member opens their results, understands which findings matter and
where in the body they relate to, and sees what an edit plan would involve.

## Positioning

Combines the genotype (ClinVar pathogenic variants with inheritance logic)
with the member's own symptoms (HPO phenotype similarity, read by IBM Granite)
and goes one step further than reporting: it designs a candidate gene edit.

## Operating Context

- Results dashboard modelled on Superpower's "Data" view: body twin on the
  left, summary and results table on the right, an always-available AI chat.
- Right panel leads with findings (likely / possible / carrier / clear across
  the 24-disease panel), then the CRISPR edit plan for the likely finding.
- Backend runs on IBM LinuxONE; Granite answers symptom and chat questions.

## Capabilities and Constraints

- Disease panel: 24 single-gene diseases (`backend/crispr_backend/panel.py`).
- Tiers: likely, possible, carrier. Edit plans: SpCas9 NGG guides ranked by
  cut distance, GC, poly-T and allele specificity; repair template or
  allele-specific knockout; base/prime editing alternative.
- Off-target activity is NOT assessed. Demo genomes are simulated.
- The real app uses `libs/human-model` (Three.js) for the body; static
  mockups may use an SVG body.

## Evidence on Hand

- Disease panel and pipeline in `backend/`. No real customers, testimonials
  or clinical validation exist; never fabricate them.

## Product Principles

1. Plain language first; gene names and coordinates are secondary detail.
2. Every finding links to a place on the body and an action.
3. Honest about limits: research prototype, simulated genomes, not medical
   advice, off-target not assessed.
4. Calm by default: most results are clear, and the design should say so.
