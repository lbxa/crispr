# Genome findings and DNA navigation

## Architecture contract

The backend analysis owns finding selection and the GRCh38 reference context.
`analysis/genome_view.py` projects findings into a versioned, BED-compatible JSON
map. Upload status and the compatibility analysis response carry that map.
`apps/web/app/genome-analysis/genome-view.ts` validates the external boundary and
adapts reference windows to the existing bounded sequence-source interface.
The app owns minimap navigation; `@crispr/human-model` owns highlighted 3D bases.

The capability is locating an analyzed variant and inspecting its reference
context. Likely changes are additional assemblies, full reference coverage and
annotation types. The current contract pins assembly `GRCh38`, version `1`, and
`zero-based-half-open` intervals; displayed coordinates remain one-based. VCF POS
becomes `start = POS - 1`, `end = start + length(REF)`, including the VCF anchor
for indels. Alternate alleles are reported separately and never shift the
reference coordinate system. This follows [UCSC BED conventions](https://genome.ucsc.edu/FAQ/FAQformat.html#format1);
primary chromosome lengths come from [UCSC hg38](https://hgdownload.soe.ucsc.edu/goldenPath/hg38/bigZips/hg38.chrom.sizes).

Domain concepts are a chromosome, a reference interval, a variant allele,
finding annotations and a bounded reference context. One locus/allele region
can have several disease annotations; deterministic IDs deduplicate those
annotations without hiding distinct alternate alleles. Carrier annotations
retain their tier and are not presented as affected diagnoses.

Invariants: intervals lie inside their chromosome; context length matches its
coordinates and REF; context is forward-strand GRCh38, not reconstructed patient
DNA; uncovered bases are `N`; selections clamp to chromosome boundaries. The
backend enforces coordinate/context integrity and the frontend validates the
wire contract before rendering. No simulation truth is read. No genome or
report contents enter telemetry or persistent browser storage.

The use cases are analyze → display map, scrub → update viewer, select finding
→ switch chromosome and jump, and scroll viewer → update minimap. React event
handlers own navigation; existing scene effects synchronize only the external
scroll/GPU systems. The existing upload state machine and lease publication
remain the owners of processing/retry/cancellation. This projection adds no
new jobs, transactions, repositories, side effects or retry mechanism. It is
published atomically as part of the existing completed report.

Missing reference context produces unknown bases, never synthetic replacements.
An older persisted report without a map requests reanalysis. Malformed maps
fail response validation; an analysis with no findings has an empty map rather
than demo hotspots. Replacing a file resets the explorer; pane switches retain
navigation. Tests cover SNVs/indels, coordinate endpoints, context provenance,
deduplication, invalid contracts, no-findings, chromosome changes, keyboard and
pointer scrubbing, bidirectional synchronization, and the real browser journey.

## Interface

`report.genome_view` contains `version`, `assembly`, `coordinate_system`,
`chromosomes: [{id, length}]` and `regions`. Each region contains `id`,
`chromosome`, `start`, `end`, `reference`, `alternate`, `clinical_significance`,
`zygosity`, `annotations: [{gene, disease, tier}]` and nullable
`reference_context: {start, end, bases}`. Contexts are bounded to the available
panel reference around the locus. They are intentionally separate from the
exact red interval and from the alternate allele.

## Visual direction

Keep the existing charcoal/mint workspace, Geist interface and mono coordinates.
Replace the native slider's appearance with a quiet chromosome rail, red finding
ticks and a bright position cursor. Tiny loci receive larger invisible
hit areas; a compact finding list keeps coincident markers individually reachable.
Markers have a minimum visible width; their labels and navigation retain the
exact biological coordinates, including when several loci share a screen pixel.
Red appears only where it conveys findings. Exact coordinates and reference/alternate
alleles explain the selected site; the remaining controls stay visually restrained.
