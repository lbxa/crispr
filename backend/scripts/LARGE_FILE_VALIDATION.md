# Large genome acceptance

Run the validator from `backend/` with the existing development virtualenv. It
uses a fresh Python process for each scan, measures process peak resident memory
with the operating system, and checks counters and retained-call fingerprints.
Metrics contain aggregate counts and hashes; genome records, sample names,
reports, and upload capabilities are never printed.

## The local HG001 acceptance case

The existing uncompressed file is 2,065,554,427 bytes (1.924 GiB); its compressed
copy is 125,932,193 bytes. These files stay local during this check:

```sh
.venv/bin/python -m scripts.validate_large_genome \
  --file data/test-genomes/GRCh38/HG001_GRCh38_1_22_v4.2.1_benchmark.vcf \
  --file data/test-genomes/GRCh38/HG001_GRCh38_1_22_v4.2.1_benchmark.vcf.gz \
  --output ../.harness/verification/large-genome-hg001-local.json
```

Each file must produce the same uncompressed byte count, record count,
alternate-allele count, retained calls, and retained-call fingerprint. Each scan
must stay under 512 MiB RSS and within 128 MiB of a separate 32 MiB synthetic
baseline. These thresholds are configurable CLI options.

To exercise the real reference lookup, add `--reference-db data/crispr.sqlite`
when that database is available. The connection is read only. Without a
reference database, this check uses one synthetic sentinel locus and proves
streaming, memory bounds, and encoding parity; it does not validate clinical
findings or count ClinVar matches.

On the development machine on 2026-10-17, both existing HG001 encodings produced
3,893,341 records and 3,935,732 alternate alleles. The raw scan took 13.99 seconds
at 23.49 MiB peak RSS; the compressed scan took 15.30 seconds at 24.94 MiB. These
are local parser measurements, not IBM throughput measurements. Runtime results
are saved under `.harness/verification/` rather than committed as fixtures.

The complete local worker, including loaded HPO and reference data, reported
382.75 MiB peak RSS while processing a 128 MiB expanded gzip fixture. That is a
different measurement from the scanner subprocess's roughly 25 MiB: deployment
memory budgets must include the complete worker.

## Synthetic encoding and memory checks

This quick command checks plain VCF, gzip, and genuine BGZF. BGZF fixture creation
uses `pysam`, already present in the backend development requirements; production
streaming does not require htslib.

```sh
.venv/bin/python -m scripts.validate_large_genome \
  --size-bytes 8388608 --baseline-bytes 1048576 \
  --encoding plain --encoding gzip --encoding bgzf
```

Omit `--size-bytes` for a generated file with the same byte length as the local
HG001 VCF. Generation and compression write bounded blocks to temporary files;
the source is never assembled into one in-memory string. The synthetic VCF
contains one retained sentinel and many unrelated alternate alleles, so
retention must stay at one while total variant counts grow. Temporary artifacts
are removed on exit.

## Resumable upload and background analysis

With the full API, TUS server, reverse proxy, and analysis worker running locally:

```sh
.venv/bin/python -m scripts.validate_large_genome \
  --size-bytes 33554432 --encoding plain \
  --url http://127.0.0.1:9080 \
  --output ../.harness/verification/large-genome-upload.json
```

The validator creates an upload session, sends a first chunk, closes the
connection, resumes from the server's offset, rejects a stale offset without
changing stored bytes, rejects premature completion, replays completion, and
polls the background job. The server's final SHA-256 must match the bytes sent;
the job and report must account for every observed variant. Upload status must
reject unauthenticated access. Add `--upload-encoding gzip` or
`--upload-encoding bgzf` to send compressed bytes without decompressing them in
the client.

While jobs are queued or processing, `/health` must answer within two seconds.
Metrics distinguish checks made during processing from checks made only while
queued; a small job that finishes before the first poll supplies no processing
responsiveness evidence. This checks API responsiveness alongside the actual
transfer and completed-report checks; health alone does not prove TUS or worker
availability.

To coordinate a real restart of the owned local TUS process after its first
acknowledged chunk:

```sh
.venv/bin/python -m scripts.validate_large_genome \
  --size-bytes 33554432 --encoding plain --url http://127.0.0.1:9080 \
  --pause-after-first-chunk 15 \
  --checkpoint-path ../.harness/verification/large-upload-checkpoint.json
```

The checkpoint contains only a phase and accepted byte count. The test driver
waits for that checkpoint, restarts its TUS process with the same storage, and
checks that the validator resumes successfully. The pause is capped at 30
seconds; the validator runs no service-management commands. Keep separate
process restart evidence alongside the final metrics: an intentional pause by
itself does not prove a service was restarted.

Use the default synthetic size to measure the complete 1.9 GiB transfer. Upload
progress and processing progress are distinct: accepting bytes does not mean
analysis has completed. Worker restart recovery, cancellation, quotas, malformed
input, and capability scope are also covered by the owning backend tests; this
script supplies independent transfer and memory evidence.

## Genomes already stored on IBM

IBM's existing genomes are compressed BLOBs in `genomes.vcf_gz` inside
`/data/crispr.sqlite`, rather than standalone VCF files. Keep the existing single
database as the deployment and backup unit. Validate those genomes directly:

```sh
sudo docker exec crispr-upload-worker python -m scripts.validate_database_genomes \
  --database /data/crispr.sqlite --require-parity
```

The database validator opens a read-only SQLite snapshot, loads one Analyzer
from the same reference data, then streams each BLOB with `blobopen(...,
readonly=True)` through bounded IO. It reads row identifiers, sex, and compressed
lengths; sample names, simulation truth, orders, and symptom records are not
queried. No VCFs are exported and nothing is uploaded. JSON output contains
aggregate genome, byte, record, variant, retention, memory, timing, and parity
counts; it contains no genome records or reports.

For BLOBs whose compressed and expanded sizes are both at most 20 MiB, the
validator compares the entire streaming report against the legacy analysis
internally. Larger BLOBs remain streamed and increment `parity_skipped`;
`--require-parity` fails if any genome would skip that comparison. The optional
`--parity-limit-bytes` can lower this ceiling but cannot raise it.

On IBM on 2026-10-17, all 100 stored genomes passed exact full-report parity,
with no skipped rows: 1,238,702 compressed bytes, 8,165,263 expanded bytes,
217,183 variants scanned and 82 retained reference matches. The complete check
took 14.1696 seconds at 418,603,008 bytes (399.2 MiB) peak RSS. Aggregate evidence
is in `.harness/verification/ibm-database-genomes.json`. These panel genomes prove
compatibility; the separate capacity run below exercises whole-genome scale.

## IBM capacity evidence

The deployed IBM stack independently completed a generated compressed whole
genome through the public TUS and background analysis flow on 2026-10-17:

- 2,065,554,427 expanded bytes; 32,648,689 bytes transferred.
- 4,715,878 alternate alleles processed in 32.8588 seconds end to end.
- 417,837,056 bytes (398.5 MiB) peak worker RSS, including HPO and reference data.
- Health requests answered in at most 18.6 milliseconds during processing.

This supplies IBM capacity evidence alongside the existing-genome parity check;
the generated whole genome does not replace the database's stored panel genomes.
Local HG001 scanner measurements remain development-machine evidence. Existing
`--file` inputs in the general validator are scanned in place and cannot be
combined with `--url`; protocol tests generate their own data.

## Changelog

### 2026-10-17

- Large genome acceptance separates local parser evidence from HTTP upload and
  IBM deployment evidence, so a fast small-file demo cannot stand in for the
  whole-genome requirement. IBM processing acceptance reuses files already on
  that server; routine protocol checks use synthetic data and never transmit
  existing genome files.
- HTTP acceptance reuses the backend's runtime `requests` dependency so deployment
  smoke tests can run in the shipped container. In-place scan and memory checks
  need only the standard library and production parser.
- Existing IBM genomes stay inside `crispr.sqlite`: read-only BLOB validation
  preserves the single-file deployment and backup contract while proving full
  report compatibility against the legacy path for bounded panel genomes.
