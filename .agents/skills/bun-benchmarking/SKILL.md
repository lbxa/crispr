---
name: bun-benchmarking
description: Benchmark and profile Bun applications, scripts, CLIs, and HTTP servers. Use when measuring Bun performance, comparing Bun runtime behavior, investigating CPU or memory usage, generating CPU profiles or heap snapshots, or choosing benchmark tools for Bun.
---

# Bun Benchmarking

## Documentation First

Before giving Bun-specific benchmark or profiling guidance:

1. Fetch the complete Bun documentation index from `https://bun.com/docs/llms.txt`.
2. Use that index to discover relevant Bun documentation pages before exploring further.
3. Prefer current Bun documentation over memory when command flags or runtime APIs matter.

## Choose the Benchmark Tool

Use the tool that matches the workload:

- Microbenchmarks: use `mitata`.
- HTTP load testing: use `bombardier`, `oha`, or `http_load_test`.
- CLI commands and scripts: use `hyperfine`.

Do not use Node.js HTTP benchmarking tools such as `autocannon` for `Bun.serve()` load tests; they may be slower than the server and skew results.

## Measure Time

For in-process timing, use Bun runtime APIs:

```ts
const start = performance.now();
await runWorkload();
const elapsedMs = performance.now() - start;
```

For nanosecond timing since application start:

```ts
const start = Bun.nanoseconds();
await runWorkload();
const elapsedNs = Bun.nanoseconds() - start;
```

Use `performance.timeOrigin` when converting `Bun.nanoseconds()` measurements to a Unix timestamp.

## Profile CPU

Use Bun's profiler flags to capture JavaScript execution bottlenecks:

```sh
bun --cpu-prof script.js
bun --cpu-prof-md script.js
bun --cpu-prof --cpu-prof-md script.js
```

Use explicit output paths for repeatable runs:

```sh
bun --cpu-prof --cpu-prof-name my-profile.cpuprofile script.js
bun --cpu-prof --cpu-prof-dir ./profiles script.js
```

Open `.cpuprofile` files in Chrome DevTools or VS Code's CPU profiler. Prefer `--cpu-prof-md` when the result needs to be searched, reviewed in a terminal, or analyzed by an LLM.

## Profile Heap And Memory

Bun has two heaps: the JavaScript heap and the native heap.

For JavaScript heap stats:

```ts
import { heapStats } from "bun:jsc";

console.log(heapStats());
```

Garbage collection can be forced when isolating memory behavior:

```ts
Bun.gc(true); // synchronous
Bun.gc(false); // asynchronous
```

Generate a heap snapshot from code when object retention needs inspection:

```ts
import { generateHeapSnapshot } from "bun";

const snapshot = generateHeapSnapshot();
await Bun.write("heap.json", JSON.stringify(snapshot, null, 2));
```

Use Bun heap profiler flags for snapshots on exit:

```sh
bun --heap-prof script.js
bun --heap-prof-md script.js
bun --heap-prof --heap-prof-name my-snapshot.heapsnapshot script.js
bun --heap-prof --heap-prof-dir ./profiles script.js
```

Use `--heap-prof-md` for CLI or LLM analysis. If both `--heap-prof` and `--heap-prof-md` are specified, Bun uses markdown output.

For native heap stats, run with mimalloc stats enabled:

```sh
MIMALLOC_SHOW_STATS=1 bun script.js
```

## Benchmark Hygiene

When preparing results:

- Record the Bun version, OS, hardware, command, environment variables, and input data.
- Separate cold-start, warm-start, steady-state, and load-test measurements.
- Run enough iterations to reduce noise; use benchmark tooling rather than one-off timings for conclusions.
- Keep benchmark code close to the real workload and avoid measuring unrelated setup work unless startup cost is the target.
- Treat garbage-collected memory carefully: objects not freeing immediately is normal; objects never freeing may indicate retention.
- Include the generated profile or markdown profile when making optimization recommendations.
