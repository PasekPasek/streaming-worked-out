# Streaming, Worked Out

A single-page, dependency-free interactive explainer for streaming over HTTP — chunked responses,
Server-Sent Events, `EventSource` reconnection, AI model token streams, and the TypeScript that
consumes them — built up from three facts about any stream rather than from a protocol tour.

**Live: https://pasekpasek.github.io/streaming-worked-out/**

## What's in it

- **Three things always true about a stream.** One `write()` is not one `read()`; a stream needs a
  framing rule or "not yet" is indistinguishable from "never"; resuming requires the *receiver* to
  have remembered a position.
- **An HTTP response that doesn't end.** Why chunked transfer coding exists, quoted from RFC 9112,
  and the `flushHeaders()` call everybody forgets.
- **The SSE wire format.** `data:`/`event:`/`id:`/`retry:`, blank-line dispatch, comment keep-alives
  — plus the spec sentence that causes the most bugs: closing the connection does *not* dispatch the
  last event. A sandbox steps a stream through chunk boundaries so you can watch the parser hold a
  half-finished line.
- **EventSource, reconnection and `Last-Event-ID`.** What the browser does for free, what it flatly
  refuses to do (no custom headers, no POST, never gives up), and a sandbox that drops the
  connection so you can compare resuming by id against replaying the whole buffer — including what
  the replay design costs when the client forgets to de-duplicate.
- **The server side.** `subscribe(event => res.write(event))` as the seam between an event bus and a
  socket, plus the keep-alive and the cleanup that are missing from every short example.
- **A model's tokens are an SSE stream.** `message_start` → `content_block_delta` → `message_stop`,
  with tool arguments arriving as JSON that isn't valid JSON yet. A stepper over a real captured
  tool-call turn.
- **Consuming a stream in TypeScript.** `fetch` + `ReadableStream`, `AbortController`, and a sandbox
  showing a multi-byte character cut in half by a chunk boundary — decoded with and without
  `{ stream: true }`, side by side, from byte-identical input.
- **SSE, WebSocket, long-polling.** What each is actually for, and the one genuine SSE limit: six
  connections per browser on HTTP/1.1.
- **What goes wrong.** Buffering proxies, compression without flush, idle timeouts, leaked
  subscribers, ignored backpressure — and the two-command diagnostic that tells you whether to look
  at your code at all.

## What is real and what is a model

Four of the page's models are backed by running code, checked by `test-model.ts` (15 checks):

- **The SSE parser** — against a real `node:http` server, including an event deliberately split
  across two TCP-level writes, over a real `fetch` + `ReadableStream` client.
- **The WHATWG dispatch rules** — that a stream ending without a blank line dispatches nothing, that
  an incomplete line is held rather than guessed at, and that a comment line dispatches nothing.
- **The UTF-8 boundary** — against the real `TextDecoder`: that the fixture genuinely cuts the
  three-byte `☕` in half, that `{ stream: true }` reassembles it exactly, that omitting the option
  replaces it with `U+FFFD` permanently, and that a clean split is harmless either way (which is why
  the bug survives code review).
- **The two resumption designs** — that `Last-Event-ID` sends exactly what was missed, that replay
  mode without client de-duplication produces duplicates, and that replay *with* de-duplication ends
  up identical to resuming by id.

```bash
node test-model.ts
```

The RFC 9112, WHATWG HTML, WHATWG Encoding and MDN statements are quoted from those documents, not
reproduced locally. The §06 streaming fixture is quoted verbatim from Anthropic's own published
[streaming documentation](https://platform.claude.com/docs/en/build-with-claude/streaming), not
captured from a live API call; `fixtures/build-fixture.mjs` rebuilds it from
`fixtures/ai-stream-raw.txt`.

## Scope

The transport half of the problem: how bytes cross a socket and become events. What *produces* those
events, who else consumes them, and what a broker guarantees about delivery and ordering is the
other half, and it has its own page:
[event-driven-architecture-worked-out](https://github.com/PasekPasek/event-driven-architecture-worked-out).
§05's `subscribe(event => res.write(event))` is the seam between the two.

WebSocket is compared in §08, not built. gRPC streaming and HTTP/2 server push are named and left
out.

## Running it

One file, no build step. `test-model.ts` runs directly on Node 24's native TypeScript type-stripping
— no compiler, no dependencies.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Credits

Built by [Paweł Pasek](https://github.com/PasekPasek). Companion to
[event-loop-worked-out](https://github.com/PasekPasek/event-loop-worked-out),
[auth-worked-out](https://github.com/PasekPasek/auth-worked-out) and
[event-driven-architecture-worked-out](https://github.com/PasekPasek/event-driven-architecture-worked-out),
which use the same workshop-plate design. The SSE server shape and in-process event bus are grounded
in [4th-devs](https://github.com/i-am-alice/4th-devs), an open-source agent-orchestration course
repository.

MIT.
