# Navigation loop

Read the parent skill and `next-dev-loop` first. Use a single harness session.
Open route A, capture its state, click the observed link to route B, wait for the
actual expected content or URL, then capture B and its diagnostics. Compare the
same flow after a bounded change. A direct `open` to B tests a document load, not
the client navigation from A.

Inspect owning route/cache/Suspense boundaries using installed Next.js docs and
framework diagnostics. Do not claim instant-navigation guarantees from a settled
snapshot alone. If a timing guarantee matters, add a regression test using the
installed Next.js testing API, and state any unavailable timing instrumentation.
Preserve the run ID, console/network/CDP evidence, and screenshots before closing.
