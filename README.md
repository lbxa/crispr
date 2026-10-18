<img src="https://lbxa.net/_astro/coastal-banner.BQ1K1fNE_2uQ3Uu.webp" alt=""/>

# Genome

Genome is an interactive research workspace for exploring genomes and potential
CRISPR edits. It brings genetic findings into view through an anatomical model,
chromosome navigation, and a 3D DNA viewer, with reports that connect variants to
their evidence and proposed editing strategies.

Upload a VCF or choose a demo genome to explore the analysis, inspect gene-specific
edit plans, and download a laboratory report. A separate chat workbench supports
questions about variants, research, and editing options.

The current analysis covers a panel of 24 single-gene diseases using GRCh38 data.
This is a research prototype, not a clinical diagnosis or treatment tool.

## Development philosophy

- **Make the science understandable.** Start with a clear visual overview and
  let people open the supporting evidence when they need more detail. Keep
  simulated data, missing results, and research limitations visible.
- **Give each part a clear owner.** The web app owns product flows, Python owns
  genome analysis and edit planning, and shared libraries own reusable UI,
  rendering, and infrastructure.
- **Keep the solution simple.** Prefer established tools and declared workspace
  dependencies. Add abstractions when they clarify a responsibility or enforce a
  useful invariant.
- **Verify what people experience.** Use linting, types, tests, and production
  builds for every handoff. Exercise app changes in a real browser, including
  keyboard interactions and failure states.
- **Make behavior inspectable.** Keep structured logs and browser evidence tied
  to the same run. Keep credentials, genome contents, and private reports out of
  logs and version control.

## Installation and development

### Prerequisites

Install [Bun](https://bun.sh) 1.3.14 or newer, [Node.js](https://nodejs.org) 24 or
newer, and Git. Python 3.12 or newer is needed only for backend development;
`jq` is needed for the Claude worktree hook.

### Run locally

```sh
git clone https://github.com/lbxa/crispr.git
cd crispr
bun run setup
bun run dev
```

Open [localhost:3000](http://localhost:3000). Run commands from the repository root
unless a guide says otherwise.

`setup` installs dependencies from the committed `bun.lock` and builds the shared
runtime libraries. `dev` runs the Next.js app and builds its workspace dependencies
first. Setup does not provision external services or create environment files.

### Environment and services

The web app uses the configured remote Python API for genome analysis by default,
so you do not need a local database or Python environment to work on the frontend.
Analysis, demo-genome downloads, and edit-plan requests need access to that service.

For overrides, create `apps/web/.env.local` using
[`.env.example`](apps/web/.env.example) as a reference. Include only the variables
you want to set, and restart the dev server after changing them:

- `CRISPR_API_URL` selects the genome backend. Leave it unset to use the default
  remote service. Local resumable uploads also need the proxy, upload server, and
  worker described in the [backend guide](backend/README.md#large-genome-workflow).
- `AI_GATEWAY_API_KEY` enables a live model in `/chat`. Without it, chat uses a
  labeled demo model. `CRISPR_MODEL` optionally selects the model.
- Chat datasets are imported separately. Without a ClinVar import, the workbench
  uses a labeled seed graph; see the [chat data guide](libs/chat-agent/README.md#data).

For Python work, follow the [backend setup guide](backend/README.md#developing-backend-code).
Its tests use a small built-in database and do not require downloading reference data.

### Everyday commands

| Command                  | Purpose                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `bun run dev`            | Start the web app on port 3000 by default.                                     |
| `bun run build`          | Build the app and shared libraries for production.                             |
| `bun run lint`           | Lint the Bun workspaces.                                                       |
| `bun run check-types`    | Check workspace types.                                                         |
| `bun run test`           | Run workspace tests.                                                           |
| `bun run verify`         | Run hook regression tests, linting, type checks, tests, and production builds. |
| `bun run verify:browser` | Launch the app and verify it with Chromium and Next.js diagnostics.            |
| `bun run verify:backend` | Run Python linting, formatting checks, types, and tests after backend setup.   |

Before your first browser check, install Chromium:

```sh
bun run --cwd libs/browser-harness install:browsers
bun run verify:browser
```

Run `bun run verify` before handing off a change; also run `bun run verify:browser`
for app or browser runtime changes. Browser verification uses port 3101 by default
(`HARNESS_PORT` overrides it). The [agent feedback loop](docs/agent-harness.md)
explains verification hooks, interactive sessions, and diagnostics.

For Cloudflare Workers, `bun run preview:worker` builds and previews the deployment
locally. `bun run deploy` builds and publishes using your Wrangler authentication.
See the [deployment guide](docs/deployment.md) for release configuration and recovery.

## Workspace

This is a Bun monorepo with Turborepo coordinating builds and checks. The Bun
workspaces are `apps/*` and `libs/*`, with one root lockfile. The Python backend is
managed separately. The repository URL, `@crispr/*` package namespace, and
`CRISPR_*` configuration keys retain their existing identifiers.

| Location                                                 | What lives here                                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`apps/web`](apps/web/README.md)                         | Next.js routes, product UI, API adapters, styles, and Cloudflare deployment configuration.                       |
| [`libs/human-model`](libs/human-model/README.md)         | Reusable anatomy and DNA viewers, Three.js scenes, model assets, and Blender authoring.                          |
| [`libs/ui`](libs/ui/README.md)                           | Shared React components and report presentation.                                                                 |
| [`libs/widget-grid`](libs/widget-grid/README.md)         | Responsive widget layout and accessible reordering.                                                              |
| [`libs/chat-agent`](libs/chat-agent/README.md)           | Chat workbench, knowledge graph, retrieval, ClinVar imports, and model integration.                              |
| [`libs/browser-harness`](libs/browser-harness/README.md) | Isolated Playwright/CDP sessions, browser verification, process cleanup, and evidence.                           |
| [`libs/observability`](libs/observability/README.md)     | Structured server logs, telemetry, and log queries.                                                              |
| [`libs/exhaustiveness`](libs/exhaustiveness/README.md)   | Exhaustive state checks.                                                                                         |
| `libs/eslint-config`, `libs/typescript-config`           | Shared lint and TypeScript configuration.                                                                        |
| [`backend`](backend/README.md)                           | Python API, genome analysis, CRISPR planning, upload workers, reference-data pipelines, and LinuxONE deployment. |
| `notebooks`                                              | Experiments with IBM services, including Granite and watsonx.ai.                                                 |
| `scripts`                                                | Repository setup, cleanup, and agent verification hooks.                                                         |
| [`docs`](docs)                                           | Architecture, genome coordinates, large uploads, deployment, and agent workflows.                                |
| `.agents/skills`                                         | Canonical development skills shared by agent clients.                                                            |
| `.codex`, `.claude`                                      | Client-specific agent settings, profiles, and hooks.                                                             |

Import shared code through declared `@crispr/*` package entrypoints, such as
`@crispr/ui/button`. Each package README maps its implementation and ownership.

### Assets and local data

- **Static web assets** live in `apps/web/public`. Canonical anatomy assets and
  Blender sources belong to `libs/human-model`; builds produce optimized runtime
  models and copy them into the app's generated `public/models/human` directory.
- **Reference data and chat imports** live in the ignored `backend/data` and
  `libs/chat-agent/data` directories. Code outside the backend accesses genome
  data through the API.
- **Browser evidence** lives in `.harness/evidence/<run-id>/`; verification-hook
  logs live in `.harness/verification`. Both are local, ignored output.
- **Generated files** such as `dist`, `.next`, `.open-next`, and `.turbo` are build
  output or caches. Environment files and credentials stay local.

## Community and policies

See the [contributing guide](CONTRIBUTING.md) to get involved and the
[Code of Conduct](CODE_OF_CONDUCT.md) for community expectations and private reporting.
The [privacy notice](PRIVACY.md) explains uploads, browser storage, external services,
retention, and deletion requests.

Genome's original code and documentation are available under the [MIT license](LICENSE).
Third-party dependencies, datasets, fonts, artwork, and model assets retain their
own licenses and attribution requirements.
