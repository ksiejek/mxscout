# Tests

`npm test` — no npm install, no test framework, no browser download. Node's
standard library plus the Chromium that is already on the machine.

That is not austerity for its own sake: MxScout's whole argument to a security
department is "read the dependency list, there isn't one". A test suite that
drags in a tree of packages would be the largest attack surface in the
repository, and it would be the thing nobody reads.

- `run.js` — the runner. Starts MxScout and a stand-in Mendix app on their own
  ports, runs every `*.test.js`, prints a line per assertion.
- `cdp.js` — a small Chrome DevTools Protocol client on Node 22's built-in
  `WebSocket`. Enough to open tabs, evaluate expressions and wait for a
  condition, which is all these tests need — and, for the runner, a time limit
  on every command (`CDP_COMMAND_TIMEOUT`, seconds, 60 by default; a closed
  connection fails every command still waiting, naming it), each tab's console
  kept, a screenshot, and clearing what a page stored.
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

Each run starts the browser with a fresh profile in the system's temp folder
and removes it when the browser closes — at the end of the run, after a
failure, or on Ctrl-C — and a run that leaves its profile behind fails. It did
not use to: the profiles piled up until the disk was full.

Each test file starts from an empty browser: after a file, the runner closes
the tabs it left open and clears everything MxScout stored for its address —
IndexedDB, the private file system, localStorage — so no file passes or fails
because of what an earlier one left. A file has `MXSCOUT_TEST_TIMEOUT` seconds
(300 by default); one that runs out fails, says what it was waiting for, and
the run goes on. When a file fails, the runner saves each of its open tabs'
screenshot and console, and what the test last asked of it, in a
`mxscout-test-failures-…` folder in the system's temp folder, and prints the
path.

Text files are read through `helpers.js`' `readText`, which reads CRLF as LF,
and whether `skills/install.sh` is executable is asked of git's index — so the
suite checks the same thing on a Windows checkout as anywhere else. On GitHub,
`.github/workflows/test.yml` runs it on Windows, Linux and macOS.
