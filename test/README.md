# Tests

`npm test` — no npm install, no test framework, no browser download. Node's
standard library plus the Chromium that is already on the machine.

That is not austerity for its own sake: MxScout's whole argument to a security
department is "read the dependency list, there isn't one". A test suite that
drags in a tree of packages would be the largest attack surface in the
repository, and it would be the thing nobody reads.

- `run.js` — the runner. Starts MxScout and a stand-in Mendix app on their own
  ports, runs every `*.test.js`, prints a line per assertion.
- `cdp.js` — a ~60-line Chrome DevTools Protocol client on Node 22's built-in
  `WebSocket`. Enough to open tabs, evaluate expressions and wait for a
  condition, which is all these tests need.
- `fake-app.js` — a stand-in Mendix app: `mx.session`, `mx.data.get`,
  `mx.data.action`, and a `/xas/` that answers `retrieve_by_xpath` with a
  count, over 253 rows. It can also serve itself with a locked-down
  Content-Security-Policy, which is what makes the standalone fallback
  testable for real rather than by mocking a failure.

The browser is whichever Chromium the machine already has: `cdp.js` looks in
the usual install locations for macOS, Linux and Windows (Chrome, Chromium,
Edge, Brave — any of them speaks the DevTools protocol). `CHROME` overrides
that:

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm test
```

If nothing is found the suite says so and lists where it looked. It used to
hold one hardcoded Linux path, which on any other machine surfaced as a spawn
`ENOENT` in the middle of the run — a missing browser reading like a broken
test.
