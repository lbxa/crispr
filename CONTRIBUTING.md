# Contributing to Genome

Contributions to the app, analysis, documentation, accessibility, and developer
tools are welcome. Read the [Code of Conduct](CODE_OF_CONDUCT.md) before taking
part in project discussions.

## Getting started

Follow the [README](README.md#installation-and-development) to install dependencies
and run the app. The repository uses Bun, a single root lockfile, and Turborepo;
Python development has its own [backend setup](backend/README.md#developing-backend-code).

Read the nearest package README and any applicable `AGENTS.md` before changing
code. These describe package ownership, commands, and constraints. The product is
called Genome; existing repository URLs, `@crispr/*` imports, and `CRISPR_*`
configuration keys remain valid.

## Reporting bugs and proposing changes

Use [GitHub issues](https://github.com/lbxa/crispr/issues) for reproducible bugs,
feature proposals, and documentation problems. Include:

- What you expected and what happened.
- Steps to reproduce, your operating system, and relevant runtime versions.
- Sanitized errors or screenshots, when they help explain the problem.

For substantial changes, describe the intended behavior and tradeoffs in an issue
before investing in an implementation. Small fixes can go directly to a pull request.

Issues, pull requests, and attachments may be public. Never include personal genome
files, patient reports, identifying symptom histories, upload tokens, credentials,
or private logs. Reproduce sensitive failures with synthetic data. For a privacy
incident or a report containing private information, use the private contact in
[PRIVACY.md](PRIVACY.md#contact) instead of opening an issue.

## Making a change

1. Fork the repository and create a branch for one focused change.
2. Follow the existing ownership boundaries: product flows belong in `apps/web`,
   reusable scenes in `libs/human-model`, and genome interpretation and edit
   planning in `backend`.
3. Import shared code through declared workspace packages. Prefer existing tools
   and small, direct implementations over new infrastructure or wrappers.
4. Add meaningful regression tests for behavior changes. Keep fixtures synthetic
   or use public data with documented provenance and compatible terms.
5. Update documentation when commands, configuration, behavior, or ownership change.
   Keep canonical Blender assets separate from generated browser models.

Preserve accessible keyboard interactions, reduced-motion support, and clear
loading and failure states. Keep demonstration data and unavailable scientific
results distinguishable from real analysis. New telemetry must exclude genome
contents, filenames, reports, credentials, and chat or symptom text.

## Checking your work

Run the owning package's checks while iterating, then run this from the root:

```sh
bun run verify
```

For app or browser runtime changes, also exercise the changed flow and run:

```sh
bun run --cwd libs/browser-harness install:browsers
bun run verify:browser
```

The browser installation is needed only when Chromium is not already available.
Use the repository's [browser harness](libs/browser-harness/README.md) so diagnostics
and cleanup follow the same lifecycle. See the [agent feedback loop](docs/agent-harness.md)
for evidence and verification conventions.

For backend changes, set up `backend/.venv` and run:

```sh
bun run verify:backend
```

Format the files you change with the configured formatter. Report environmental
blockers and checks you could not run; a skipped check is not a passing check.

## Opening a pull request

Explain the problem, the resulting behavior, and how you verified it. Include
sanitized before-and-after screenshots for visual changes and call out material
limitations. Keep generated files, local data, and unrelated edits out of the diff.

Contributions of original project code and documentation are made under the
[MIT license](LICENSE). Preserve third-party notices and identify any separately
licensed dependencies, datasets, fonts, artwork, or models you introduce.
