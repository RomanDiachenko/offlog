# NyxDB full-sync regression scripts

Preserved from the 2026-07-27 NyxDB adoption's Phase 0 root-cause check
(see `docs/decisions.md`'s NyxDB entries). Each script does a real
`db.sync()` full pull from a genuinely empty PouchDB (memory adapter)
against a locally running NyxDB instance, to catch a regression of the
"problem getting docs" failure investigated that day.

`offlog-app/tests/replication.test.ts` now covers replication
automatically in CI, but only between two in-memory databases. These
scripts remain the only check of replication over HTTP against a real
NyxDB instance.

Usage: start a local NyxDB instance (`vendor/nyxdb-win/nyxdb.exe`, or via
`fetch-nyxdb-win.ps1`), create an `offlog` database, seed it with some
docs, then edit each script's `remote` URL/credentials to match and run
with `node repro.js` / `repro2.js` / `repro3.js` (default batch size,
small batch size + deep revision history + a real conflict, and
`live:true/retry:true` respectively). All three should complete with
zero errors.

`edit-replication.js` is the one that matters most and the one that runs
in CI (Desktop CI, after the vendored NyxDB is built). It needs no setup:
`node edit-replication.js [path\to\nyxdb.exe]` starts its own NyxDB on a
free port with a temporary data folder, has two replicas sync live through
it, edits a doc after the first sync in both directions and deletes it, and
fails if either replica ends up with a conflict or a shortened history. A
server whose read paths drop `_revisions` (NyxDB before v0.1.7) fails it;
the full-pull scripts above can't see that, since every doc is at rev 1.
It then restarts the sidecar on the same data folder and checks that
attachment bytes and Content-Types survive, read raw and by a fresh replica,
and that an edit after the restart doesn't fork.
