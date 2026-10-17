# Human model library

Read `README.md` for the public component contract and code map. Next.js at
`apps/web` owns the application UI. This workspace exports `HumanModel`; it does
not run a separate app or development server.

- `src/human-model.tsx`: React component, controlled inputs, accessible load/error state.
- `src/scene.ts`: canvas lifecycle, renderer, camera/controls, load generations, cleanup, demand rendering.
- `src/model.ts`: abortable GLB loading, Meshopt decoding, semantic anchors, GPU disposal.
- `src/highlight.ts`: anatomy shader; `src/anatomy.ts`: region IDs and existing mappings.
- `src/profiles.ts` and `src/types.ts`: lightweight metadata and public contracts.
- `scripts/build-assets.ts`: reproducible web derivatives in `dist/assets`, with hashed filenames.
- `public/models/segmented`: canonical Blender exports. Preserve these and the `.blend` source library.
- `test/scene.test.ts`: async races, unmount/context loss, and resource ownership.
- `test/runtime-assets.test.ts`: payload budget and preservation of body/eyes/proxies.

Consumers use `@crispr/human-model`, `/profiles`, `/anatomy`, and `/asset-manifest`.
Keep Three.js inside the lazy client boundary. Never move page routing, gene
editing decisions, or app-wide DOM queries into this library. Anatomy proxies
describe display regions; they do not define genetic edit targets.

Dispose highlighter materials before model resources. Abort loads on replacement
or unmount and dispose results that arrive after cancellation. Keep React Strict
Mode safe. Pause invisible scenes and respect reduced motion. Report loading,
ready, and error outcomes through the component's state callback; browser logs
are captured by the repository harness.

Run from the repo root:

```sh
bun run --cwd libs/human-model build
bun run --cwd libs/human-model test
bun run --cwd libs/human-model check-types
bun run --cwd libs/human-model lint
bun run verify:browser
```

After changing Blender assets, also run `verify:model` and `verify:segments`.
Keep the Blender bridge loopback-only with telemetry disabled; `verify:mcp`
requires Blender to be open. Do not commit generated `dist/`, dependencies,
virtual environments, or Blender recovery files.
