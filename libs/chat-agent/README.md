# @crispr/chat-agent

Knowledge graph, retrieval and the AI SDK tool loop behind `/chat`. Moved from
`prototypes/chat-workbench`.

**Simulated genomes only. Not medical advice. Off-target risk is not assessed
anywhere in this code; on-target scores are not computed.**

## Code map

| Path                | Owns                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `lib/graph/`        | Typed property graph, seed fixture, linker, diagnosis scoring, ingest   |
| `lib/metrics/`      | Metric cards, guide geometry, edit-option screening, phenotype match    |
| `lib/retrieval/`    | Intent router, focus, retrieval, citation registry, prompt suggestions  |
| `lib/papers/`       | Europe PMC search (untrusted text), BM25 ranking, paper cache           |
| `lib/sequence/`     | Synthetic sequence windows (default); Ensembl GRCh38 provider           |
| `lib/ui/payload.ts` | Typed `data-*` parts streamed to the page (`CrisprUIMessage`)           |
| `agent/handler.ts`  | `POST /api/chat`: validation, retrieval, streaming tool loop, grounding |
| `agent/state.ts`    | `GET /api/state`: first-view panels and prompt bubbles, no model call   |
| `agent/model.ts`    | Model choice from `AI_GATEWAY_API_KEY` / `CRISPR_MODEL`, else demo      |
| `scripts/*.test.ts` | Node test runner suites (`tsx --test`)                                  |

## Commands

```sh
bun run check-types
bun run test
bun run lint
bun run bench   # retrieval latency on the seed graph
```

## Changelog

### 2026-10-18

- Moved from `prototypes/chat-workbench` into a workspace so the web app imports
  it as `@crispr/chat-agent` instead of reaching into `prototypes/`. Code is
  unchanged apart from prettier formatting and two lint fixes. The prototype's
  `serve.ts` and `app/api/*` wrappers are not carried over: Next.js serves the
  routes. Dependencies are pinned to the versions already in `bun.lock`.
