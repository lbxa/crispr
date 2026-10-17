# Cloudflare deployment

## Architecture contract

`apps/web` owns the deployable Next.js application and its Wrangler/OpenNext
configuration. OpenNext adapts the existing Next.js build; Wrangler owns local
Workers preview, version upload, and deployment. Cloudflare Workers Builds owns
the GitHub connection and production releases from `lbxa/crispr` on `main`.
Shared scene and telemetry behavior remain in their existing libraries.

The release invariant is a passing repository verification followed by a
successful Worker build. Credentials remain in Wrangler's local authentication
or Cloudflare's build integration and never enter Git. Hashed model assets and
Next.js assets ship with the same Worker version. No database, transaction,
custom deployment gateway, or application retry policy is introduced.

Likely changes are framework/adapter versions, bindings, domains, and production
branch policy. Keep those decisions in the app configuration and this document.
Use the vendor CLIs and existing verification commands instead of another
deployment pipeline. A failed build stops publication; a failed deployment must
be inspected before retrying. A successful deployment creates a version that
Cloudflare can roll back without rebuilding old source.

Verification covers the existing deterministic gate, Next.js browser diagnostics,
the compiled app in the local Workers runtime, and a browser check of the live
deployment including both model profiles and region selection.

## Local commands

Run from the repository root after `bun install --frozen-lockfile`:

```sh
bun run verify
bun run verify:browser
bun run build:worker
bun run preview:worker
bun run deploy
```

`build:worker` builds the web app and its workspace dependencies through Turbo,
then adapts the standalone output with OpenNext. `preview:worker` serves that
output through Wrangler on port 8787. `deploy` builds and publishes it using
Wrangler's existing local authentication; use `bunx --no-install wrangler whoami`
from `apps/web` to inspect the active account.

`apps/web/wrangler.jsonc` is the deployment source of truth. Run
`bun run --cwd apps/web cf-typegen` after changing bindings. Generated Worker
output, local state, environment files, and generated platform declarations are
ignored by Git; generated output is also excluded from source linting.

`libs/human-model` is an ordinary workspace, including canonical source assets.
It must not become a Git submodule pointer: Workers Builds updates submodules
during checkout and cannot clone an inherited pointer without a submodule URL.

## Git deployment

The Cloudflare Worker is `crispr` in account
`86eec9863a1aea1cd214947aaa4b8f33`. Workers Builds uses the existing `lbxa`
GitHub connection and existing Workers Builds token. Production listens to
`main`; branch preview builds are disabled.

Configure Workers Builds at the repository root (`/`):

| Setting                   | Value                                                                     |
| ------------------------- | ------------------------------------------------------------------------- |
| Build command             | `bun install --frozen-lockfile && bun run verify && bun run build:worker` |
| Deploy command            | `bun run --cwd apps/web deploy`                                           |
| `BUN_VERSION`             | `1.3.14`                                                                  |
| `NODE_VERSION`            | `24`                                                                      |
| `SKIP_DEPENDENCY_INSTALL` | `true`                                                                    |

Cloudflare owns build credentials and triggers; no GitHub deployment secret or
second deployment workflow is needed. Build and deploy logs appear in the
Worker's Deployments tab and the associated GitHub check. Failed verification
prevents the deploy command from running.

## Runtime and recovery

Next.js runs with `nodejs_compat`, preserving the shared structured server logs.
Workers observability and source map uploads are enabled. Use Cloudflare logs or
`bunx --no-install wrangler tail` from `apps/web` to inspect production. Keep the
Node/Bun OTLP gRPC endpoint unset in Workers; this deployment uses Cloudflare's
native log collection and does not provision a collector.

The current page does not require ISR, R2, a database, or other paid bindings.
Configure an appropriate OpenNext cache backend when introducing runtime cache
invalidation. Hashed model assets and Next's static assets are served with
immutable cache headers from `apps/web/public/_headers`.

Use the Worker's deployment history or Wrangler's rollback command to restore a
known good version. Fix source on `main` afterward so the next automatic build
preserves the recovery.

References: [Cloudflare OpenNext guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/),
[Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
[OpenNext setup](https://opennext.js.org/cloudflare/get-started).
