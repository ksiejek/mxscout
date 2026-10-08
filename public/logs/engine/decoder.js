/* MxScout — Log analysis module.
 *
 * The Mendix Error Decoder ruleset: decodes the mechanism behind a Mendix, Java or PostgreSQL error.
 *
 * Derived from MxDevSwissTool by Mikołaj (RealMecowhy),
 * https://github.com/RealMecowhy/MxDevSwissTool — MIT License, Copyright (c) 2026 Mikołaj.
 * Source: public/js/tools/error-decoder.js (everything above the "UI" banner, plus edxMapTables)
 * The logic is carried over unchanged, so MxScout reads every log the way the original does;
 * only the packaging differs (no DOM, no network, no build step).
 * The licence text is in THIRD-PARTY-NOTICES.md at the root of this repository.
 */

// MENDIX ERROR DECODER (wave 5)
// ============================================================
// Decodes the *mechanism* behind a Mendix/Java/PostgreSQL error message or
// stack trace. Owner contract (18.07.2026): this is a decoder, NOT a fix
// advisor. For every matched pattern the card carries three sections:
//   1. "What happened technically" — certain, follows directly from the message.
//   2. "Typical causes"            — an explicit list of hypotheses.
//   3. "How to check which"        — a diagnostic checklist, cross-referencing
//                                    the Log Query Extractor / JVM Health / Tracer.
// The matched pattern is always shown so the reader judges the fit themselves.
// No imperative "do X" fixes. No match ⇒ no card, never a "probably it's…" guess
// (data-driven rule). The ruleset is intentionally high-confidence: each rule
// keys off a signature that Mendix/Postgres/the JVM emit verbatim.
//
// edxDecode(text) is a pure function attached to window/self so it can be unit
// tested in Node exactly like the MFT/LQE/WSRE extractors.

(function (root) {
  'use strict';

  // Escapes a captured, attacker-controlled value before it is woven into a
  // card's trusted HTML. Most rules interpolate their capture (a Postgres
  // constraint/column identifier) directly, which is safe; a 404's requested
  // file path, however, comes straight from a remote request a scanner fully
  // controls, so it must be escaped. Kept inside this pure section so Node tests
  // never depend on the DOM helpers further down.
  function edxHtmlEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Each rule: a signature (regexes, first match wins), a specificity used to
  // rank overlapping matches (specific DB/JVM signatures outrank a generic NPE),
  // and the three card sections. `mechanism`/`causes`/`checks` receive the
  // RegExp match array so a captured constraint/column name can be woven in.
  // A check may name a `tool` (a tool id) — the UI turns that into an "Open" link.
  const EDX_RULES = [
    // ── Database — PostgreSQL constraint & lock signatures ──────────────────
    {
      id: 'pg-unique-violation',
      title: 'Unique constraint violation',
      category: 'Database',
      specificity: 90,
      patterns: [
        /duplicate key value violates unique constraint "([^"]+)"/i,
        /violates unique constraint "([^"]+)"/i,
        /ERROR:\s*duplicate key value/i
      ],
      mechanism: function (m) {
        const c = m[1] ? ' (<code>' + m[1] + '</code>)' : '';
        return 'PostgreSQL rejected an <code>INSERT</code> or <code>UPDATE</code> because a value would duplicate one already present in a column protected by a UNIQUE index/constraint' + c + '. The database enforced this — the row was never committed, and Mendix surfaced the driver error as a runtime exception.';
      },
      causes: function () {
        return [
          'Two microflows (or a scheduled event and a user action) created the same logical record at nearly the same time — a race with no locking around the "check then insert" step.',
          'A retried operation (TaskQueue retry, user double-submit, replayed REST call) re-inserted a record that the first attempt already committed.',
          'An import/sync loaded a key that already exists, or the uniqueness assumption in the domain model does not match the source data.',
          'A Mendix "unique" validation rule is missing, so the collision is only caught at the database level instead of being handled in the microflow.'
        ];
      },
      checks: function (m) {
        return [
          { text: 'Identify the entity/attribute behind the index name' + (m[1] ? ' <code>' + m[1] + '</code>' : '') + ' (Mendix names indexes after the table and columns) to know which value collided.' },
          { text: 'Look for two commits with the same key around this timestamp — the SQL that ran in the same window shows the competing INSERTs.', tool: 'log-query-extractor' },
          { text: 'Check whether the calling microflow was fired twice (retry / double request) around this time.', tool: 'microflow-tracer' }
        ];
      }
    },
    {
      id: 'pg-notnull-violation',
      title: 'Not-null constraint violation',
      category: 'Database',
      specificity: 85,
      patterns: [/null value in column "([^"]+)"[^]*?violates not-null constraint/i, /violates not-null constraint/i],
      mechanism: function (m) {
        const c = m[1] ? ' <code>' + m[1] + '</code>' : '';
        return 'PostgreSQL rejected a write because column' + c + ' received <code>NULL</code>, but the column is defined <code>NOT NULL</code> (a Mendix attribute marked "required" or a system column). The database enforced it after the microflow committed — no Mendix validation caught it first.';
      },
      causes: function () {
        return [
          'A required attribute was never set on the object before it was committed.',
          'An association or calculated value that feeds the column resolved to empty on this path through the microflow.',
          'An object was committed with "without events", bypassing a before-commit microflow that would normally populate the value.'
        ];
      },
      checks: function (m) {
        return [
          { text: 'Map column' + (m[1] ? ' <code>' + m[1] + '</code>' : '') + ' back to its Mendix attribute and confirm it is "required".' },
          { text: 'Trace the microflow that committed this object and find the branch where the attribute stays empty.', tool: 'microflow-tracer' }
        ];
      }
    },
    {
      id: 'pg-fk-violation',
      title: 'Foreign key constraint violation',
      category: 'Database',
      specificity: 85,
      patterns: [/violates foreign key constraint "([^"]+)"/i, /violates foreign key constraint/i],
      mechanism: function (m) {
        const c = m[1] ? ' (<code>' + m[1] + '</code>)' : '';
        return 'PostgreSQL rejected the write because it would leave an association pointing at a row that does not exist' + c + '. Mendix associations are backed by foreign keys; the referenced object was missing (never committed, or deleted) at the moment of the write.';
      },
      causes: function () {
        return [
          'The associated object was deleted (or rolled back) while another object still referenced it.',
          'Objects were committed in the wrong order — the child before the parent it points to.',
          'A concurrent transaction removed the parent between the reference being set and this commit.'
        ];
      },
      checks: function () {
        return [
          { text: 'Identify the two entities joined by this constraint and which side was written here.' },
          { text: 'Look for a DELETE on the referenced entity just before this error in the same time window.', tool: 'log-query-extractor' }
        ];
      }
    },
    {
      id: 'pg-deadlock',
      title: 'Database deadlock',
      category: 'Database',
      specificity: 88,
      patterns: [/deadlock detected/i, /Process \d+ waits for .*Lock/i],
      mechanism: function () {
        return 'PostgreSQL detected two (or more) transactions each holding a lock the other needs, so it aborted one of them to break the cycle. The aborted transaction is the one that raised this error; the other proceeded. This is the database resolving a circular wait, not data corruption.';
      },
      causes: function () {
        return [
          'Two microflows updated the same set of objects in the opposite order, so each locked a row the other already held.',
          'A long-running transaction held locks while a second transaction touched the same rows.',
          'Bulk updates over overlapping object sets ran concurrently (parallel scheduled events, a batch plus live traffic).'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the "Process … waits for …" detail in the log — it names both processes and the locked relations.' },
          { text: 'Find the two transactions active at this timestamp and the objects each was writing.', tool: 'log-query-extractor' },
          { text: 'Check whether two microflows write the same entities in a different order.', tool: 'microflow-tracer' }
        ];
      }
    },
    {
      id: 'pg-statement-timeout',
      title: 'Query cancelled — statement timeout',
      category: 'Database',
      specificity: 82,
      patterns: [/canceling statement due to statement timeout/i, /canceling statement due to user request/i, /query.*cancell?ed/i],
      mechanism: function () {
        return 'PostgreSQL cancelled a query because it ran longer than the configured <code>statement_timeout</code> (or was cancelled by request). The database stopped the work and returned an error rather than letting it run indefinitely — the query itself did not "fail", it was interrupted.';
      },
      causes: function () {
        return [
          'A retrieve with no supporting index scanned a large table (sequential scan).',
          'An XPath/OQL constraint that the optimizer could not push down (function on a column, leading wildcard, OR across attributes).',
          'The table grew past the point where a previously fast query stays under the timeout.',
          'Lock contention made the statement wait, and the wait counted against the timeout.'
        ];
      },
      checks: function () {
        return [
          { text: 'Find this exact query and its duration, then inspect its plan for a Seq Scan or a missing index.', tool: 'log-query-extractor' },
          { text: 'Compare the row count / cost against faster runs of the same query signature.', tool: 'log-query-extractor' }
        ];
      }
    },
    {
      id: 'pg-too-many-clients',
      title: 'Postgres connection limit reached (server-side)',
      category: 'Database',
      specificity: 87,
      patterns: [/FATAL:\s*sorry, too many clients already/i, /remaining connection slots are reserved/i],
      mechanism: function () {
        return 'PostgreSQL itself refused the new connection because the server-wide <code>max_connections</code> ceiling was already reached — this is the database\'s own limit, not the application\'s connection pool. Every application (and every runtime instance) sharing this database competes for the same ceiling.';
      },
      causes: function () {
        return [
          'Several app instances (horizontal scaling) each hold their own pool, and the sum exceeds the server\'s max_connections.',
          'A connection leak in one app slowly consumes slots that are never returned.',
          'max_connections on the server is sized for a single small app, not the current deployment.'
        ];
      },
      checks: function () {
        return [
          { text: 'Check how many connections this app\'s pool is configured for versus how many other apps/instances share the same database server.' },
          { text: 'Look for a steady climb in open connections rather than a sudden spike — that points to a leak.', tool: 'thread-dump' }
        ];
      }
    },
    {
      id: 'pg-transaction-aborted',
      title: 'Current transaction is aborted (Postgres)',
      category: 'Database',
      specificity: 83,
      patterns: [/current transaction is aborted, commands ignored until end of transaction block/i],
      mechanism: function () {
        return 'An earlier statement inside this transaction failed, and PostgreSQL will not run any further statements until the whole transaction is rolled back — this error is reported by the *next* statement, not the one that actually broke. The real failure is further up in the same transaction/log window.';
      },
      causes: function () {
        return [
          'A constraint violation or type error earlier in the same commit was not handled, so the transaction stayed open and broken.',
          'A microflow continued running database actions after an unhandled error instead of stopping.',
          'A custom Java action caught an SQL exception but kept using the same (now-poisoned) transaction.'
        ];
      },
      checks: function () {
        return [
          { text: 'Scan backwards in this transaction/connection for the first real error — that one is the actual cause.', tool: 'log-query-extractor' },
          { text: 'Trace the microflow to see whether it kept executing after an earlier activity failed.', tool: 'microflow-tracer' }
        ];
      }
    },
    {
      id: 'pg-value-too-long',
      title: 'Value too long for column type (Postgres)',
      category: 'Database',
      specificity: 84,
      patterns: [/value too long for type character varying(?:\((\d+)\))?/i],
      mechanism: function (m) {
        const n = m[1] ? ' (limit ' + m[1] + ' characters)' : '';
        return 'PostgreSQL rejected the write because a string value is longer than the column\'s <code>character varying(n)</code> limit' + n + '. The Mendix attribute\'s configured length does not match what was actually written to the database column.';
      },
      causes: function () {
        return [
          'An attribute\'s "Length" was reduced in the domain model after data longer than the new limit already existed or kept being generated.',
          'Imported/integrated data (REST, import mapping, integration) is longer than the target attribute allows.',
          'String concatenation (e.g. building a description) produced a longer value than the attribute was sized for.'
        ];
      },
      checks: function () {
        return [
          { text: 'Identify the entity/attribute behind this column and compare its configured Length to the value that was written.' },
          { text: 'Find the exact INSERT/UPDATE and its parameter values around this timestamp.', tool: 'log-query-extractor' }
        ];
      }
    },
    {
      id: 'pg-out-of-shared-memory',
      title: 'Out of shared memory / lock table full (Postgres)',
      category: 'Database',
      specificity: 86,
      patterns: [/out of shared memory/i, /You might need to increase max_locks_per_transaction/i],
      mechanism: function () {
        return 'PostgreSQL ran out of space in its shared lock table — every row/table lock a transaction holds uses a slot sized by <code>max_locks_per_transaction × max_connections</code>, and this transaction needed more than were available. The transaction is aborted; this is a server-configuration ceiling, not a query bug by itself.';
      },
      causes: function () {
        return [
          'A single transaction touched (locked) an unusually large number of distinct rows/tables in one commit.',
          'A bulk operation (mass update/delete, large import) ran without batching.',
          'max_locks_per_transaction is sized for typical transactions, not this bulk one.'
        ];
      },
      checks: function () {
        return [
          { text: 'Find the transaction and count how many distinct tables/rows it touched.', tool: 'log-query-extractor' },
          { text: 'Check whether this coincides with a bulk import or mass microflow action.', tool: 'microflow-tracer' }
        ];
      }
    },
    {
      id: 'pg-disk-full',
      title: 'Database disk full',
      category: 'Database',
      specificity: 90,
      patterns: [/could not extend file .* No space left on device/i, /No space left on device/i, /could not write to file .*: No space left/i],
      mechanism: function () {
        return 'PostgreSQL tried to write to disk (extend a table/index file, write WAL) and the filesystem had no free space left. Writes fail outright at this point — this is an infrastructure condition, not something the query or microflow logic caused.';
      },
      causes: function () {
        return [
          'The data volume genuinely filled up (growth, large import, unbounded logging/WAL retention).',
          'Autovacuum/old WAL was not cleaned up, so bloat consumed the available space.',
          'A disk sized for a smaller dataset was never grown as the app scaled.'
        ];
      },
      checks: function () {
        return [
          { text: 'Check the database host/volume free space directly — this is an infrastructure check, not a log one.' },
          { text: 'Look for an unusually large import/bulk write just before this error.', tool: 'log-query-extractor' }
        ];
      }
    },
    {
      id: 'mendix-concurrent-modification',
      title: 'Optimistic lock conflict (object changed by someone else)',
      category: 'Database',
      specificity: 85,
      patterns: [/com\.mendix\.systemwideinterfaces\.connectionbus\.data\.ConcurrentModificationRuntimeException/i],
      mechanism: function () {
        return 'Mendix stamps every object with a hidden <code>MxObjectVersion</code>, and compares it on every commit/delete. This object\'s version no longer matched what is in the database — someone else committed (or deleted) it after this process retrieved its copy — so the runtime blocked the write instead of silently overwriting the other change. This is Mendix\'s built-in optimistic locking doing its job, not a database error.';
      },
      causes: function () {
        return [
          'Two users (or a user and a scheduled event) opened and edited the same object at the same time; the second commit lost the race.',
          'A long-running microflow held a retrieved object while something else changed or deleted it in the meantime.',
          'A retry re-submitted a commit for an object that a previous, successful attempt already changed.'
        ];
      },
      checks: function () {
        return [
          { text: 'Find the other commit/delete of the same object right before this error — that is the "someone else".', tool: 'log-query-extractor' },
          { text: 'Trace how long this microflow held the object between retrieve and commit.', tool: 'microflow-tracer' }
        ];
      }
    },
    {
      id: 'db-pool-exhausted',
      title: 'Database connection pool exhausted',
      category: 'Database',
      specificity: 84,
      patterns: [
        /Cannot get a connection, pool (?:error|exhausted)/i,
        /Timeout waiting for idle (?:object|connection)/i,
        /connection is not available, request timed out after/i,
        /connection pool.*(?:exhausted|timeout)/i
      ],
      mechanism: function () {
        return 'A thread asked the connection pool for a database connection, every connection was already checked out, and the thread waited past the pool\'s max-wait before giving up. The pool protected the database from unbounded connections — the shortage is on the application side, not a database outage.';
      },
      causes: function () {
        return [
          'A spike in concurrent requests or scheduled events needed more connections than the pool size.',
          'Long-running queries held their connections for a long time, starving other threads.',
          'A connection leak — a transaction/connection was not released — steadily drained the pool.',
          'The pool is sized smaller than the real concurrency the app sees at peak.'
        ];
      },
      checks: function () {
        return [
          { text: 'Look at query durations in this window — a cluster of slow queries explains held connections.', tool: 'log-query-extractor' },
          { text: 'Check the thread state at this moment for many threads blocked waiting on the pool.', tool: 'thread-dump' }
        ];
      }
    },
    {
      id: 'mendix-nonexistent-object',
      title: 'Retrieve of a non-existent object',
      category: 'Database',
      specificity: 80,
      patterns: [
        /(?:Trying to )?retrieve (?:a )?nonexistent object/i,
        /Object with (?:id|guid) '?[\w$.-]+'? (?:does not exist|no longer exists|could not be found)/i,
        /nonexistent object with id/i
      ],
      mechanism: function () {
        return 'Mendix tried to load an object by its id, but no row with that id exists anymore. The reference (a variable, a page context, a queued id) outlived the object it pointed to. The runtime reported the miss rather than returning a phantom object.';
      },
      causes: function () {
        return [
          'The object was deleted (by another user, a scheduled event, or delete-behavior on an association) while this reference was still held.',
          'A stale page/client sent back an id for an object that has since been removed.',
          'A background task stored an object id and processed it later, after the object was gone.'
        ];
      },
      checks: function () {
        return [
          { text: 'Look for a DELETE of that object id shortly before this retrieve in the same window.', tool: 'log-query-extractor' },
          { text: 'Trace the microflow to see where the now-missing reference originated.', tool: 'microflow-tracer' }
        ];
      }
    },

    // ── JVM — memory & thread exhaustion ────────────────────────────────────
    {
      id: 'oom-heap',
      title: 'Out of memory — Java heap space',
      category: 'JVM / Memory',
      specificity: 92,
      patterns: [/OutOfMemoryError:\s*Java heap space/i],
      mechanism: function () {
        return 'The JVM could not allocate an object because the heap (bounded by <code>-Xmx</code>) was full and garbage collection could not reclaim enough space. Once this is thrown the JVM is in a degraded state — threads may die and the runtime often needs a restart to recover cleanly.';
      },
      causes: function () {
        return [
          'A retrieve pulled a very large object set into memory at once (missing amount/offset paging, an unbounded list).',
          'A genuine leak — objects held in a static/singleton or a growing cache — climbs over time until the heap fills.',
          'A large file/import processed fully in memory instead of streaming.',
          'The heap is simply undersized for the workload and peak concurrency.'
        ];
      },
      checks: function () {
        return [
          { text: 'Inspect the heap histogram to see which class dominates the live set.', tool: 'thread-dump' },
          { text: 'Look for a large retrieve (high row count) in this window that matches the growth.', tool: 'log-query-extractor' },
          { text: 'Decide leak vs. spike: a steady climb across restarts points to a leak; a single burst points to one operation.' }
        ];
      }
    },
    {
      id: 'oom-metaspace',
      title: 'Out of memory — Metaspace',
      category: 'JVM / Memory',
      specificity: 92,
      patterns: [/OutOfMemoryError:\s*Metaspace/i, /OutOfMemoryError:\s*(?:Compressed )?Class space/i],
      mechanism: function () {
        return 'The JVM exhausted Metaspace — the native memory region that holds class metadata (not the object heap). This fills from the number of loaded classes, not from data volume, so it usually reflects class loading rather than a data spike.';
      },
      causes: function () {
        return [
          'A classloader leak: repeated redeploys/hot-reloads, or a library that generates and loads classes at runtime, accumulate class metadata.',
          'Heavy use of dynamic proxies / bytecode generation (some serialization, scripting or ORM paths).',
          'Metaspace is capped (<code>-XX:MaxMetaspaceSize</code>) below what the loaded class set needs.'
        ];
      },
      checks: function () {
        return [
          { text: 'Check whether the error follows redeploys/restarts rather than traffic peaks.' },
          { text: 'Review loaded-class growth over the app\'s lifetime in the JVM metrics.', tool: 'thread-dump' }
        ];
      }
    },
    {
      id: 'oom-gc-overhead',
      title: 'Out of memory — GC overhead limit',
      category: 'JVM / Memory',
      specificity: 90,
      patterns: [/OutOfMemoryError:\s*GC overhead limit exceeded/i],
      mechanism: function () {
        return 'The JVM spent almost all recent time in garbage collection while reclaiming almost no memory, and gave up. It is the early-warning form of heap exhaustion: the heap is nearly full and GC is thrashing rather than the app running out in a single allocation.';
      },
      causes: function () {
        return [
          'The live object set is close to the heap ceiling, so every GC frees only a sliver.',
          'A slow leak has brought the heap to the edge over hours/days.',
          'Workload grew but <code>-Xmx</code> did not.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the GC log — long, frequent full GCs reclaiming little confirm the thrash.', tool: 'thread-dump' },
          { text: 'Treat the causes the same way as a heap-space OOM (leak vs. undersized heap).' }
        ];
      }
    },
    {
      id: 'oom-native-thread',
      title: 'Out of memory — cannot create native thread',
      category: 'JVM / Memory',
      specificity: 90,
      patterns: [/OutOfMemoryError:\s*unable to create (?:new )?native thread/i, /unable to create native thread/i],
      mechanism: function () {
        return 'The JVM asked the OS for a new thread and was refused — the process hit a thread/ulimit ceiling or ran out of native memory for thread stacks. This is native-side exhaustion, so it can fire even with heap to spare.';
      },
      causes: function () {
        return [
          'Thread count climbed unbounded — a thread pool without a ceiling, or threads that never terminate.',
          'The OS <code>ulimit -u</code> / process thread limit is lower than the app needs at peak.',
          'Many blocked threads (e.g. all waiting on a slow dependency) accumulated without completing.'
        ];
      },
      checks: function () {
        return [
          { text: 'Count threads and their states — a large blocked/waiting population points to a stuck dependency.', tool: 'thread-dump' },
          { text: 'Check whether thread count grows steadily rather than spiking once.' }
        ];
      }
    },

    {
      id: 'stack-overflow',
      title: 'Infinite recursion (StackOverflowError)',
      category: 'JVM / Runtime',
      specificity: 88,
      patterns: [/java\.lang\.StackOverflowError/i],
      mechanism: function () {
        return 'A call chain recursed until it exceeded the JVM\'s thread stack size and the JVM aborted it. Per Mendix\'s own runtime-errors guidance, this is practically always an infinite loop — a (sub)microflow, Java action or expression that calls itself (directly or through a cycle) with no terminating condition that is ever reached.';
      },
      causes: function () {
        return [
          'A microflow calls itself (or a chain of sub-microflows loops back to an ancestor) without a condition that stops the recursion.',
          'A custom Java action recurses on input that never reaches its base case.',
          'An association-graph walk (e.g. resolving a tree/hierarchy) hits a cycle that was assumed to be acyclic.'
        ];
      },
      checks: function () {
        return [
          { text: 'Trace the call chain leading up to this point — a repeating microflow name is the recursion.', tool: 'microflow-tracer' },
          { text: 'Check the data for a cyclic reference (e.g. an object indirectly referencing itself through an association).' }
        ];
      }
    },
    {
      id: 'java-concurrent-modification',
      title: 'Collection modified while iterating (ConcurrentModificationException)',
      category: 'JVM / Runtime',
      specificity: 60,
      patterns: [/java\.util\.ConcurrentModificationException/i],
      mechanism: function () {
        return 'Java code iterated over a collection (List/Set/Map) while something — the same thread or another one — added or removed an element from it, and the iterator detected the change and failed fast rather than risk returning inconsistent results. This is unrelated to Mendix\'s object-level optimistic locking; it is a plain-Java collection bug.';
      },
      causes: function () {
        return [
          'A custom Java action removes/adds to a list while iterating over it directly instead of via an Iterator\'s own remove(), or a snapshot copy.',
          'A shared, unsynchronized collection (e.g. a static cache) is read by one thread while another thread mutates it concurrently.'
        ];
      },
      checks: function () {
        return [
          { text: 'Identify the custom Java action or library call in the stack — the fix is in that code\'s iteration pattern.' },
          { text: 'Check whether this only happens under concurrent load (points to a shared unsynchronized collection).', tool: 'thread-dump' }
        ];
      }
    },
    {
      id: 'no-class-def-found',
      title: 'Missing class at runtime (NoClassDefFoundError / ClassNotFoundException)',
      category: 'JVM / Runtime',
      specificity: 75,
      patterns: [/java\.lang\.NoClassDefFoundError/i, /java\.lang\.ClassNotFoundException/i],
      mechanism: function () {
        return 'The JVM tried to load a class that was present at compile time (the code referencing it deployed successfully) but is missing from the classpath at runtime. Unlike a missing method, the whole class cannot be found at all — a dependency jar is absent, not just out of date.';
      },
      causes: function () {
        return [
          'A Marketplace module or custom Java library dependency was not included in the deployment package.',
          'A dependency was removed/renamed in an update but a leftover compiled reference to it still ships.',
          'The class is present in Studio Pro\'s userlib for local runs but was not packaged for this deployment target.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the class name in the error and locate which module/library ships it; confirm its jar is in the deployed userlib.' },
          { text: 'Check whether this started right after a deploy that added/updated/removed a Marketplace module.' }
        ];
      }
    },
    {
      id: 'no-such-method-error',
      title: 'Classpath version conflict (NoSuchMethodError / NoSuchFieldError)',
      category: 'JVM / Runtime',
      specificity: 78,
      patterns: [/java\.lang\.NoSuchMethodError/i, /java\.lang\.NoSuchFieldError/i],
      mechanism: function () {
        return 'The class needed was found on the classpath, but the specific method/field the caller expects is not on the version that actually loaded. This is the classic signature of two different versions of the same library being present at once — the compiled caller and the loaded class disagree about the API.';
      },
      causes: function () {
        return [
          'Two Marketplace modules (or a module and a custom Java action) bundle different versions of the same third-party jar.',
          'A library was upgraded in one place but a cached/old jar from a previous deploy is still on the classpath.'
        ];
      },
      checks: function () {
        return [
          { text: 'Identify the class named in the error and search the deployment\'s userlib for more than one jar providing it.' },
          { text: 'Check whether this started right after adding/upgrading a Marketplace module.' }
        ];
      }
    },
    {
      id: 'unknown-host',
      title: 'DNS lookup failed (UnknownHostException)',
      category: 'Integration',
      specificity: 76,
      patterns: [/java\.net\.UnknownHostException/i],
      mechanism: function () {
        return 'The JVM tried to resolve a hostname to an IP address via DNS and got no answer at all — this happens before any network connection is attempted, so it is purely a name-resolution failure, not a reachability or firewall issue.';
      },
      causes: function () {
        return [
          'The hostname in the integration\'s configuration is misspelled or points at an environment that does not exist (e.g. an acceptance hostname used in production).',
          'The runtime\'s DNS resolver/network (e.g. a private-cloud VPC) cannot reach the DNS server that would resolve this name.',
          'An internal hostname is only resolvable from a specific network the runtime is not running in.'
        ];
      },
      checks: function () {
        return [
          { text: 'Confirm the exact hostname configured for this integration and that it resolves from the runtime\'s network.', tool: 'ws-rest-extractor' },
          { text: 'Check whether every call to this host fails (config error) or only sometimes (DNS flakiness).' }
        ];
      }
    },

    // ── Integration — HTTP / TLS / sockets ──────────────────────────────────
    {
      id: 'jetty-eof',
      title: 'Client closed connection (Jetty EofException)',
      category: 'Integration',
      specificity: 78,
      patterns: [/org\.eclipse\.jetty\.io\.EofException/i, /Early EOF/i, /EofException/i],
      mechanism: function () {
        return 'Jetty was writing the HTTP response when the client\'s TCP connection went away, so the write hit end-of-stream. The server did its work; the receiver disconnected first. This is a symptom of the client side, not a server-side failure of the request logic.';
      },
      causes: function () {
        return [
          'The user navigated away, closed the tab, or lost connectivity before the response finished.',
          'A proxy/load balancer in front of Mendix timed out and dropped the connection while the app was still responding.',
          'The response was slow enough that the client\'s own timeout elapsed first.'
        ];
      },
      checks: function () {
        return [
          { text: 'Check whether the matching request was slow — a slow response makes client/proxy timeouts likely.', tool: 'log-query-extractor' },
          { text: 'Correlate with the proxy access log for a 499/504 at the same instant.', tool: 'nginx-log' }
        ];
      }
    },
    {
      id: 'socket-read-timeout',
      title: 'Outgoing call timed out (socket read timeout)',
      category: 'Integration',
      specificity: 82,
      patterns: [/java\.net\.SocketTimeoutException:\s*Read timed out/i, /SocketTimeoutException:\s*connect timed out/i, /Read timed out/i],
      mechanism: function () {
        return 'An outgoing HTTP/SOAP call opened its connection but the remote service did not send a (complete) response within the client\'s configured read timeout, so the socket gave up waiting. The failure is in waiting for the peer, not in your request being rejected.';
      },
      causes: function () {
        return [
          'The external service was slow or overloaded on this call.',
          'The configured client timeout is shorter than the service\'s real worst-case response time.',
          'A network hop (proxy/firewall) silently held or dropped the connection.'
        ];
      },
      checks: function () {
        return [
          { text: 'Find this call and its timing — the request/response gap and the configured timeout are shown side by side.', tool: 'ws-rest-extractor' },
          { text: 'Check whether the same endpoint times out repeatedly or just once.', tool: 'ws-rest-extractor' }
        ];
      }
    },
    {
      id: 'ssl-pkix',
      title: 'TLS trust failure (PKIX path building failed)',
      category: 'Integration',
      specificity: 86,
      patterns: [/PKIX path building failed/i, /unable to find valid certification path to requested target/i, /SSLHandshakeException/i],
      mechanism: function () {
        return 'During the TLS handshake the JVM could not build a trust chain from the server\'s certificate to a CA in its truststore, so it aborted the connection before any request was sent. This is certificate trust, not authentication or authorization — the two sides never agreed on TLS.';
      },
      causes: function () {
        return [
          'The server presents a certificate signed by a CA (or an internal/self-signed CA) that is not in the JVM truststore.',
          'The server did not send the full intermediate chain, so the JVM cannot reach a trusted root.',
          'The endpoint URL / hostname does not match the certificate, or a TLS-terminating proxy swapped the certificate.'
        ];
      },
      checks: function () {
        return [
          { text: 'Inspect the certificate chain the endpoint actually presents and compare it to the JVM truststore contents.' },
          { text: 'Confirm which host failed — the outgoing call record names the endpoint.', tool: 'ws-rest-extractor' }
        ];
      }
    },
    {
      id: 'connection-refused',
      title: 'Connection refused',
      category: 'Integration',
      specificity: 80,
      patterns: [/java\.net\.ConnectException:\s*Connection refused/i, /Connection refused(?:\s*\(Connection refused\))?/i],
      mechanism: function () {
        return 'A TCP connection attempt was actively refused: something answered at that address but nothing was listening on the target port (or a firewall sent a reset). The connection never opened, so no request was sent.';
      },
      causes: function () {
        return [
          'The target service is down or still starting up.',
          'The host/port in the configuration is wrong, or points at the wrong environment.',
          'A firewall / security group blocks the port from the Mendix runtime.'
        ];
      },
      checks: function () {
        return [
          { text: 'Confirm the host and port the call used, then verify the service is listening there.', tool: 'ws-rest-extractor' },
          { text: 'Check whether every call to this endpoint fails (config/network) or only some (flapping service).', tool: 'ws-rest-extractor' }
        ];
      }
    },

    // ── Authentication — SAML / SSO ─────────────────────────────────────────
    {
      id: 'saml-audience',
      title: 'SAML audience restriction mismatch',
      category: 'Authentication',
      specificity: 84,
      patterns: [/audience[^\n.]*not valid/i, /AudienceRestriction/i, /Audience .* (?:does not match|is not valid)/i, /not a valid audience/i],
      mechanism: function () {
        return 'The SAML assertion carried an <code>AudienceRestriction</code> whose value does not equal this application\'s Service Provider EntityID, so the SP refused it. The identity provider issued a token addressed to a different audience than the one validating it — a configuration mismatch, not a credential problem.';
      },
      causes: function () {
        return [
          'The SP EntityID configured in the IdP does not match the EntityID the Mendix SAML module uses.',
          'The token was issued for a different environment (acceptance vs. production) and replayed against this one.',
          'A recent change to the SP metadata / EntityID was applied on only one side.'
        ];
      },
      checks: function () {
        return [
          { text: 'Compare the Audience value in the assertion against the SP EntityID (decode the SAML response to read it).', tool: 'saml-debugger' },
          { text: 'Confirm the IdP is configured with the same EntityID for this environment.' }
        ];
      }
    },
    {
      id: 'saml-clock',
      title: 'SAML assertion validity window (clock skew)',
      category: 'Authentication',
      specificity: 84,
      patterns: [/assertion is not yet valid/i, /NotBefore/i, /NotOnOrAfter/i, /Conditions.*not (?:yet )?(?:valid|met)/i, /clock skew/i],
      mechanism: function () {
        return 'The SAML assertion\'s <code>Conditions</code> define a validity window (<code>NotBefore</code> … <code>NotOnOrAfter</code>) and the validating server\'s current time fell outside it, so the assertion was rejected. The token is well-formed; server and IdP disagree on the current time (or the token is genuinely expired).';
      },
      causes: function () {
        return [
          'The Mendix server clock and the IdP clock differ by more than the allowed skew (NTP drift on one side).',
          'Network/processing delay pushed validation past a short <code>NotOnOrAfter</code>.',
          'The configured allowed clock skew is smaller than the real difference between the systems.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the NotBefore / NotOnOrAfter values from the assertion and compare them to the server time of this log line.', tool: 'saml-debugger' },
          { text: 'Confirm NTP is in sync on the runtime host.' }
        ];
      }
    },

    // ── Platform / runtime ──────────────────────────────────────────────────
    {
      id: 'port-in-use',
      title: 'Port already in use (startup bind failure)',
      category: 'Platform',
      specificity: 80,
      patterns: [/Address already in use/i, /java\.net\.BindException/i, /Failed to bind to .*:\d+/i],
      mechanism: function () {
        return 'The runtime tried to bind a listening socket to a port that another process already holds, so the OS refused the bind and startup failed. Nothing is wrong with the app logic — two things want the same port.';
      },
      causes: function () {
        return [
          'A previous instance of the runtime did not shut down and still holds the port.',
          'Another service on the host is bound to the same port.',
          'A restart raced its own predecessor before the socket was released (TIME_WAIT).'
        ];
      },
      checks: function () {
        return [
          { text: 'Identify which process owns the port on the host, and whether an old runtime instance is still alive.' },
          { text: 'Check the surrounding startup log for the port number and a prior unclean shutdown.', tool: 'log-viewer' }
        ];
      }
    },
    {
      id: 'http-404-file-not-found',
      title: 'Static file not found (404) — usually a scanner probe',
      category: 'Platform',
      specificity: 72,
      // Verbatim Mendix runtime signature: `Connector: 404 - file not found for
      // file: <path>`. The path is captured so the card can name it; the second
      // pattern is a loose fallback if the `404 - ` prefix is ever absent.
      patterns: [
        /404 - file not found for file:\s*(\S+)/i,
        /file not found for file:\s*(\S+)/i
      ],
      mechanism: function (m) {
        let name = m[1] || '';
        try { name = decodeURIComponent(name); } catch (e) { /* malformed %-encoding: keep raw */ }
        const f = name ? ' (<code>' + edxHtmlEscape(name) + '</code>)' : '';
        return 'The Mendix runtime\'s request handler (the <code>Connector</code>) received a request for a static file' + f + ' that does not exist in the deployed application, so it returned HTTP 404. The request never reached a microflow or the database — nothing in the running app failed. The runtime logs this at ERROR level, but a 404 for a missing file is the web server correctly reporting an unknown path.';
      },
      causes: function (m) {
        let name = m[1] || '';
        try { name = decodeURIComponent(name); } catch (e) { /* keep raw */ }
        const isProbe = /magento|composer\.json|wp-|wordpress|xmlrpc|phpmyadmin|\.env|\.git|index\.php|\.php(?:$|\?)|\.aspx|boaform|hnap|autodiscover|lander/i.test(name);
        return [
          'An automated vulnerability/fingerprint scanner probing for well-known files of software you do not run — Magento (<code>magento_version</code>, <code>composer.json</code>), WordPress (<code>wp-*</code>), phpMyAdmin, <code>.env</code>, <code>.git</code>. These requests sweep every public host on the internet; they are background noise, not a fault in your app.' + (isProbe ? ' <strong>The name requested here is a classic probe target.</strong>' : ''),
          'A broken reference to one of your own static resources (image, CSS, JS, theme file) that was renamed, moved, or never included in the deployment package.',
          'A stale client or bookmark requesting a path that existed in an earlier version of the app.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the requested file name: names like <code>magento_version</code>, <code>wp-login.php</code>, <code>.env</code> or <code>.git</code> are probes for software you do not run — safe to ignore beyond filtering the noise (or blocking the source at the proxy).' },
          { text: 'If it is genuinely one of your own resources, confirm the file ships in the deployment package (the module or <code>theme/</code> folder that should contain it).' },
          { text: 'Correlate the client IP and the paths it requested in the reverse-proxy access log — a spread of unrelated probe paths from one source confirms a scanner sweep.', tool: 'nginx-log' }
        ];
      }
    },
    {
      id: 'http-404-rest-no-operation',
      title: 'Published REST service — no matching operation (404)',
      category: 'Platform',
      specificity: 70,
      // Verbatim Mendix runtime signature from the REST-publish layer; the
      // requested URL is captured so the card can name it.
      patterns: [
        /Responding with 404 Not Found, because no operation matches\s*(\S+)/i,
        /REST Publish:[^\n]*no operation matches\s*(\S+)/i
      ],
      mechanism: function (m) {
        let url = m[1] || '';
        try { url = decodeURIComponent(url); } catch (e) { /* keep raw */ }
        const u = url ? ' (<code>' + edxHtmlEscape(url) + '</code>)' : '';
        return 'A request reached the app\'s <em>published</em> REST layer, but its path, HTTP method or version matched no operation in any published REST service' + u + ', so the runtime returned HTTP 404 without invoking a microflow — the request never reached your logic. The runtime logs this at DEBUG level: a mismatched path is not treated as an application error. (This is an <em>incoming</em> call to your app, not an outgoing one.)';
      },
      causes: function (m) {
        let url = m[1] || '';
        try { url = decodeURIComponent(url); } catch (e) { /* keep raw */ }
        const isProbe = /wp-json|magento|rest\/default\/v\d|graphql|\/V1\/guest-carts/i.test(url);
        return [
          'A scanner/bot probing for well-known REST APIs of software you do not run — e.g. Magento (<code>/rest/default/V1/…</code>) or WordPress (<code>/wp-json/…</code>). It sweeps every public host; noise, not a fault in your app.' + (isProbe ? ' <strong>The path requested here is a classic probe target.</strong>' : ''),
          'A legitimate client calling a published operation with the wrong path, HTTP method or version — a trailing slash, a GET where POST is defined, or a stale version segment all yield "no operation matches".',
          'The published REST service that should serve this path is not deployed or not enabled in this environment.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the URL in the message: a path like <code>/rest/default/V1/…</code> (Magento) or <code>/wp-json/…</code> (WordPress) is a probe for an API you do not publish — safe to ignore.' },
          { text: 'If it is your own API, compare the caller\'s exact path, method and version against the published service\'s operation definitions in Studio Pro.' },
          { text: 'Correlate the client IP and requested paths in the reverse-proxy access log to tell a scanner sweep from one misconfigured client.', tool: 'nginx-log' }
        ];
      }
    },
    // ── Mendix platform — signatures mined from real production logs ────────
    // Everything below was taken from 15 169 real ERROR/CRITICAL records across
    // five production logs (Mendix Cloud + on-premises), not from documentation:
    // before this block the decoder recognised 10% of that volume, and the four
    // rules that fired were mostly scanner 404s. These are the signatures that
    // actually dominate a running application's log.
    //
    // Two shapes to keep in mind when reading them: the Cloud log frequently
    // carries the wrapper line *without* a stack trace (the exception class ends
    // up alone on the next line), and the runtime's outermost handlers are
    // deliberately generic — so several of these rules decode "which layer
    // failed and where the real cause is", which is what the message honestly
    // supports, rather than inventing a root cause.
    {
      id: 'mx-request-handler-error',
      title: 'Runtime returned a generic error to the client',
      category: 'Platform',
      // The outermost wrapper: it must never outrank the root cause when both
      // are present, but it is worth decoding because in Cloud logs it very
      // often arrives alone.
      specificity: 30,
      patterns: [
        /An error has occurred while handling the request\.\s*\[User '([^']*)'[^\]]*\]/i,
        /An error has occurred while handling the request/i
      ],
      mechanism: function (m) {
        const who = m[1] ? ' The bracketed part names who hit it: user <code>' + edxHtmlEscape(m[1]) + '</code>, with their session id and roles.' : '';
        return 'A request from the client (a page action, a microflow call from the browser, a data retrieve) threw, and the runtime caught it at its outermost handler, logged this line on the <code>Connector</code> node and returned a generic message to the browser. This line is the <em>wrapper</em>: it states that something failed while serving a user, not what failed.' + who;
      },
      causes: function () {
        return [
          'A microflow behind the action threw — the real mechanism is in the lines below this one (<code>MicroflowException</code>, then a "Caused by").',
          'A security/consistency check rejected the operation (access rules, a deleted or changed object).',
          'The stack is absent because the environment logs at INFO: the runtime writes the wrapper regardless, the detail only appears at DEBUG/TRACE for the relevant log node.'
        ];
      },
      checks: function (m) {
        const checks = [
          { text: 'Open this record in the Log Viewer and read the lines directly beneath it — the wrapper is followed by the microflow chain and the root cause when the log level allows it.', tool: 'log-viewer' }
        ];
        if (m[1]) {
          checks.push({ text: 'The session id in the brackets identifies this one request: filter the log by it to see everything that happened under it.', tool: 'log-viewer' });
        }
        checks.push({ text: 'If only the wrapper is logged, raise the log node that owns the failing feature to DEBUG/TRACE and reproduce — the detail is not stored anywhere else after the fact.' });
        checks.push({ text: 'Correlate with the SQL that ran in the same window, which often shows the failing statement even when the stack is missing.', tool: 'log-query-extractor' });
        return checks;
      }
    },
    {
      id: 'mx-rest-publish-failed',
      title: 'Published REST service failed while handling a request',
      category: 'Integration',
      specificity: 60,
      patterns: [/An unexpected error occurred while handling REST request/i],
      mechanism: function () {
        return 'A request reached one of your <em>published</em> REST operations, the microflow behind it threw, and the runtime answered the caller with HTTP 500 while logging this line on the <code>REST Publish</code> node. Unlike a 404 "no operation matches", the routing worked — your logic ran and failed. (This is an <em>incoming</em> call to your app.)';
      },
      causes: function () {
        return [
          'The microflow behind the operation threw — most often a null reference on data the caller did not send, or a failed retrieve of a referenced record.',
          'The request body did not deserialize into the expected structure, so the mapping produced empty values the microflow then used.',
          'A downstream dependency the operation calls (database, another service) failed inside the operation.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the line immediately below this one: in Mendix Cloud logs the stack is frequently reduced to the exception class alone (e.g. <code>java.lang.NullPointerException: null</code>), which tells you the kind of failure but not the location.' },
          { text: 'Raise <code>REST Publish</code> to TRACE and reproduce — that logs the incoming request with its headers and body, which is what identifies the caller and the payload that triggers it.' },
          { text: 'Pair the failing request with its response and timing to see whether one caller or one payload shape is responsible.', tool: 'ws-rest-extractor' },
          { text: 'Trace the microflow behind the operation to the activity that threw.', tool: 'microflow-tracer' }
        ];
      }
    },
    {
      id: 'mx-ws-publish-failed',
      title: 'Published web service failed while handling a request',
      category: 'Integration',
      specificity: 60,
      patterns: [
        /An error occurred processing the webservice request/i,
        /Exception occurred while processing webservice request/i
      ],
      mechanism: function () {
        return 'An incoming SOAP request reached a <em>published</em> web service and failed while being processed, so the runtime returned a SOAP fault to the caller and logged this on the <code>WebServices</code> node. The request was routed correctly — the failure is inside processing, not in the address.';
      },
      causes: function () {
        return [
          'The microflow behind the operation threw while handling the request.',
          'The request could not be mapped onto the operation\'s contract (a missing or malformed element), so the failure happens before your logic sees usable data.',
          'The caller sent a request built against an older version of the published contract.'
        ];
      },
      checks: function () {
        return [
          { text: 'Look for a "Couldn\'t handle input parameters" line around the same timestamp — that distinguishes a contract/mapping failure from a microflow failure.' },
          { text: 'Raise <code>WebServices</code> to TRACE and reproduce to capture the incoming envelope; the payload is what tells a bad caller from a bad contract.' },
          { text: 'Inspect the paired request and response, including the SOAP fault sent back.', tool: 'ws-rest-extractor' }
        ];
      }
    },
    {
      id: 'mx-ws-input-parameters',
      title: 'Published web service — request did not fit the contract',
      category: 'Integration',
      specificity: 65,
      patterns: [/Couldn't handle input parameters/i],
      mechanism: function () {
        return 'The runtime could not map the incoming SOAP request\'s parameters onto the published operation\'s contract, so processing stopped before the microflow ran. Nothing in your logic executed — this is a mismatch between what the caller sent and what the published WSDL declares.';
      },
      causes: function () {
        return [
          'A required element is missing, empty, or nested differently from the published contract.',
          'A value does not fit its declared type (a date, a decimal, an enumeration member the contract does not define).',
          'The caller was built against an older version of the WSDL, or a namespace changed on redeploy.'
        ];
      },
      checks: function () {
        return [
          { text: 'Capture the incoming envelope (raise <code>WebServices</code> to TRACE) and compare it element by element against the published WSDL — the first mismatch is the answer.' },
          { text: 'Check whether every caller fails or only one: one failing client points at a stale contract on their side, all callers failing points at a redeploy on yours.', tool: 'ws-rest-extractor' },
          { text: 'Validate the envelope\'s structure and character content if it arrives from a third party — invisible control characters break parsing.', tool: 'char-sanitizer' }
        ];
      }
    },
    {
      id: 'mx-taskqueue-failed',
      title: 'Background task failed in a task queue',
      category: 'Platform',
      specificity: 70,
      patterns: [/Failed to execute task '([^'(]+)[^']*'(?:\s*from task queue '([^']+)')?/i],
      mechanism: function (m) {
        const task = m[1] ? '<code>' + edxHtmlEscape(m[1].trim()) + '</code>' : 'a task';
        const queue = m[2] ? ' in queue <code>' + edxHtmlEscape(m[2]) + '</code>' : '';
        return 'The task queue picked up ' + task + queue + ', ran it, and the microflow behind it threw. The runtime logs the failure and applies the queue\'s retry policy — so one broken record can produce this line repeatedly, on a schedule, long after the original trigger.';
      },
      causes: function () {
        return [
          'One "poison" record fails every attempt — the same task retried on a fixed interval, which is why the count grows steadily rather than in bursts.',
          'The task depends on data or a downstream service that was unavailable at execution time.',
          'The task was queued with an argument referring to an object that has since been deleted or changed.'
        ];
      },
      checks: function (m) {
        return [
          { text: 'Count how often this exact task failed: many failures of one task is a retry loop on a single record, while many different tasks failing at once points at a shared dependency.', tool: 'log-viewer' },
          { text: 'Read the lines under this one for the wrapped cause — the task name here identifies the microflow to trace next.' + (m[1] ? ' (<code>' + edxHtmlEscape(m[1].trim()) + '</code>)' : ''), tool: 'microflow-tracer' },
          { text: 'Background work runs on its own correlation IDs; the Tracer\'s Background view aggregates runs per event so you can see whether the failures line up with a schedule.', tool: 'microflow-tracer' }
        ];
      }
    },
    {
      id: 'mx-request-state-size',
      title: 'Request state exceeded the object threshold',
      category: 'Platform',
      specificity: 80,
      patterns: [/Request state size of (\d+) objects exceeds the threshold of (\d+)/i],
      mechanism: function (m) {
        return 'A single request kept <strong>' + edxHtmlEscape(m[1]) + '</strong> objects in the session\'s request state, above the configured threshold of ' + edxHtmlEscape(m[2]) + '. The runtime is reporting memory it is holding on the user\'s behalf between requests — the request still completed; this is a warning about how much it costs.';
      },
      causes: function () {
        return [
          'A page (or a nested data view/grid) retrieved a large list of non-persistable or uncommitted objects that stay in state until the page closes.',
          'A microflow created many objects without committing or deleting them, so they remain owned by the session.',
          'A list is retrieved in full where paging would keep only a window of it in state.'
        ];
      },
      checks: function () {
        return [
          { text: 'Identify the page or microflow the request belonged to — the same request usually shows its retrieves in the SQL log within the same window.', tool: 'log-query-extractor' },
          { text: 'Check whether the count grows with data volume (a retrieve without a limit) or stays constant (a fixed but heavy page).', tool: 'log-viewer' },
          { text: 'Watch session memory over time: many requests over the threshold at once is the shape that precedes heap pressure.', tool: 'telemetry-monitor' }
        ];
      }
    },
    {
      id: 'mx-file-not-found',
      title: 'FileDocument has no file in storage',
      category: 'Platform',
      specificity: 65,
      // Distinct from `http-404-file-not-found`, which is a web request for a
      // static resource; this is the runtime failing to read a FileDocument.
      patterns: [/(?:The\s+([A-Za-z0-9_.$]+)\s+)?file could not be found\.?/i],
      mechanism: function (m) {
        const ent = m[1] ? ' (<code>' + edxHtmlEscape(m[1]) + '</code>)' : '';
        return 'The runtime tried to read the contents of a FileDocument' + ent + ' and the underlying file was not in the file storage. The database row describing the document exists — its bytes do not, so anything downloading or processing it fails.';
      },
      causes: function () {
        return [
          'The database was restored into this environment without the matching file storage — the classic result of copying production data into acceptance or a local environment.',
          'The file was never written: the upload or the microflow that should have filled the document failed after the object was created.',
          'The storage backend (mounted volume, blob container) is unavailable or was cleaned up independently of the database.'
        ];
      },
      checks: function () {
        return [
          { text: 'Check whether it is one document or many: a single one points at a failed upload, while many point at a storage/restore mismatch for the whole environment.' },
          { text: 'Confirm the environment\'s file storage was restored together with the database snapshot it is running on.' },
          { text: 'Look for the upload or generating microflow around the document\'s creation time to see whether writing the contents ever succeeded.', tool: 'microflow-tracer' }
        ];
      }
    },
    {
      id: 'mx-file-in-use',
      title: 'File cleanup blocked — files still in use',
      category: 'Platform',
      specificity: 75,
      patterns: [/Prevented deletion of one or more files that are still in use/i],
      mechanism: function () {
        return 'The runtime\'s file cleanup found storage files it was about to delete still referenced (open or claimed) and refused to remove them, listing their UUIDs. It stopped deliberately rather than deleting a file something else was holding — the failure mode this guards against is silent data loss.';
      },
      causes: function () {
        return [
          'A FileDocument was being read or written while the cleanup ran.',
          'A previous operation left a handle open (a failed download or import that did not close its stream).',
          'The same storage is shared by more than one runtime instance, so one instance sees another\'s file as in use.'
        ];
      },
      checks: function () {
        return [
          { text: 'Note whether this repeats for the same UUIDs: recurring identical ones mean a handle is never released, while changing ones mean it is a timing overlap with normal traffic.', tool: 'log-viewer' },
          { text: 'Correlate the timestamp with file upload/download activity and with any scheduled cleanup event.', tool: 'microflow-tracer' },
          { text: 'Mendix documents this message as one to report if it persists — capture the UUIDs and the surrounding log before it rotates.' }
        ];
      }
    },
    {
      id: 'saml-duplicate-response',
      title: 'SAML response rejected — request already answered',
      category: 'Authentication',
      specificity: 75,
      patterns: [/Request has already received a response/i],
      mechanism: function () {
        return 'The SAML module received an assertion answering an authentication request it had already answered. Each <code>AuthnRequest</code> may be consumed exactly once — this is replay protection working, so the login was rejected even though the assertion itself may be perfectly valid.';
      },
      causes: function () {
        return [
          'The browser replayed the identity provider\'s POST — a refresh, a back-navigation onto the assertion consumer URL, or a restored session/tab.',
          'The identity provider (or something between) delivered the same response twice.',
          'Two runtime instances behind a load balancer without sticky sessions: one consumed the request, the other saw the second delivery.',
          'A user opened the login flow in more than one tab, so a later assertion refers to a request an earlier tab already used.'
        ];
      },
      checks: function () {
        return [
          { text: 'Check whether it affects one user repeatedly (a client-side replay) or many users at once (an infrastructure or IdP behaviour).', tool: 'log-viewer' },
          { text: 'Decode the assertion to confirm it is otherwise valid — an expired or misaddressed one produces different errors than a duplicate.', tool: 'saml-debugger' },
          { text: 'On a multi-instance deployment, confirm session affinity: without it, the instance validating the response is not always the one that issued the request.' },
          { text: 'Correlate the two deliveries in the reverse-proxy access log to see whether the same assertion arrived twice.', tool: 'nginx-log' }
        ];
      }
    },
    {
      id: 'saml-empty-error',
      title: 'SAML module logged an error with no message',
      category: 'Authentication',
      // Deliberately low: this rule decodes the *absence* of information, so any
      // real signature in the same paste must rank above it.
      specificity: 15,
      patterns: [
        /SAML_SSO:\s*null\s*$/im,
        /Error occurred while making request:\s*null/i
      ],
      mechanism: function (m) {
        const outbound = /making request/i.test(m[0])
          ? ' This variant adds one thing: it failed while the module was <em>making a request</em> — the outbound leg (sending the authentication request, or fetching identity-provider metadata), not while validating a response.'
          : '';
        return 'The SAML module logged an error whose message is literally <code>null</code> — the exception it caught carried no text (typically a null reference inside the module or the library underneath it). The line records that a failure happened during a SAML exchange; by itself it identifies neither the user, the step, nor the cause.' + outbound;
      },
      causes: function () {
        return [
          'An exception with no message was thrown inside the SAML handling path — the module logs <code>e.getMessage()</code>, which is null for many runtime exceptions.',
          'The failure often accompanies a metadata, certificate or response-parsing problem that another line in the same second describes properly.',
          'On a busy environment these accumulate in large numbers precisely because each one carries no detail to distinguish it from the next.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the neighbouring lines rather than this one: SAML failures normally log a second, descriptive entry in the same second (audience, clock skew, duplicate response, metadata).', tool: 'log-viewer' },
          { text: 'Raise <code>SAML_SSO</code> to DEBUG/TRACE and reproduce a login — the module logs the request/response detail there, which is where the actual cause is.' },
          { text: 'Decode a captured assertion directly if logins are failing for users.', tool: 'saml-debugger' },
          { text: 'Count them over time: a constant background rate usually accompanies bot traffic hitting the login endpoint, while a spike lines up with a deployment or a certificate rollover.', tool: 'log-viewer' }
        ];
      }
    },
    {
      id: 'microflow-exception',
      title: 'Microflow execution failed (wrapped exception)',
      category: 'Microflow',
      specificity: 45,
      patterns: [
        /com\.mendix\.modules\.microflowengine\.MicroflowException/i,
        /Error in \(sub\)?microflow/i,
        /An error (?:has )?occurred while executing.*microflow/i
      ],
      mechanism: function () {
        return 'The microflow engine caught an exception thrown by an activity and rethrew it wrapped as a <code>MicroflowException</code>, unwinding the microflow (and any callers). The wrapper names the microflow chain; the real mechanism is in the <em>Caused by</em> further down the stack.';
      },
      causes: function () {
        return [
          'An activity inside the microflow threw — the wrapper is only the outer layer.',
          'A "Caused by" line below carries the specific failure (database, null, integration, etc.).',
          'A custom Java action or a Marketplace module raised the underlying error.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the deepest "Caused by:" in the stack — that root cause is what to decode next.' },
          { text: 'Trace this microflow to see which activity was executing when it threw.', tool: 'microflow-tracer' }
        ];
      }
    },
    {
      id: 'npe',
      title: 'Null reference (NullPointerException)',
      category: 'JVM / Runtime',
      specificity: 25,
      patterns: [/java\.lang\.NullPointerException/i],
      mechanism: function () {
        return 'Java code dereferenced a reference that was <code>null</code> — a member/method was accessed on an object that had not been set. Newer JVMs append a "Cannot invoke … because … is null" detail that names the exact null reference.';
      },
      causes: function () {
        return [
          'An object variable or association was empty on this path but the code assumed it was set.',
          'A retrieve returned nothing and the result was used without an emptiness check.',
          'A custom Java action or module received a null argument it did not guard.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the helpful NPE message (if present) — it names the reference that was null.' },
          { text: 'Trace the microflow to the activity that dereferenced it and find where the value should have been set.', tool: 'microflow-tracer' }
        ];
      }
    },
    // ── Mendix platform — second mining pass (wave 20) ──────────────────────
    // Measured, not guessed: the 43 rules above were run over 340 863 real
    // ERROR/WARNING/CRITICAL records from ten production apps (3.1 GB, 10.08–
    // 13.08.2026) and recognised 75.7% of them by volume. Grouping the 82 891
    // misses by log node showed ~58% were *platform* signatures the ruleset had
    // no rule for; the rest were custom log nodes of one app each, which are
    // deliberately left unmatched because they generalise to no other Mendix app.
    // The thirteen rules below close that platform gap (measured: 75.7% → 89.7%).
    //
    // Most of them decode a WARNING rather than an exception. That is the point:
    // these are the lines an operator scrolls past for months, and each one names
    // a concrete modelling defect. Their specificity is set below the exception
    // rules so they can never outrank a real root cause that appears alongside.
    {
      id: 'mx-autocommitted-on-logout',
      title: 'Autocommitted objects survived until logout',
      category: 'Platform',
      // 25 301 records across 5 of the 10 apps — the single largest platform gap.
      specificity: 78,
      patterns: [/Some autocommitted objects still existed on logout for session '([^']*)'/i],
      mechanism: function (m) {
        const who = m[1] ? ' The session named here is <code>' + edxHtmlEscape(m[1]) + '</code>.' : '';
        return 'Objects were created in this session and never explicitly committed, but Mendix wrote them to the database anyway because something associated with them <em>was</em> committed — that is what "autocommitted" means. They stayed in the database, owned by nothing, until the session ended; at logout the runtime deleted them again to avoid leaving corrupt rows behind. The message lists the count per entity on the lines below it.' + who;
      },
      causes: function () {
        return [
          'A microflow created an object, associated it with an object it then committed, and never committed or deleted the new object itself — the classic source of this warning.',
          'A page created an object for the user to fill in (a wizard step, a temporary selection) and the user navigated away or logged out instead of finishing.',
          'A non-persistable entity was modelled as persistable, so what was meant to be scratch data reaches the database on every association commit.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the entity names on the lines beneath this message (<code>- Module.Entity: N object(s).</code>) — they point straight at the microflow or page that creates them.' },
          { text: 'Decide per entity whether it should be committed or deleted, or whether it should be non-persistable at all — the warning does not say which, only that neither happened.' },
          { text: 'Check whether the same entity appears for many different sessions: one entity across many users is a modelling defect, a single session is a one-off abandoned wizard.', tool: 'log-viewer' },
          { text: 'The deletes the runtime performs at logout show up as DELETE statements in the same window.', tool: 'log-query-extractor' }
        ];
      }
    },
    {
      id: 'mx-slow-query-warning',
      title: 'Query exceeded the slow-query threshold',
      category: 'Database',
      specificity: 76,
      // `ConnectionBus_Queries` emits this verbatim once a statement passes the
      // configured threshold. Seconds/milliseconds are captured so the card can
      // state the actual duration.
      patterns: [/Query executed in (\d+) seconds? and (\d+) milliseconds?:/i],
      mechanism: function (m) {
        const s = parseInt(m[1], 10) || 0;
        const ms = parseInt(m[2], 10) || 0;
        return 'The runtime timed a single SQL statement at <strong>' + edxHtmlEscape(String(s)) + ' s ' + edxHtmlEscape(String(ms)) + ' ms</strong> and logged it on <code>ConnectionBus_Queries</code> because it passed the configured slow-query threshold. The statement itself follows the message. The query <em>succeeded</em> — this is a duration report, not a failure, and the user waited at least this long for whatever triggered it.';
      },
      causes: function () {
        return [
          'A retrieve over an XPath that cannot use an index — most often a constraint over an association path, or a <code>contains()</code> that becomes a leading-wildcard LIKE.',
          'A missing index on a column the generated WHERE or JOIN filters on.',
          'The query returns or scans far more rows than the page shows, because the retrieve has no limit and paging is applied after the fact.',
          'The statement is fine but the database was under load at that moment — the same query at other times would then be fast.'
        ];
      },
      checks: function () {
        return [
          { text: 'Check whether this same statement is slow every time or only sometimes: consistently slow is a plan/index problem, intermittently slow is contention.', tool: 'log-query-extractor' },
          { text: 'Read the generated SQL under the message and map it back to the entity and XPath that produced it — the table aliases carry the module and entity names.' },
          { text: 'Run the statement through an execution plan to see whether it scans where it should seek, and check with the suite\'s Index Advisor whether the WHERE/JOIN columns are actually indexed before adding anything.', tool: 'query-intelligence' },
          { text: 'If the XPath uses <code>contains()</code> on a leading wildcard, that alone prevents an index from being used, whatever indexes exist.', tool: 'xpath-builder' }
        ];
      }
    },
    {
      id: 'mx-widget-missing-parameter',
      title: 'Widget XPath is missing a parameter it references',
      category: 'Platform',
      specificity: 74,
      patterns: [/runtime operation '([^']*)' is missing parameters: \[([^\]]*)\]\. This might lead to an unresolvable XPath/i],
      mechanism: function (m) {
        const params = m[2] ? '<code>' + edxHtmlEscape(m[2]) + '</code>' : 'a parameter';
        return 'A data source on a page declares an XPath constraint that references ' + params + ', but the client sent the request without supplying it. The runtime executed the retrieve anyway with that token unresolved, so the constraint did not filter the way the model says it should — silently returning the wrong set rather than throwing.';
      },
      causes: function () {
        return [
          'The XPath uses <code>$Search</code> (or another search-field variable) but the search field it belongs to is not on the page, was removed, or is not wired to this data source.',
          'The XPath uses <code>[%CurrentObject%]</code> while the widget sits outside any data view providing that object — for example a list view placed next to, rather than inside, its context container.',
          'A snippet containing the widget is reused in a page that does not supply the same context the snippet assumes.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the XPath quoted in the message — it names the entity and the token that stayed unresolved, which identifies the data source in Studio Pro.' },
          { text: 'Open the page holding that data source and confirm the widget really is inside a container that provides the missing parameter.' },
          { text: 'Compare the rows the user actually saw against what the constraint should have allowed — an unresolved constraint usually means too much data was returned, which is a security-relevant outcome, not only a cosmetic one.' },
          { text: 'Check the retrieve this produced in the SQL log: the generated WHERE clause shows what the constraint collapsed to.', tool: 'log-query-extractor' }
        ];
      }
    },
    {
      id: 'mx-microflow-not-permitted',
      title: 'User attempted an action they are not allowed to run',
      category: 'Authentication',
      specificity: 80,
      // Two phrasings appear in the wild depending on runtime version; both name
      // the user and the microflow, and both mean the runtime refused the call.
      patterns: [
        /User '([^']*)' attempted to execute runtime operation '[^']*' \(microflow call '([^']*)'\) but does not have the required permissions/i,
        /User '([^']*)' attempted to execute the microflow with action name '([^']*)',? but does not have the required permissions/i
      ],
      mechanism: function (m) {
        const who = m[1] ? '<code>' + edxHtmlEscape(m[1]) + '</code>' : 'a user';
        const mf = m[2] ? ' <code>' + edxHtmlEscape(m[2]) + '</code>' : '';
        return 'The client asked the runtime to execute microflow' + mf + ' on behalf of ' + who + ', and the runtime refused because none of that user\'s roles grants access to it. <strong>Security worked</strong> — the microflow did not run. The line records the attempt, which is why it is worth reading rather than filtering.';
      },
      causes: function () {
        return [
          'The button or action is visible to a role that cannot execute the microflow behind it — visibility and execution rights were configured separately and drifted apart.',
          'A user\'s roles changed (or a role lost a microflow grant on redeploy) while their session was still open with the old page loaded.',
          'A deliberate attempt to invoke an operation the user discovered but is not entitled to — the same line covers both, so the pattern across users and time is what distinguishes them.'
        ];
      },
      checks: function () {
        return [
          { text: 'Count distinct users hitting this same microflow: many users means a misconfigured button, one user repeatedly means something worth looking at directly.', tool: 'log-viewer' },
          { text: 'Compare the microflow\'s allowed roles in Studio Pro against the roles that can reach the page or button that calls it — the gap between the two is the defect.' },
          { text: 'Check whether the same session produced other refusals in the same window.', tool: 'log-viewer' }
        ];
      }
    },
    {
      id: 'mx-tokenreplacer-null-ids',
      title: 'Retrieve by ID received a null ID list',
      category: 'Platform',
      specificity: 82,
      // Verbatim Scala `require` failure from the runtime's data layer; the
      // `Ids should not be null` text is emitted by DataStorageCore.retrieveId.
      patterns: [
        /requirement failed: Ids should not be null/i,
        /IllegalArgumentException: requirement failed: Ids should not be null/i
      ],
      mechanism: function () {
        return 'The runtime\'s data layer was asked to retrieve objects by ID and the ID collection handed to it was <code>null</code> rather than an empty list. A Scala <code>require</code> precondition in <code>DataStorageCore.retrieveId</code> rejected the call before any SQL ran, so this fails immediately and identically every time — nothing was read from the database.';
      },
      causes: function () {
        return [
          'A caller passed an uninitialised list where the API expects a (possibly empty) collection — an empty list is legal here, <code>null</code> is not.',
          'An association or list variable was empty on this path and was forwarded straight into a retrieve-by-ID without a check.',
          'A Marketplace module or custom Java action built the ID list from a lookup that returned nothing and did not normalise the result.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the stack under this line: the frame directly above <code>DataStorageCore.retrieveId</code> names the module or Java action that supplied the null.' },
          { text: 'Check whether the failure is constant rather than load-dependent — a precondition failure is deterministic, which separates it from a timeout or contention issue.', tool: 'log-viewer' },
          { text: 'Trace the microflow that invokes it to the activity producing the ID list.', tool: 'microflow-tracer' }
        ];
      }
    },
    {
      id: 'mail-illegal-address',
      title: 'Email rejected — malformed recipient address',
      category: 'Integration',
      specificity: 80,
      // The offending string is captured from the ``…'' quoting javax.mail uses.
      patterns: [
        /AddressException:\s*(?:Illegal address|Domain contains illegal character|Local address contains illegal character|Missing final '@domain')[^`']*``([^']*)''/i,
        /javax\.mail\.internet\.AddressException/i,
        /Sending email caused an error:\s*(?:Illegal address|Domain contains illegal character)/i
      ],
      mechanism: function (m) {
        const raw = m[1];
        const shown = raw ? '<code>' + edxHtmlEscape(raw) + '</code>' : 'the address it was given';
        const empty = raw === '' ? ' Here the string is <strong>empty</strong> — the address field was blank by the time the send ran.' : '';
        return 'The mail library parsed ' + shown + ' as an RFC&nbsp;822 address and rejected it, so the message was never handed to the SMTP server. The failure is in the address string itself, not in connectivity or credentials — the mail server was never contacted.' + empty;
      },
      causes: function (m) {
        const raw = m[1] || '';
        const glued = /@[^\s;,]*@/.test(raw) || /\.[a-z]{2,}[a-z]{3,}@/i.test(raw);
        return [
          'Several addresses were concatenated without a separator, producing one invalid string instead of a recipient list — a comma or semicolon is missing where the list is assembled.' + (glued ? ' <strong>The captured string here shows exactly that shape: two addresses run together.</strong>' : ''),
          'The recipient attribute was empty or whitespace when the send activity ran, because the retrieve that should have filled it returned nothing.',
          'User-entered or imported data reached the address field without validation — trailing text, a display name, or a stray character.',
          'A template or configuration value that should hold an address holds something else (a name, a placeholder that was never substituted).'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the quoted string in the message literally, including its length — an empty <code>``\'\'</code> and two glued-together addresses are different defects with different fixes.' },
          { text: 'Find where the recipient list is built and confirm the separator used when joining multiple addresses.', tool: 'microflow-tracer' },
          { text: 'Check whether the same malformed value recurs or each failure carries a different string: a recurring value is one bad record, varying values point at the joining logic.', tool: 'log-viewer' }
        ];
      }
    },
    {
      id: 'mx-import-attribute-parse',
      title: 'Import mapping could not parse a value into an attribute',
      category: 'Integration',
      specificity: 78,
      patterns: [/A problem occurred parsing attribute '([^']*)' of object of type '([^']*)'\. The value was '([^']*)'/i],
      mechanism: function (m) {
        const attr = m[1] ? '<code>' + edxHtmlEscape(m[1]) + '</code>' : 'an attribute';
        const type = m[2] ? ' on <code>' + edxHtmlEscape(m[2]) + '</code>' : '';
        const val = m[3] === '' ? 'an <strong>empty</strong> value' : '<code>' + edxHtmlEscape(m[3]) + '</code>';
        return 'An import mapping (JSON or XML) reached ' + attr + type + ' and could not turn ' + val + ' into the attribute\'s declared type, so the import stopped on this object. The message reports the attribute, the entity and the exact value — the transport and the schema match, the individual value does not.';
      },
      causes: function () {
        return [
          'The attribute is an enumeration and the incoming value is not one of its members — an empty string is the most common case, because "no value" is not a member unless it is modelled as one.',
          'The value is longer than the attribute\'s maximum length (the wrapped exception is then a <code>StringLengthException</code> naming both lengths).',
          'A number, date or boolean arrives in a format the parser does not accept — a locale-specific decimal separator, or a date without the expected pattern.',
          'The source system started sending a value it never sent before, so a mapping that worked for months now fails on one record.'
        ];
      },
      checks: function () {
        return [
          { text: 'Read the wrapped exception directly beneath this line — it distinguishes an invalid enumeration member from a length overflow from a format mismatch, which need different fixes.' },
          { text: 'Compare the reported value against the attribute\'s definition in Studio Pro (enumeration members, max length, type).' },
          { text: 'Decide whether the mapping should reject or tolerate this value — an optional field receiving an empty string usually wants the attribute to allow it, not the sender to change.' },
          { text: 'Inspect the raw payload that carried it to see whether one sender or one record is responsible.', tool: 'ws-rest-extractor' }
        ];
      }
    },
    {
      id: 'mx-xsd-validation-failed',
      title: 'XML failed schema (XSD) validation',
      category: 'Integration',
      specificity: 79,
      // `cvc-*` are the W3C schema-assertion codes Xerces emits verbatim, so the
      // rule fires regardless of which layer wrapped the parse failure.
      patterns: [/(cvc-[a-z0-9-]+(?:\.[0-9a-z]+)*)\s*:\s*([^\n]{0,200})/i],
      mechanism: function (m) {
        const code = m[1] ? '<code>' + edxHtmlEscape(m[1]) + '</code>' : 'a schema assertion';
        return 'An XML document was validated against an XSD and violated ' + code + ' — one of the W3C schema-assertion codes the parser emits verbatim. Validation failed before the document was mapped, so nothing was imported from it. The text after the code names the element that broke the rule and, usually, what was expected instead.';
      },
      causes: function (m) {
        const code = m[1] || '';
        const list = [];
        if (/cvc-complex-type/i.test(code)) {
          list.push('An element appeared where the schema did not allow it — often a whole SOAP envelope being validated against the schema of its <em>body</em>, so <code>Header</code> shows up where <code>Body</code> was expected. That is a wiring mistake, not a bad document.');
        }
        if (/cvc-(?:fractionDigits|maxLength|minLength|maxInclusive|minInclusive|length|pattern)/i.test(code)) {
          list.push('A value is well-formed but outside a facet the schema declares (too many fraction digits, too long, outside a range, not matching a pattern) — the sender\'s precision or field width does not match the contract.');
        }
        list.push('The sender is using a newer or older version of the contract than the XSD deployed here.');
        list.push('A namespace differs from the one the schema declares, so elements that look correct do not match.');
        list.push('The document is assembled by string concatenation somewhere upstream and is not schema-valid by construction.');
        return list;
      },
      checks: function () {
        return [
          { text: 'Read the assertion text: it names the element found and the element expected, which localises the problem to one position in the document.' },
          { text: 'Confirm you are validating the right fragment — a <code>Header</code>/<code>Body</code> mismatch means the envelope is being fed to a schema written for the payload.' },
          { text: 'Compare the deployed XSD against the version the sender built against.' },
          { text: 'Check the document for invisible control characters or a BOM if the assertion looks impossible from reading the text.', tool: 'char-sanitizer' }
        ];
      }
    },
    {
      id: 'saml-nothing-returned-for-id',
      title: 'SAML artifact resolution returned nothing',
      category: 'Authentication',
      specificity: 76,
      patterns: [/Nothing was returned for the requested ID/i],
      mechanism: function () {
        return 'The SAML module held a request ID and asked the identity provider for the assertion belonging to it, and the IdP answered without one. Login stops here: the runtime has a reference it cannot resolve into an authenticated identity, so no session is created. This is the artifact-binding leg of the flow, not the assertion-validation leg — the response arrived, it was simply empty.';
      },
      causes: function () {
        return [
          'The artifact was already resolved once — artifacts are single-use, so a retry, a refresh, or a duplicate callback finds nothing the second time.',
          'The artifact expired before it was resolved; IdPs keep them for a very short window.',
          'The runtime restarted (or the request was served by a different instance) between issuing the request and resolving the artifact, so the in-memory request state was gone.',
          'The IdP and the SP disagree on which entity the artifact belongs to, so the lookup succeeds but matches no stored request.'
        ];
      },
      checks: function () {
        return [
          { text: 'Check whether the user reached a working session on a retry — a one-off failure that self-heals points at a duplicate or expired artifact rather than a broken configuration.' },
          { text: 'Correlate the timestamp with app restarts or a scale event: lost in-memory request state explains a burst of these at one moment.', tool: 'log-viewer' },
          { text: 'Inspect the SAML exchange and compare the request ID issued against the one resolved.', tool: 'saml-debugger' },
          { text: 'Confirm the 303 redirect to <code>/SSO/assertion</code> actually arrived for these attempts.', tool: 'nginx-log' }
        ];
      }
    },
    {
      id: 'poi-summaryinformation-null',
      title: 'Excel/Office document has no summary metadata (benign)',
      category: 'Integration',
      // Deliberately low: this is noise, and must never outrank a real failure
      // that happens to appear in the same pasted block.
      specificity: 40,
      patterns: [/(?:Document)?SummaryInformation property set came back as null/i],
      mechanism: function () {
        return 'Apache POI — the library Mendix uses to read Office documents — opened the file, looked for its optional <code>SummaryInformation</code> / <code>DocumentSummaryInformation</code> property stream (title, author, company) and did not find one, so it logged this and carried on. <strong>Nothing failed.</strong> The document was still read; only the optional metadata block is absent.';
      },
      causes: function () {
        return [
          'The file was produced by a generator (a reporting tool, a script, an export from another system) that writes cells but not the optional document-properties stream — by far the most common case.',
          'The document properties were deliberately stripped, e.g. by a privacy/metadata-removal step before the file was sent.',
          'The file is an older or minimal Office format variant that does not carry the stream at all.'
        ];
      },
      checks: function () {
        return [
          { text: 'Treat this as noise unless an actual import failure appears alongside it — the presence of this line says nothing about whether the import succeeded.' },
          { text: 'If it dominates the log, it is worth filtering rather than fixing: the volume tracks how many generated files you import, not how many of them are broken.', tool: 'log-viewer' },
          { text: 'Only if an import did fail, look for the real error near this line — POI logs this before it reports anything that actually went wrong.' }
        ];
      }
    },
    {
      id: 'mx-user-creation-disabled',
      title: 'SSO could not create a user — module setting is off',
      category: 'Authentication',
      specificity: 84,
      patterns: [/User creation is currently disabled due to the inactive status of the '([^']*)' setting/i],
      mechanism: function (m) {
        const s = m[1] ? '<code>' + edxHtmlEscape(m[1]) + '</code>' : 'the user-creation setting';
        return 'An authenticated identity arrived for which no local user account exists, and the module that would normally provision one refused because ' + s + ' is switched off in its configuration. Authentication itself succeeded — the identity is valid; the app simply has nowhere to put it, so the login cannot complete.';
      },
      causes: function () {
        return [
          'Just-in-time provisioning was never enabled in this environment, while accounts are expected to be created up front by a sync or by an administrator.',
          'The environment was configured by copying another environment\'s configuration, where the setting was intentionally off.',
          'The setting is off on purpose and this user genuinely should not have an account — in which case the correct outcome is exactly what happened.'
        ];
      },
      checks: function () {
        return [
          { text: 'Decide first whether users are meant to be provisioned automatically here at all — enabling the setting is only right if the answer is yes.' },
          { text: 'If accounts come from a sync instead, check whether that sync ran and why this identity is missing from it.', tool: 'log-viewer' },
          { text: 'Confirm the identity provider is sending the attributes the module needs to build an account, since provisioning would fail for a second reason otherwise.', tool: 'saml-debugger' }
        ];
      }
    },
    {
      id: 'mx-cachebust-missing',
      title: 'Static resource requested without a cachebust token',
      category: 'Platform',
      specificity: 60,
      patterns: [/Invalid request for '([^']*)': no cachebust query string found/i],
      mechanism: function (m) {
        const f = m[1] ? '<code>' + edxHtmlEscape(m[1]) + '</code>' : 'a static resource';
        return 'The runtime serves ' + f + ' only with the cache-busting query string it stamps into the deployed client, and this request arrived without one, so it was refused. Nothing in the application failed — the request did not come from a page this deployment served.';
      },
      causes: function () {
        return [
          'A browser or installed PWA is running a cached client from a previous deployment and still requests the old, unstamped URL.',
          'A crawler, uptime monitor or link checker fetched the path directly, without going through the page that supplies the token.',
          'A hard-coded reference somewhere (a bookmark, an external page, a mobile wrapper) points at the bare path.'
        ];
      },
      checks: function () {
        return [
          { text: 'Check the user agent behind these requests in the access log — a monitor or crawler explains them entirely and needs no fix.', tool: 'nginx-log' },
          { text: 'If they come from real browsers, see whether they cluster shortly after a deployment: that is stale clients aging out, and it stops on its own.', tool: 'log-viewer' },
          { text: 'Persistent requests from real users point at a cached service worker that is not updating — reproduce with an empty profile to confirm.' }
        ];
      }
    },
    {
      id: 'mx-delete-after-download',
      title: 'Delete-after-download on a file shown in the browser',
      category: 'Platform',
      specificity: 58,
      patterns: [/Deleting files after download, which are also shown in the browser without caching them, will prevent files from being saved/i],
      mechanism: function () {
        return 'A download action is configured both to show the file in the browser (rather than force a save dialog) and to delete it afterwards, with caching off. The runtime is warning that these settings contradict each other: the browser displays the file in its viewer, and when the user then presses Save, the bytes are gone — the runtime already deleted them.';
      },
      causes: function () {
        return [
          '"Show in browser" and "Delete after download" are both enabled on the same download action, which is the exact combination this warning describes.',
          'The file is a temporary generated document (a PDF report, an export) that the model intends to clean up immediately, without accounting for the browser viewing it rather than saving it.'
        ];
      },
      checks: function () {
        return [
          { text: 'Open the download action and check the two settings together — the warning is about their combination, not either one alone.' },
          { text: 'Decide which behaviour you actually want: forcing a save makes deletion safe, while showing in the browser means cleanup must happen later (a scheduled event), not on download.' },
          { text: 'Check whether users have reported failed saves of this document — the warning fires on configuration, so it appears whether or not anyone has actually hit the problem.', tool: 'log-viewer' }
        ];
      }
    }
  ];

  // Detects whether the input looks like it carries a stack trace (indented
  // frames, `at …`, `Caused by:`) — surfaced in the UI as context, never a match.
  function edxHasStackTrace(text) {
    return /\n\s+at\s+[\w$.<>]+\(/.test(text) ||
      /\bat\s+(?:java|com|org|javax|sun|scala|net)\./.test(text) ||
      /Caused by:/i.test(text);
  }

  // Runs one rule's patterns; returns the first RegExp match (with captures) or null.
  function edxRunRule(rule, text) {
    for (let i = 0; i < rule.patterns.length; i++) {
      const m = text.match(rule.patterns[i]);
      if (m) return m;
    }
    return null;
  }

  // Pure decode. Returns every rule whose signature is present, most specific
  // first. Empty `matches` is the honest answer for an unrecognized error — the
  // UI shows guidance, never a guessed cause (data-driven rule).
  function edxDecode(text) {
    text = String(text == null ? '' : text);
    const trimmed = text.trim();
    const matches = [];
    if (trimmed) {
      for (let i = 0; i < EDX_RULES.length; i++) {
        const rule = EDX_RULES[i];
        const m = edxRunRule(rule, text);
        if (!m) continue;
        matches.push({
          id: rule.id,
          title: rule.title,
          category: rule.category,
          specificity: rule.specificity,
          matchedText: (m[0] || '').replace(/\s+/g, ' ').trim().slice(0, 240),
          mechanism: rule.mechanism(m),
          causes: rule.causes(m),
          checks: rule.checks(m)
        });
      }
      // Most specific signature first; stable by rule order within equal scores.
      matches.sort(function (a, b) { return b.specificity - a.specificity; });
    }

    return {
      input: {
        empty: trimmed.length === 0,
        lineCount: trimmed ? trimmed.split(/\r?\n/).length : 0,
        hasStackTrace: edxHasStackTrace(text),
        // The decoded message itself, kept BY REFERENCE (no copy — the textarea
        // already holds it). "Tables in this message" used to search only
        // `matchedText`, which is the matched signature clipped to 240 chars:
        // for the unique-constraint rule that is `ERROR: duplicate key value`,
        // which never contains a table name, so the section almost never
        // appeared even with a model loaded. The message is what the label says
        // it looks at.
        text: text
      },
      matches: matches
    };
  }

  // Strips a leading log timestamp/level/node prefix from each line — pasting
  // from the Mendix Cloud log viewer carries this on every visual line, not
  // just the first. Lines without the prefix (raw "at ..."/"Caused by:"
  // continuations) are left untouched since the pattern only matches at the
  // very start of a line. Purely cosmetic: edxDecode's patterns already search
  // the whole text regardless of prefixes, so this never changes what matches —
  // it only makes the pasted trace readable.
  const EDX_LOG_PREFIX = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\s+(?:\[[^\]]+\]\s+)?(?:TRACE|DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)?\s*-?\s*(?:[\w$.]+:\s*)?/;

  function edxCleanStackTrace(text) {
    if (!text) return text;
    return String(text).split(/\r?\n/)
      .map(function (line) { return line.replace(EDX_LOG_PREFIX, ''); })
      .filter(function (line) { return line.trim() !== ''; })
      .join('\n');
  }

  root.edxDecode = edxDecode;
  root.EDX_RULES = EDX_RULES;
  root.edxCleanStackTrace = edxCleanStackTrace;
})(typeof window !== 'undefined' ? window : self);

// PostgreSQL errors name tables (`eshop$order`), Mendix developers think in
// entities (`eShop.Order`). When a domain model has been loaded from a live
// database (Domain Model & Architecture → Load model from database) the map is
// on window and we can translate. Pure so it is unit-testable; returns [] when
// no model is loaded, so the card section simply does not appear.
function edxMapTables(text, tableMap) {
  if (!text || !tableMap) return [];
  const found = [];
  const seen = {};
  Object.keys(tableMap).forEach(function (table) {
    if (!table || seen[table]) return;
    if (String(text).toLowerCase().indexOf(String(table).toLowerCase()) === -1) return;
    seen[table] = true;
    found.push({ table: table, entity: tableMap[table] });
  });
  // Longest first: `eshop$orderline` is more specific than `eshop$order`.
  found.sort(function (a, b) { return b.table.length - a.table.length; });
  return found;
}


self.edxMapTables = edxMapTables;
