# Large genomes on IBM LinuxONE

The browser uploads `.vcf` or `.vcf.gz` directly to durable storage on LinuxONE.
Next.js supplies public connection configuration; genome bytes never pass through
a Next.js route, Worker, multipart parser, or JSON string. Compression is preserved
in transit and storage. The existing 24-gene ClinVar analysis remains the scientific
scope: scanning a whole genome does not expand the disease panel.

## Architecture contract

| Boundary                                                             | Owner                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Selection, transfer controls, progress and current-file state        | `apps/web/app/genome-analysis`                              |
| Resumable protocol, offset reconciliation, upload file locking       | Pinned upstream tusd + tus-js-client                        |
| Admission, bearer capabilities, completion, retry and cancellation   | `backend/crispr_backend/uploads/service.py` and HTTP routes |
| Atomic reservations, durable job state, claims and lease publication | `uploads/store.py`, a dedicated SQLite database             |
| Trusted tus file receipts and lock-aware deletion                    | `uploads/tus.py`                                            |
| Streaming validation, bounded decompression and candidate retention  | `crispr_backend/vcf.py`                                     |
| Panel matching, inheritance, symptoms and report                     | Existing `analysis/` modules                                |
| Worker lifecycle and recovery                                        | `uploads/worker.py`, a separate container/process           |
| HTTPS, capability checks before file requests, streaming proxy       | `backend/Caddyfile`                                         |

The core capability is reliable transfer followed by bounded-memory panel analysis.
Likely changes are limits, storage backends and progress presentation. Protocol
implementation stays upstream; scientific rules stay in `Analyzer`; storage/job
orchestration stays in the upload slice. IBM Cloud Object Storage can become a
future storage adapter when a bucket and credentials are provisioned. The current
deployment uses the persistent disk already available on the IBM VM.

The domain concepts are an upload reservation, capability, verified receipt,
analysis claim, progress snapshot and terminal report. Legal public states are
`uploading → queued → processing → complete | failed`; cancellation and expiry
stop unfinished work. An explicitly retryable failure can re-enter the queue up to
the attempt limit. A completed report is terminal. Browser pause pauses transfer;
it does not discard the server's acknowledged offset or start another analysis.

Invariants are enforced at their owning boundaries:

- Admission reserves declared bytes atomically before tus accepts a resource.
  Per-file, total storage, active-session and free-disk limits bound resource use.
- A random bearer capability is bound to one random upload ID. Only its hash is
  persisted. Caddy validates every public tus POST/HEAD/PATCH through FastAPI;
  URLs alone never authorize file access. File downloads and public termination
  are disabled. Internal hooks and authorization routes are not public.
- No filename, genome content, bearer token or report enters telemetry. Metadata
  contains only session ID and format. Browser capabilities remain in memory.
- Completion trusts the tus receipt, declared size and actual regular-file size,
  not the browser's progress counter. The filestore's `.info` offset can remain
  zero: tusd obtains its actual offset from the data file's stat.
- Queueing is idempotent per upload. SQLite transactions reserve, enqueue and
  claim; scanning runs outside transactions. A lease token guards heartbeat and
  final publication, so a stale worker cannot overwrite another claim or a cancel.
- The source remains immutable while queued/processing. Cleanup goes through
  tusd's lock-aware internal termination endpoint and releases storage accounting
  only after successful deletion. Unfinished cleanup remains retryable.
- Streaming memory scales with the panel reference and retained matches. Input
  size does not become a list of all genome calls or a decompressed string.

SQLite lives at `CRISPR_UPLOAD_DIR/jobs.sqlite3`, separate from the replaceable
reference `crispr.sqlite`. WAL and bounded lock waits support API/worker access.
Each worker processes one job at a time. Expired claims are recovered, with bounded
attempts. Browser completion and worker reconciliation recover a missing completion
notification; nonblocking tus hooks are not treated as durable queue delivery.

This is a persist-intent-then-execute workflow. Tus offsets make transfer retries
idempotent; upload ID makes completion/retry idempotent; lease compare-and-set makes
publication consistent. Filesystem writes happen outside SQLite transactions and
are reconciled against persisted intent. No external call runs inside a database
transaction. There is no generic repository layer or separate queue service.

## HTTP and progress

`GET /api/genome-uploads/config` returns the public API origin and client limits.
Then the browser calls IBM directly:

| Request                                                          | Purpose                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------- |
| `POST /uploads` with `{size_bytes, format: "vcf" \| "vcf_gzip"}` | Reserve storage; return ID, bearer token and tus endpoint   |
| Tus `POST /files/`, then `HEAD/PATCH /files/{id}`                | Transfer with 8 MiB chunks and authoritative offsets        |
| `POST /uploads/{id}/complete`                                    | Verify the receipt and queue exactly one job                |
| `GET /uploads/{id}`                                              | Upload bytes, stage, scan counters, safe error or report    |
| `POST /uploads/{id}/retry`                                       | Requeue a retryable failed analysis without uploading again |
| `DELETE /uploads/{id}`                                           | Cooperatively cancel unfinished work                        |

All session operations require `Authorization: Bearer <capability>` and return
private, uncached responses. CORS allows local development and the configured Crispr
domains; preflight has no bearer and is handled before file authorization. The
compatibility JSON `POST /analyze` remains limited to 20 MiB.

The default upload ceiling is 10 GiB, total reservation ceiling 40 GiB, free-disk
reserve 2 GiB and retention 24 hours. These limits are configurable on IBM. The
default source allowance is two active uploads, six creations per minute and
10 GiB of retained reservations; clients behind one NAT share it. An address
fingerprint is a resource key, not authenticated identity. Empty reservations
have a separate five-minute expiry; stored bytes extend transfer retention.
Only the loopback reverse proxy may supply a trusted client address. The
browser stays bounded to 8 MiB chunks and a 10 GiB selection ceiling. A paused or
interrupted upload resumes within the mounted page; refreshing requires selecting
the file again because capabilities are deliberately not stored in browser storage.

## Streaming and failure policy

The upload scanner accepts one UTF-8 sample, haploid/diploid GT calls, plain VCF,
gzip and concatenated gzip/BGZF members. Explicit GRCh37/hg19 declarations fail;
absent assembly metadata retains the existing GRCh38 assumption. Unsorted records
are accepted. Matching is exact after chromosome-prefix and allele-case handling;
there is no new allele normalization or broader diagnostic interpretation.

Only exact loci in the existing ClinVar index are retained. Identical relevant
duplicates collapse; conflicting calls at the same locus fail rather than creating
a false compound-heterozygous finding. `records_scanned` counts data records;
`variants_checked` counts all passing non-reference alternate-allele calls, even
when they are not retained. The report receives that full count explicitly.

Defaults cap expanded data at 40 GiB, one line at 4 MiB, records at 200 million and
retained candidates at 100,000. Corrupt/truncated compression, invalid sample/header,
wrong assembly and limit violations fail without a partial clinical report. Storage
and interrupted-worker failures are distinguishable from terminal input failures.
Cancellation is checked during scanning; progress is persisted at a bounded cadence.

## Validation and operational evidence

Run `bun run verify`, `bun run verify:backend`, and the browser harness against
the local app. Upload tests cover capability isolation, reservations and quota,
receipt validation, idempotent completion, lease recovery, cancellation, bounded
retry, expiry and cleanup. Parser tests cover raw/gzip/BGZF parity, malformed input,
limits, duplicate policy, cancellation and safe errors. Browser tests cover direct
transfer, controls, late callbacks, status/report validation and selected-file state.

See `backend/scripts/LARGE_FILE_VALIDATION.md` for isolated-process RSS measurement,
the real local HG001 acceptance case and synthetic interrupted-transfer checks.
Keep measured JSON results in `.harness/verification`; do not commit genomes or
log private variants. Report parser performance separately from full worker RSS,
which also includes the reference index/HPO data, and from live IBM throughput.

## LinuxONE deployment

`backend/scripts/deploy.sh` builds the backend plus native tusd v2.10.1, starts a
separate durable worker, and installs the streaming/authenticated Caddy routes.
Upstream tusd release images/binaries do not include s390x, so the pinned Go source
is compiled natively on LinuxONE. API, worker and tusd share private upload storage
under the persistent data volume. Only Caddy exposes file transfer publicly.

Deploy requires the IBM SSH key, as described in `backend/README.md`. A successful
local parser or transfer test does not prove a remote deployment. Check all four
services after deployment and perform the resumability/integrity acceptance run
through the public HTTPS proxy before claiming IBM end-to-end support.
