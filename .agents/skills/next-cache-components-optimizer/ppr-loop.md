# Static shell loop

Read the parent skill and `next-dev-loop` first. Start or attach the harness to
the route under investigation, capture a snapshot/screenshot and console/network
diagnostics, then query the advertised Next.js compilation and error tools.

Trace the observed fallback to its owning page/layout/Suspense boundary. Use the
installed Next.js Cache Components docs to distinguish request-dependent content
from cacheable content. Apply the smallest appropriate caching or boundary change,
reload through the harness, and compare evidence from the same viewport.

A settled screenshot does not prove what streamed on first paint. If timing or
Suspense details are essential, add focused instrumentation or a regression test
using the documented Next.js testing API. The current harness does not expose
React fiber introspection or arbitrary evaluation; do not invent those methods.
