# Genome privacy notice

Last updated: October 18, 2026

Genome is an open-source research workspace for exploring genetic findings and
potential gene edits. This notice describes the current project-maintained
prototype and the data flows implemented in this repository. Independently hosted
copies may use different infrastructure and settings; contact their operator for
the notice that applies to that service.

## Before you upload

Genetic information can identify you and reveal information about relatives even
when names have been removed. Use demo or synthetic data when evaluating the
prototype. Only submit files you are authorized to use, and avoid adding names,
contact details, or identifying medical histories to filenames, chat, or reports.

Selecting a genome for analysis sends its contents to the configured backend.
Genome is not an entirely local analysis tool. Its findings and edit plans are
research outputs, not clinical diagnoses or treatment decisions.

## Information processed and why

| Information                          | Purpose and handling                                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uploaded VCF or compressed VCF files | Transferred to backend storage and scanned to identify variants in the supported disease panel. The standard web upload goes directly to the backend rather than through the Next.js web server.                                                              |
| Analysis results                     | Variant findings, inferred associations, edit plans, and reference context are used to display the workspace and generate reports. Results are saved by the backend and may also be cached in your browser.                                                   |
| File and upload metadata             | Local file metadata, upload IDs, format, size, progress, timestamps, checksums, and authorization information support resumable transfers, integrity checks, and job recovery. Original filenames remain part of the browser's local file metadata.           |
| Chat and optional symptom text       | Used to answer a question or run a feature that accepts symptoms. Chat sends conversation text to the web server; configured external models may receive it. The main genome upload flow currently performs genome-only analysis.                             |
| Network and diagnostic information   | IP addresses, request timing, status, errors, and session identifiers support delivery, rate limits, capacity management, and troubleshooting. The upload backend stores a hash of the source IP for resource accounting; hashing does not make it anonymous. |
| Contributions and correspondence     | Issues, pull requests, commits, privacy requests, and conduct reports are used to maintain the project and respond to requests. Public GitHub activity can include your account details and commit attribution.                                               |

The repository does not implement advertising, data-sale features, or a workflow
that trains models on uploaded genomes. This does not determine how a separately
configured provider handles requests under its own service terms.

## Services that may receive information

The documented deployment uses Cloudflare Workers for the web app and an
IBM LinuxONE-hosted Python service for genome uploads and analysis. Hosting and
network providers process connection information needed to deliver requests.
The configured services can also include:

- **Vercel AI Gateway and the selected model provider:** live chat sends text,
  conversation context, and retrieved facts through the gateway to the selected
  provider. The demo model avoids an external model call; it does not make all
  retrieval features offline.
- **Google Gemini:** when enabled, backend anatomy mapping sends eligible disease
  names, gene symbols, and identifiers to Google. That mapping request excludes
  raw VCF files, alleles, sample identifiers, and symptom text. Other backend
  features can send supplied symptom text to Gemini when configured to use it.
- **Research and reference services:** literature search can send terms derived
  from questions and selected entities to Europe PMC. Sequence retrieval can
  request genomic coordinates from Ensembl or the configured reference service.
- **GitHub:** hosts project collaboration and processes contributions under its
  own terms and settings.

Provider retention, processing locations, and any use of inputs for model
improvement depend on the service, account, and deployment configuration. This
repository does not establish a fixed processing country or a single retention
policy for those providers. Relevant provider notices include
[Cloudflare](https://www.cloudflare.com/privacypolicy/),
[IBM](https://www.ibm.com/privacy),
[Vercel](https://vercel.com/legal/privacy-notice), and
[Google's Gemini API terms](https://ai.google.dev/gemini-api/terms).

## Browser storage and downloads

The app can save a completed analysis snapshot in IndexedDB on your device. It
contains file metadata, the report, progress, and reference context; it does not
save raw uploaded genome bytes or upload bearer tokens. The current default
workspace clears the saved snapshot when it loads, while the reusable analysis
hook also supports restoring a saved snapshot.

The **Remove genome** action clears the workspace's saved snapshot. You can also
clear the site's browser storage to remove local copies and preferences such as
the selected theme. Local storage may be accessible to others using the same
browser profile. Downloaded reports remain wherever you save them until you
delete those files yourself.

The application currently has no advertising trackers configured. Hosting
providers and independently deployed copies may have additional logging or
storage behavior.

## Server retention and deletion

By default, an empty upload reservation expires after five minutes. Upload
progress, queueing, retries, and completion can extend the session expiry using a
configurable retention window, which defaults to 24 hours. Expiry is therefore
not a promise that every copy disappears 24 hours after the original upload.

Backend maintenance clears expired report payloads and attempts to remove stored
upload files after cancellation or expiry. Cleanup depends on a running worker
and successful storage operations. Upload accounting records, checksums, and
source-address hashes are not automatically deleted with the files. The source
code does not enforce a universal deletion schedule for those records, backups,
provider logs, or correspondence.

Canceling an unfinished upload requests backend cancellation. **Remove genome**,
closing the page, and clearing browser storage do not delete a completed server
analysis. A queued analysis may continue after the browser closes. For requests
about server-held data, contact the operator using the details below.

## Safeguards and limitations

Public uploads use HTTPS and a per-session bearer token; the backend stores the
token's hash. The browser keeps the capability in memory rather than including it
in its saved analysis. Anyone holding a valid capability may be able to access
that session, so do not share tokens or authorization headers.

Application telemetry is designed to record operational events without genome
contents, filenames, reports, chat text, or credentials. Hosting access logs and
unexpected errors may have different contents. Access controls and redaction
reduce risk but do not guarantee that storage or transmission is risk-free.

## Your choices and requests

You can use a demo genome instead of uploading your own, avoid sending identifying
details in chat, cancel an unfinished transfer, remove local results, and clear
browser storage. Self-hosting gives an operator control over backend destinations
and enabled providers; a local web server still uses the configured remote
backend unless that configuration is changed.

Depending on applicable law, you may have rights to access, correct, delete, or
receive a copy of personal information, restrict or object to processing, withdraw
consent where processing relies on it, or complain to a data-protection authority.
Contact the operator to discuss a request and its scope. This notice does not
create blanket consent to process genetic data or establish the legal basis for
every deployment.

## Contact

For privacy questions, deletion requests, or suspected exposure of private data,
email [privacy@genome.com](mailto:privacy@genome.com). Include the deployment URL,
approximate time, and upload ID if available. Do not email a genome, report, or
bearer token with the initial request. We may need further information to locate
the record and verify that you are entitled to make the request.

Privacy and conduct correspondence is used to investigate and respond. Access is
limited to people needed for that work, with disclosure where required to resolve
a safety concern or comply with law. Public contributions remain subject to
GitHub's publication and retention behavior.

Changes to this notice will be recorded in this file with an updated date.
Operators of other deployments should publish their identity, contact, actual
providers, legal bases, processing locations, and retention settings before
collecting personal genetic or health information.
