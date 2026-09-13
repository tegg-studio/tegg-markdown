# Local HTTP compare-and-swap example

Run `node examples/http-cas/server.mjs`. The server binds only to loopback and keeps
one document in memory. It demonstrates atomic revision comparison; it is not a
production service, authentication layer, durable store or distributed lock.

A Host loads `GET /documents/example`, gives its source/revision to the Editor,
and saves an exact `editor.snapshot()` using `PUT` with JSON `{baseRevision, source}`.
On success call `editor.acknowledgeSaved(snapshot, response.revision)`; on HTTP 409
retain the local draft and offer explicit reconciliation. Never retry with a new
base revision without resolving the conflict. Reopen with GET to verify the exact
saved source. Serve/proxy this endpoint from the application's own origin; this
example does not enable permissive CORS.

Run `node --test examples/http-cas/store.node-test.mjs` for concurrent-write and
CRLF/Unicode round-trip verification. A production store must implement the
comparison and write in its own database transaction or equivalent atomic API.
