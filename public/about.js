/* MxScout — the About & security page.
 *
 * MxScout is meant to live inside a company network, on machines a security
 * team is responsible for. A tool that cannot explain itself gets blocked, so
 * this page is part of the product, not documentation about it: it is the
 * inventory of what MxScout runs, what it touches and what it refuses to do,
 * written to be read by someone who has never seen the code.
 *
 * Two rules keep it honest. It is a DESCRIPTION, not a promise — every claim
 * here must be checkable in the source, so when behaviour changes this text
 * changes in the same commit. And where a control is weak (the non-production
 * guard is a guardrail, not a security boundary) it says so plainly; a
 * reviewer who catches one overstatement rightly distrusts the whole page.
 *
 * It lives in its own file for the same reason it exists: it is the one thing
 * here a person outside the project reads end to end, and it should be
 * findable without scrolling past three thousand lines of UI first.
 *
 * The document is DATA, rendered by block() below. Block kinds:
 *   { p: 'paragraph' }
 *   { ul: ['bullet', …] }
 *   { kv: [['key', 'value'], …] }
 *   { note: 'call-out, for limits and caveats' }
 */
(function () {
  'use strict';

  var el = null;

  function init(api) { el = api.el; }

  function doc(version) {
    return [
      { id: 'what', title: 'What MxScout is', blocks: [
        { p: 'MxScout is a local explorer for a Mendix application model, made for testers and developers. It runs as a small Node.js process on the user’s own machine and shows a UI in their browser. It reads a model either as JSON exported from MxSonar, or directly from a Mendix project folder — the browser reads and decodes the .mpr file itself, no Studio Pro or other tool involved — and, only for development, test and acceptance environments, can connect to a running app to show what a logged-in role really sees.' },
        { p: 'This page exists so it can be handed to a security reviewer. Everything on it is checkable against the source, which ships with the tool.' },
        { kv: [
          ['Version', version ? version + ' (reported by the running server)' : 'unavailable — the local server did not answer'],
          ['Licence', 'GPL-3.0-or-later — the complete source is readable, unminified, with no build step between it and what runs'],
          ['Runtime', 'Node.js, standard library only (http, fs, path, crypto, url)'],
          ['Third-party dependencies', 'None. package.json declares no dependencies; there is no node_modules, no lockfile and no npm install step'],
          ['Size', 'About 17,200 lines across 27 files — small enough to read end to end. The test suite ships alongside it in test/, another 36 files and about 4,800 lines that never run as part of the app'],
          ['Install footprint', 'A folder. No installer, no administrator rights, no system service, no scheduled task, no registry or autostart entry, no PATH change'],
          ['Starting it', 'A script in that folder: start.sh, or MxScout.cmd / MxScout.command for a double-click. It runs Node.js on the files already there and opens the browser on 127.0.0.1. On a machine with no Node.js installed, and only after the person typing yes to the question, the launcher downloads the official Node build from nodejs.org into ./runtime — one folder, deleted like any other, no installer and no administrator rights. That is the only thing MxScout ever writes outside the browser, it happens in the launcher and never in the server process, and it never happens without being asked. Answering no, or having no network, leaves the folder untouched'],
          ['Runs as', 'The user who starts it, with that user’s permissions. Nothing is elevated'],
          ['Listening port', 'TCP 4288, bound to 127.0.0.1 only (MXSCOUT_PORT changes the number, never the interface)']
        ] }
      ] },

      { id: 'never', title: 'What MxScout never does', blocks: [
        { p: 'These are not settings. They are properties of the code, and each one is the absence of a capability rather than a switch that could be turned back on.' },
        { ul: [
          'No database connection of any kind — no driver, no connection string, no credentials. MxScout cannot read your app’s database.',
          'Never asks for, stores or transmits an API key or a session cookie. It asks for exactly one password — the Mendix admin port’s, which the runtime mints fresh every time the app starts — and only when you choose to record performance. It is held in the server process’s memory for that session, never written to disk, never logged, never returned by any endpoint, and dropped the moment you disconnect or stop MxScout.',
          'No .mpr parsing on the server, and no Studio Pro or CLI tool involved anywhere. A picked Mendix project folder is read and decoded entirely in the browser, in a Web Worker — see “Reading a Mendix project folder” below.',
          'The server process opens exactly one kind of outbound connection, and only while you are recording performance: to a Mendix Runtime admin port, at an address that passed the same non-production guard as everything else MxScout will talk to, asking two read-only actions. It has no other reason to connect and no code that could — see “Reading a running app’s admin port” below for what bounds it. It fetches nothing else, downloads nothing, phones no home and checks for no updates. (The launcher script is a different process, and the one thing it can fetch — a Node.js runtime, only when the machine has none and only when told to — is described under “Starting it” above.)',
          'No telemetry, no analytics, no crash reporting, no licence check.',
          'No external assets — no CDN, no web fonts, no remote images. The UI renders correctly on a machine with no internet access.',
          'No cookies, no accounts, no login.',
          'The server process writes nothing to disk. Not a log, not a cache, not a temporary file. Exports are ordinary browser downloads the user starts, and the launcher’s optional ./runtime is written before the server exists, not by it.',
          'No background process and no persistence: close the terminal and the server is gone, along with everything it held in memory.'
        ] }
      ] },

      { id: 'data', title: 'Where the data lives', blocks: [
        { kv: [
          ['The model', 'The browser’s own database (IndexedDB) for 127.0.0.1:4288 — this machine, this browser profile. It is never uploaded and never reaches the MxScout server.'],
          ['A page of rows read from the app', 'The server process’s memory, in transit between the app tab and the MxScout window. One slot, replaced by the next request, cleared on exit.'],
          ['Live-execution state', 'The same memory: one armed command and its result.'],
          ['Server logs', 'Your terminal, stdout only. Counts, entity and flow names, ok/failed. Never row data, never object ids, never the session token.'],
          ['Packages you send', 'A file the browser downloads, encrypted with a code MxScout shows once and never stores. See “The encrypted package” below.'],
          ['A performance recording', 'The browser’s own database, same as the model. While a recording runs, its samples sit in the server’s memory and are handed to the browser when you stop — a recording is never written to disk by the server, and never leaves this machine. The Mendix admin password it needs is read by a tiny PowerShell script you run once per app run, and pasted in by hand; MxScout cannot read it itself. From there it lives in the server process’s memory for this session and nowhere else — not in the browser’s database, not in any file, not in any log, and no endpoint gives it back. Disconnecting, or stopping MxScout, is the end of it.'],
          ['Comments', 'The same database. They are the one thing here nobody can regenerate, which is why the export reminder matters.'],
          ['Nothing else', 'MxScout asks the browser to keep that database from being evicted (navigator.storage.persist). That is a request about storage the browser already holds — it grants no new access and reaches nothing outside the page.']
        ] },
        { p: 'The most sensitive thing MxScout ever holds is the page of application data read back from the app under test. It is capped before it is stored — at most 100 rows, 200 fields per row, 500 characters per value — kept in memory, replaced by the next request, never logged and never written to disk. The server log records how many rows came back, never what was in them.' }
      ] },

      { id: 'mpr', title: 'Reading a Mendix project folder', blocks: [
        { p: 'A Mendix project file (.mpr) is a SQLite database. MxSonar reads it with sql.js (SQLite compiled to WebAssembly) and the bson npm package; MxScout has neither available, so both are hand-written instead — a page/b-tree reader for the SQLite file (public/sqlite.js) and a decoder for the BSON documents Mendix stores inside it (public/bson.js), together under 500 lines. Both formats Mendix has used are supported: the older one keeps a model document’s full content inline in the project file; the newer one (Studio Pro 10.18 and later) keeps it in a sibling mprcontents folder instead.' },
        { p: 'On a Chromium browser, picking is one step: “choose a Mendix project folder” uses the File System Access API to get a handle to that folder, then reads only what the model actually needs from it — the .mpr file, and, only for a v2-format project, the mprcontents subfolder — without ever listing or reading anything else in the project (javasource, themesource, deployment, and everything else Studio Pro puts next to it). Elsewhere, picking is two steps: the .mpr file itself, then — again, only for a v2-format project — that one mprcontents folder, asked for on its own rather than as part of a whole-project scan.' },
        { p: 'The whole parse — reading the SQLite pages, decoding the BSON, building the module/entity/microflow list the rest of the app shows — runs in a Web Worker, off the page’s main thread, and never leaves the browser. The Worker sees the picked files directly; nothing is uploaded, and the MxScout server is not involved at all — it never receives the .mpr file, never receives any file from the project folder, and has no endpoint that could accept one.' },
        { note: 'public/bson.js only decodes — there is no encoder, and none is planned. MxScout never writes a .mpr file; a capability to produce one is not something reading a project needs, and this codebase deliberately does not build it.' },
        { note: 'The System module (User, Session, FileDocument, Image, UserRole, Owned) never appears in a project’s own .mpr file — it ships with the Mendix Runtime, not with the project, so there is nothing there to parse. MxScout adds it back as a small, fixed, hard-coded list (public/app.js) rather than pretending to read it from a file that never contains it — it has no attribute data attached for the same reason, though its Data tab still queries a connected app for real rows.' },
        { note: 'A module flagged in the project as coming from the Mendix Marketplace (Studio Pro’s own App Explorer buckets these under “Marketplace modules”) is hidden from every browsing view by default — not just dimmed, entirely absent from the chip row, the lists, the map and its entities/microflows/nanoflows/pages — since a security or code review usually cares about the project’s own modules first. Nothing is deleted: a per-project setting (Settings tab) shows them again, and packaging/export always includes the full, unfiltered model regardless of what is currently hidden from view.' }
      ] },

      { id: 'network', title: 'Network behaviour', blocks: [
        { p: 'Three parties can be involved: the MxScout server on loopback, the MxScout tab in the browser, and the tab where the tester already has the app under test open. While a performance recording is running, the server also talks to that app’s Mendix Runtime admin port.' },
        { ul: [
          'The server binds 127.0.0.1. It is not reachable from another machine, and there is no option to make it listen on a wider interface.',
          'The server is a passive listener on loopback except for one thing: while a performance recording is running, it calls the admin port of the app under test. Nothing else in the server can open a connection.',
          'Requests to your Mendix application are made by the tester’s own browser tab, in their own already-authenticated session: mx.data.get to read rows, mx.data.action to run a flow, and one POST to that app’s own /xas/ endpoint (action retrieve_by_xpath, count: true) — the same call the Mendix client itself makes behind every paged data grid — purely to ask how many rows match. All three are same-origin to the application, carry that person’s own session and CSRF token, and read only. MxScout adds no access path: everything the snippet does is something that same person can do by clicking in the app.',
          'A row that comes back is also asked, object by object, whether this session may write each of its values — isReadonlyAttr, the same question the Mendix client’s own input widgets ask before they allow editing. That is a question about an object already in hand: it sends nothing, fetches nothing extra, and writes nothing. It is asked per object because a rule’s XPath decides which rows it covers, so the same attribute can be writable on one row and read-only on the next — which is what the green in the Data table means.',
          'Those admin-port calls (server/admin-port.js, the only file in MxScout that can open a socket) go to an address you gave, checked by the same non-production guard as the app itself — local, dev, test and acceptance pass; anything that looks like production is refused before a socket exists. They ask two read-only actions, get_current_runtime_requests and runtime_statistics, and no third one is reachable: the action name is checked against that list rather than passed through, which is what stops this from becoming a way to reach the same API’s shutdown and log-level actions. Nothing runs unless a recording is running.',
          'The app tab’s badge carries the record button, so a recording is started and finished where the tester already is. That button reads and asks — nothing more: it never sees the admin port, the password, or a sample. The server does the reading, and the samples go to MxScout’s own window to be saved.',
          'So no traffic leaves the machine at all: the tester’s own browser tabs reach addresses the tester chose, in sessions the tester already holds, and the server’s one outbound connection cannot leave loopback.'
        ] }
      ] },

      { id: 'adminport', title: 'Reading a running app’s admin port', blocks: [
        { p: 'This is the one place MxScout connects outward, so it is written out in full rather than summarised. It exists because the Mendix Runtime’s admin port is the only source of what a performance recording is for: the internal action stack behind a request — which microflow called which, the activity running at that instant, the XPath behind a retrieve. Network traffic does not carry it and the log does not either.' },
        { p: 'A browser tab cannot read that port. The admin API needs a custom authentication header, which makes every call a preflighted cross-origin request, and the port answers no CORS at all. MxScout used to work around that by having you paste a script into a browser tab open on the admin port itself. That worked, and asking someone to paste a script into a console is not obviously the safer thing to be doing, so it is gone: the server makes the call now, under limits written into the code rather than into this page.' },
        { ul: [
          'The address goes through the same non-production guard as the app under test, and the server applies it itself rather than trusting the page that asked: local hosts, and hosts carrying a conventional dev / test / acceptance marker, are allowed. A production-looking address is refused before any socket exists.',
          'Two actions are permitted, both read-only: get_current_runtime_requests and runtime_statistics. The name is matched against that pair rather than forwarded, which is what keeps this from being a route to the same API’s shutdown and log-level actions.',
          'Nothing connects unless a recording is running. Between recordings there is no timer and no socket.',
          'While one is running, the loop asks the port what is executing, waits for the answer, and asks again — never closer together than 20 ms, and never before the previous answer has arrived, so a busy runtime is asked LESS often rather than piled up on. The heavier of the two calls, the runtime-wide statistics, rides along about four times a second instead of on every round. Both are reads; neither can change anything in the app.',
          'Nothing about the admin port is reachable from another origin. The two endpoints that are cross-origin belong to the record button on the app tab’s badge, are gated on the session token like the rest of that bridge, and can do exactly two things: read whether a recording is running, and ask to start or stop one. Neither carries the address, the password, or any sample.',
          'The password is checked against the port before it is kept, held in the server process’s memory for the session, and returned by nothing. Disconnect forgets it; so does stopping MxScout.'
        ] },
        { note: 'This replaced an earlier promise that the server made no outbound connections at all. The sentence was true and is now narrower, which is why it is stated in one place with its limits rather than repeated as a slogan. server/admin-port.js is about two hundred lines and is the whole of it.' }
      ] },

      { id: 'endpoints', title: 'Every endpoint, and who may reach it', blocks: [
        { kv: [
          ['GET /api/health', 'Name and version. Same-origin only.'],
          ['GET /api/changelog', 'The CHANGELOG.md that ships with this copy, read from disk. Same-origin only. One fixed path, no parameters.'],
          ['POST /api/session/start', 'Mints a fresh random session token. Same-origin only.'],
          ['POST · DELETE · GET /api/session/exec', 'Arm, cancel or inspect one request to the app. Same-origin only.'],
          ['GET /api/session/ping', 'The bridge asks whether it can reach MxScout at all. Cross-origin, token-gated.'],
          ['GET /api/session/exec/poll', 'The bridge asks whether anything is waiting for it. Cross-origin, token-gated, dispatched at most once. Held open for up to 25 seconds rather than answering immediately, so the app tab reacts at once instead of on a timer.'],
          ['POST /api/session/exec/result', 'The bridge reports how a run went. Cross-origin, token-gated.'],
          ['POST /api/session/data', 'The bridge returns one page of rows it read, each with the ids, the values, and — per row — which of those values this session may write. Cross-origin, token-gated, rebuilt field by field on the server rather than forwarded: values are truncated to a fixed length and the write flags are kept only as true or false, only for columns that actually came back.'],
          ['GET /api/session/data', 'The UI collects that page. Same-origin only.'],
          ['POST /api/session/perf/connect', 'The one endpoint in MxScout that receives a password. You give it an admin-port address; it runs the non-production guard, checks the password against that port before keeping anything, and answers only what it connected to. A password that does not work is never stored. Same-origin only.'],
          ['POST /api/session/perf/disconnect', 'Forgets that password and stops anything running on it. This is how the password leaves memory before MxScout does. Same-origin only.'],
          ['GET /api/session/perf/status', 'The UI asks whether the admin port is connected and recording, how many samples there are, when the recording began, and whether the port has stopped answering. Never includes the password. Same-origin only.'],
          ['POST /api/session/perf/start', 'Starts the sampling loop and clears whatever a previous recording left behind. Refused if no admin port is connected. Same-origin only.'],
          ['POST /api/session/perf/stop', 'Stops the loop and returns everything it collected, so the UI can save it into the browser’s own database. A stop that arrives twice for the same recording answers the same thing twice — a browser re-sending a request whose answer was lost must not be able to turn a recording into an empty one. Same-origin only.'],
          ['GET /api/session/perf/poll', 'The record button on the app tab’s badge asks whether an admin port is connected, whether a recording is running, and how many samples it has. Cross-origin, token-gated. It carries no address and no password — only what that button needs to draw itself.'],
          ['POST /api/session/perf/request', 'That same button asking to start or stop — the same change the Start and Finish buttons in MxScout’s own window make. Cross-origin, token-gated. A stop only halts the sampling; the samples are collected by MxScout’s own page through perf/stop above, because only that page can save a recording into its database.']
        ] },
        { p: 'That is the complete list. Anything else under /api answers 404, and every other GET serves one of the static files in public/.' },
        { p: 'Each of the six cross-origin ones also answers OPTIONS — the browser’s own preflight, which carries no token because a preflight cannot carry one: it sets the CORS headers, returns 204, and reaches nothing else. So the route table in server/index.js shows twelve cross-origin entries where this page names six endpoints; the other six are those preflights, and getting past one still leaves the real request needing the token.' },
        { note: 'Rows read out of your application pass through the server on their way from the app tab to the MxScout window, and are held in memory only until the next request replaces them. They are never written to disk and never logged — the log records how many rows came back, never what was in them.' }
      ] },

      { id: 'package', title: 'The encrypted package', blocks: [
        { p: 'A project leaves this browser one way: as a `.mxscout` package, encrypted, opened only with an access code that MxScout generates and shows once. What is protected is the file in transit — mail, chat, a network share.' },
        { kv: [
          ['Key derivation', 'PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random salt — the current OWASP figure.'],
          ['Encryption', 'AES-256-GCM with a 12-byte random IV. The authentication tag means a wrong code or a modified file is refused outright; there is no path that shows half a model.'],
          ['Compression', 'gzip before encryption, via the browser\u2019s own Compression Streams.'],
          ['Access code', '100 bits of entropy from crypto.getRandomValues, in an alphabet without I, L, O or U so it survives being read aloud. Shown once, never stored, not recoverable — a new export mints a new code.'],
          ['Implementation', 'WebCrypto only. No cryptography is written by hand here and no library is pulled in.']
        ] },
        { p: 'The envelope is JSON rather than an opaque binary blob on purpose, and this page is the reason: open one in a text editor and you can confirm in seconds which algorithms it declares and that no model text is in the clear. The plaintext half carries no application name and no project name — the file name is the only thing about the contents that travels readable, and it can be changed.' },
        { p: 'A review can also leave as a report rather than as a project. The encrypted HTML report uses the same envelope and the same kind of access code, in one self-contained file that needs nothing but a browser — it renders by building elements from the decrypted data, never by assigning markup. The Word copy is the exception: it is plain content on the clipboard, carries no author, and is not protected at all. MxScout says so on the screen that offers it, because removing the authors does not make a list of an application\u2019s weaknesses safe to circulate.' },
        { note: 'The encryption protects the file on its way to someone. Once imported, the model and its comments sit unencrypted in that browser\u2019s database, on that person\u2019s own machine. That is a deliberate trade — the threat being addressed is a file travelling by email, not the reader\u2019s own browser profile — and MxScout would rather say so than let it be assumed.' }
      ] },

      { id: 'hardening', title: 'Hardening', blocks: [
        { ul: [
          'Content-Security-Policy on every response: default-src \'self\', no remote script, no framing (frame-ancestors \'none\'), base-uri \'none\'.',
          'The UI builds every element and sets textContent. One DOM helper does it, and it deliberately offers no markup escape hatch, so nothing inside a model file, a comment or a row of application data can become executable content.',
          'There is exactly ONE place in the whole codebase that assigns markup: the clipboard fallback in public/report.js, which puts MxScout\u2019s own generated, fully escaped HTML into an off-screen node for one tick so that a rich-text copy works in older browsers. It is named here rather than glossed over, and a test fails if a second one ever appears.',
          'X-Content-Type-Options: nosniff, X-Frame-Options: DENY and Referrer-Policy: no-referrer on every response.',
          'Static files come from one directory, behind a path-traversal guard.',
          'Request bodies are capped at 64 MB and must carry Content-Type: application/json — which also closes the classic HTML-form CSRF trick that skips the browser’s preflight.',
          'Every route is same-origin only, except the six the app’s own tab must reach. Those are gated on a 128-bit random session token instead.',
          'Anything a browser script sends back is treated as hostile input: the server rebuilds it field by field, bounded in length and count, rather than storing the shape it was handed.'
        ] }
      ] },

      { id: 'token', title: 'Why six endpoints accept cross-origin requests', blocks: [
        { p: 'The bridge is a snippet the tester pastes into the console of the app’s own tab — so everything it sends back to MxScout necessarily comes from that tab’s origin, not from ours. Binding to loopback stops the rest of the network, but not another tab on the same machine.' },
        { p: 'So those six endpoints are gated on a token instead of on the Origin header. The MxScout UI mints a fresh random token immediately before generating a snippet; the snippet carries it and echoes it back, and only a request presenting the current token is accepted. Reconnecting invalidates every snippet generated before it, and a superseded snippet is told so and stops rather than retrying. A website the user happens to have open cannot guess the value, and therefore cannot plant fabricated data or steer a run.' }
      ] },

      { id: 'prod', title: 'The non-production guard', blocks: [
        { p: 'Before MxScout will connect to a running app, the address is classified, and only clearly non-production environments are allowed through:' },
        { ul: [
          'Local hosts — localhost, 127.0.0.1, ::1, *.local, *.localhost — are allowed.',
          'A host carrying a conventional non-production marker as a whole dot- or dash-separated label is allowed: dev, development, test, testing, tst, accept, acceptance, acc, acp, accp, sandbox, staging, stage, uat, qa, local.',
          'Everything else is refused: a bare *.mendixcloud.com, a company domain, an address on the LAN, anything that is not http(s), anything unparseable.',
          'Markers are matched as whole tokens, never as substrings, so a host like account.company.com is not mistaken for an acc environment.',
          'The same check is re-embedded in the generated snippet and runs against the tab it was pasted into — so it holds where it matters, not only in the UI. An automated check compares the two copies of the list before every release, because a difference between them would otherwise be silent.'
        ] },
        { note: 'Stated plainly: this is a guardrail against mistakes, not a security boundary. MxScout is open source, so a determined developer can edit the check out. Its job is to stop a tester from pointing a read or a run at production by accident. It is not, and is not claimed to be, a control that would stop someone who intends to.' }
      ] },

      { id: 'exec', title: 'Live execution — the two things that can change data', blocks: [
        { p: 'MxScout can trigger a microflow or nanoflow in the connected app tab, and it can create a temporary (non-persistable) object there — the second exists because a non-persistable entity has no database row to browse, so testing a flow that takes one as input means creating a fresh one first. If either writes, deletes or sends something, that really happens — in the tester’s own session, with exactly the rights they already have. Everything else in MxScout is read-only, including looking up an object by an id the tester already knows: that is a plain read, same as browsing any other entity.' },
        { p: 'Both are wrapped the same way:' },
        { ul: [
          'Refused outright on anything the guard above does not classify as a development, test or acceptance environment.',
          'Reading data, looking up an object by id, running a flow, and creating an object all travel the same channel but are validated separately: a read or a lookup carries no parameters and no values, and nothing on the server turns one into a write.',
          'A flow’s inputs are validated by shape before they leave: object inputs must be plain numeric object ids, and typed-in values are bounded and coerced to a string, a finite number or a boolean — the server holds no model, so that is as far as checking a parameter can honestly go, and it says so rather than implying more.',
          'An object input may carry attribute values to set on it before the run. The bridge applies them to the loaded object as uncommitted changes (obj.set) and hands it to the flow — the flow sees the values, but nothing is written to the database unless the flow itself commits. The values are validated the same way a created object’s are, and the confirmation names each one.',
          'Anything a search or a parameter puts into an XPath expression — the field being searched, the attributes an untargeted search covers — must be a plain identifier, checked on the server before the bridge builds the expression. The term itself is compared by the chosen field’s own type rather than pasted into a text match, and a term that cannot mean anything for that field matches nothing instead of quietly matching everything.',
          'The user must acknowledge a warning each time a project is opened, before either running a flow or creating an object is offered. The acknowledgment is never remembered — not across reloads, not across projects.',
          'Every run or create needs a confirmation naming the exact flow and the exact objects and typed-in values, or the exact entity and the exact values about to be set.',
          'Arming is same-origin only; the server validates the shape, and the UI only ever offers flows and entities that exist in the loaded model.',
          'A command is dispatched to the bridge exactly once — a retried poll can never run the same flow (or the same create) twice — and a result for a stale or unknown command id is discarded.',
          'The bridge shows a badge in the app tab for as long as it is connected, with an ✕ that stops it.'
        ] },
        { p: 'One thing MxScout watches but never initiates: while the bridge is connected, it wraps the app’s own mx.data.action read-only and notes which object ids the app’s microflow calls carry. This is the only way to point at a temporary (non-persistable) object — it has no store to list from — without a tester copying an id out of the console by hand. It is observation, not access: nothing here starts a call, reads a cookie or a token, or touches anything the tester’s own clicks did not already send; the noted ids stay in the app tab’s memory, bounded, and leave it only when MxScout explicitly asks for them, offered back as plain lookups the tester could already do by id.' }
      ] },

      { id: 'updates', title: 'Versions and updates', blocks: [
        { p: 'MxScout does not check whether a newer version exists. Not on startup, not behind a button, not at all. Three reasons, in order of weight:' },
        { ul: [
          'A version check would mean connecting to somewhere other than this machine, and the promise above — that nothing MxScout does reaches past loopback — is the single sentence a review remembers. It is worth more than the convenience.',
          'Inside a corporate network the check would usually fail anyway, so an automatic one would mostly greet the user with an error MxScout caused itself.',
          'MxScout has no write access to its own directory and should not have any. An application that downloads and overwrites its own files is the pattern most often blocked, and rightly.'
        ] },
        { p: 'What it does instead: it tells you exactly which version is running — read from the server rather than from a constant, so it cannot claim a version it is not — and shows you what is in that version, from the CHANGELOG.md that ships inside the copy you are running.' },
        { p: 'It also notices when the version has CHANGED since you last used it, and shows you what you moved onto. That needs no network: the fact lives in this browser. It is the "there is a new version, here is what changed" moment, arriving when the update actually happened rather than when a remote server was asked about one.' },
        { kv: [
          ['Finding out whether a newer one exists', 'You look at the repository. MxScout does not.'],
          ['Moving to it', 'A person runs git pull in the MxScout directory, or replaces the directory. MxScout never rewrites its own files.'],
          ['Source of truth', 'The version field in package.json, served by /api/health.']
        ] }
      ] },

      { id: 'source', title: 'Reading the source', blocks: [
        { p: '27 files, no build step. What runs is what you read. The largest is under 2,400 lines. The test suite in test/ is not in this list because none of it runs as part of the app — it is there to be read and run yourself.' },
        { kv: [
          ['server/index.js', 'The whole HTTP server: loopback bind, security headers, the same-origin gate, the route table, static files.'],
          ['server/routes/session.js', 'Every endpoint listed above, with its validation.'],
          ['server/state.js', 'All server state — the session token, the one command in flight and its answer, the admin-port connection including the password, and the recording’s sample buffer. Every one of them is a module variable in one process, and nothing else is held anywhere.'],
          ['server/http-util.js', 'Body reading: the size cap and the JSON content-type gate.'],
          ['public/app.js', 'The shell: state, projects, the browsing views, and what each other file is given.'],
          ['public/objects.js', 'The two object popups — an entity on Attributes & access (one matrix of its members, attributes and the associations it owns, against the access rules that apply) / Data / Comments, a flow on Run (inputs and access side by side) / Comments.'],
          ['public/live.js', 'Everything about talking to a running application: the non-production guard the UI consults, the session, the connection, reading rows, and running a flow.'],
          ['public/perf.js', 'The performance recording, browser side: the tiny PowerShell script that only reveals the admin password, the three setup steps, Start/Finish, a dashboard of saved recordings, and an analyzer (Overview / Timeline / Call tree / Hotspots tabs) for one of them — the Overview separates what the runtime counted itself (the database operations) from what the sampler caught (microflow and retrieve counts, which are a floor, never a tally), the Timeline stretches to as many pixels per second as you ask for and scrolls, and carries the runtime’s heap and database counters on the same ruler as the requests, all of it computed in this browser from samples already in its own database — the same comments.js findings every object popup uses, reachable from a Hotspots row. A name anywhere in the analyzer opens that entity or microflow in its own popup OVER the recording, so reading one costs nothing: closing it puts you back on the same tab, the same zoom and the same picked call. Recordings can be exported to a JSON file and imported back from one; import is a file read in this tab and a row written to this browser’s database, with no admin port, no server round trip and no network of any kind. It never talks to the admin port itself — it cannot, and the reason is in “Reading a running app’s admin port” above.'],
          ['public/bridge.js', 'The one snippet pasted into the app tab, written as ordinary code and serialized when it is generated — so what the tester pastes is a file you can read here, not a string assembled at runtime. It also draws the corner badge, including the record button that starts and finishes a performance recording without leaving the app.'],
          ['server/admin-port.js', 'The only file in MxScout that can open an outbound connection, and the shortest way to check every claim on this page about that: the loopback-only address list, the two-action allowlist, and the sampling loop that runs while a recording does.'],
          ['public/store.js', 'Every persistent read and write, and nothing else does storage. The browser’s own database — no disk, no server.'],
          ['public/crypto.js', 'The package format and the access code. WebCrypto only — no hand-written cryptography, no library.'],
          ['public/transfer.js', 'How a project leaves this browser and how one arrives: the whitelist of what may travel, the dialogs, and the merge back into storage.'],
          ['public/sqlite.js', 'A hand-written SQLite page/b-tree reader — the .mpr file itself is a SQLite database. Decode-only, no SQL engine, one table at a time.'],
          ['public/bson.js', 'A hand-written decoder for the BSON documents Mendix stores inside a .mpr. Decode-only.'],
          ['public/mpr.js', 'Turns a decoded .mpr Unit table into the same model shape a JSON import produces.'],
          ['public/mprWorker.js', 'Runs sqlite.js, bson.js and mpr.js in a Web Worker, off the page’s main thread.'],
          ['public/mprImport.js', 'Picking a Mendix project — one folder pick on Chromium via the File System Access API, or the .mpr file plus its mprcontents folder if the format needs one — the progress dialog, and handing the finished model to app.js.'],
          ['public/comments.js', 'Comments: writing them, filtering them, the history that records when one was marked fixed, the whitelist that decides what leaves in a package, and the rule by which two copies of one comment reconcile.'],
          ['public/report.js', 'The two report outputs — the clipboard copy for Word, and the standalone encrypted HTML file. Also the one place in the codebase that assigns markup, named in Hardening above.'],
          ['public/timeline.js', 'The performance Timeline: one time axis, the tracks drawn on it, and the panel for whatever is picked. It reads no samples of its own — every number it draws is handed to it by perf.js.'],
          ['public/version.js', 'Which version is running, what is in it, and the reasoning for not checking whether a newer one exists.'],
          ['public/about.js', 'This page. It is data — a list of sections and blocks — rendered by one function that only ever sets text.'],
          ['public/guide.js', 'The Getting started walkthrough. Same shape as this page — data, rendered by one function that only sets text — but every mockup on it is built from the real component classes the actual screens use, against a fictional project.'],
          ['public/palette.js', 'The command palette: the path it walks, the matching, and the keyboard.'],
          ['public/index.html · public/styles.css', 'The page shell and its styling. No external references.']
        ] }
      ] },

      { id: 'faq', title: 'Questions a review usually asks', blocks: [
        { kv: [
          ['Does it need internet access?', 'No. It works on a machine with no route out. The app under test is reached by the tester’s own browser, and the one connection MxScout itself makes — to that app’s admin port while recording performance — goes wherever you pointed it, which the non-production guard limits to local, test and acceptance addresses.'],
          ['Does it need administrator rights?', 'No. It is started by the user and runs with that user’s permissions.'],
          ['Does it open a port other machines can reach?', 'No. It listens on TCP 4288 on the loopback interface only.'],
          ['Does it handle credentials?', 'One, and only if you record performance: the Mendix admin port’s password, which the runtime mints fresh every time the app starts. You paste it in; it stays in the server process’s memory for that session, is never written down anywhere, and no endpoint returns it. Everything else relies on a session the tester has already established in their own browser — MxScout never sees an application password, a token or a session cookie.'],
          ['Can it reach production?', 'It refuses by design (see the guard above), and that refusal is repeated inside every generated script. It is a guardrail against accidents, not a control against intent.'],
          ['What could leak if the machine were compromised?', 'Only what is already in that browser: the model, the comments and any saved performance recordings in its own database, and — if a page of data was just read, or a performance recording is in progress — at most a hundred rows, or that recording’s samples, in the server process’s memory, cleared on the next request or on Finish. While an admin port is connected, its password is in that memory too, until you disconnect. Nothing is on disk and nothing is sent anywhere. All of it is already readable by anyone who has that machine and that browser profile.'],
          ['Can it modify our application?', 'Only through running a flow, above: one the tester opens and runs in their own session, with their own rights, on a non-production environment, after two explicit confirmations that name the flow and the object. Reading data cannot write: a read request carries no object parameters and there is no path that turns one into a run.'],
          ['Is the code auditable?', 'Yes. No dependencies, no minification, no bundler, no obfuscation — around 17,200 readable lines under GPL-3.0-or-later.'],
          ['Does it read files from my disk?', 'Only a Mendix project folder you explicitly pick, and only in the browser tab — the .mpr file and its BSON documents are parsed client-side, in a Web Worker (see “Reading a Mendix project folder” above). The MxScout server process never sees that folder or any file in it.'],
          ['Is any of it tested?', 'Yes \u2014 an automated suite runs before every commit, needing no dependencies either: Node\u2019s standard library and the Chromium already on the machine, nothing else. It covers the environment guard (including that its two copies still agree), the whole bridge in a real browser, the encrypted package and every way it must refuse, and the round trip of sending a review out and importing it back. It ships with the app, in test/, and runs with npm test \u2014 so this answer can be checked rather than taken on trust. Nothing reaches this branch without passing it first.'],
          ['What happens when it is closed?', 'The process exits and its memory goes with it. Projects stay in the browser’s own database until the user deletes them or clears site data.'],
          ['Does it change anything on the machine?', 'No. It installs nothing, registers nothing and writes no files.']
        ] }
      ] }
    ];
  }

  function block(b) {
    if (b.p) return el('p', { class: 'about-p', text: b.p });
    if (b.note) return el('p', { class: 'about-note', text: b.note });
    if (b.ul) {
      return el('ul', { class: 'about-ul' }, b.ul.map(function (item) {
        return el('li', { text: item });
      }));
    }
    if (b.kv) {
      return el('div', { class: 'about-kv' }, b.kv.map(function (pair) {
        return el('div', { class: 'about-kv-row' }, [
          el('div', { class: 'about-kv-key', text: pair[0] }),
          el('div', { class: 'about-kv-val', text: pair[1] })
        ]);
      }));
    }
    return null;
  }

  function render(version) {
    var sections = doc(version);

    var toc = el('nav', { class: 'about-toc' }, sections.map(function (section) {
      return el('a', { class: 'about-toc-link', href: '#about-' + section.id, text: section.title });
    }));

    var rendered = sections.map(function (section) {
      return el('section', { class: 'about-section', id: 'about-' + section.id }, [
        el('h3', { class: 'about-h', text: section.title })
      ].concat(section.blocks.map(block).filter(Boolean)));
    });

    return el('div', { class: 'about' }, [
      el('div', { class: 'about-head' }, [
        el('div', {}, [
          el('h2', { class: 'about-title', text: 'How MxScout works, and what it touches' }),
          el('p', { class: 'muted', text: 'Written for a security review. Every claim here is checkable in the source that ships with the tool.' })
        ]),
        // A reviewer usually wants this as an attachment, and printing to PDF
        // is the one way to produce that without MxScout gaining the ability
        // to write files or send anything anywhere.
        el('button', {
          class: 'btn btn-sm about-print', text: 'Print / save as PDF',
          onclick: function () { window.print(); }
        })
      ]),
      toc
    ].concat(rendered));
  }

  window.MxAbout = { init: init, doc: doc, block: block, render: render };
})();
