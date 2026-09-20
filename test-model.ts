// Checks the page's models against something real: a real node:http server and
// a real fetch + ReadableStream client for the SSE parser, a real TextDecoder
// for the UTF-8 boundary, and executed matrices for the resumption designs.
//
//   node test-model.ts

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function extractModel(name: string): string {
  const re = new RegExp(`/\\* MODEL:${name} START \\*/([\\s\\S]*?)/\\* MODEL:${name} END \\*/`);
  const match = html.match(re);
  if (!match) throw new Error(`MODEL:${name} block not found in index.html`);
  return match[1];
}

function loadModel<T>(name: string, exportNames: string[]): T {
  const src = extractModel(name);
  const fn = new Function(`${src}\nreturn { ${exportNames.join(', ')} };`);
  return fn() as T;
}

let failures = 0;
function check(label: string, pass: boolean, detail?: string): void {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n    ${detail}` : ''}`);
}

// ── sse parser, against a real chunked HTTP response ─────────────────────
async function checkSse(): Promise<void> {
  const { createSseParser } = loadModel<{ createSseParser: () => {
    push(chunk: string): Array<{ id: string | null; event: string; data: string }>;
    lastEventId: string;
    buffered: string;
  } }>('sse', ['createSseParser']);

  const sent = [
    { id: '1', data: 'first' },
    { id: '2', data: 'second' },
    { id: '3', data: 'third' },
  ];

  const server = createServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(`id: ${sent[0].id}\ndata: ${sent[0].data}\n\n`);
    // Deliberately split an event across two TCP-level writes, mid-field.
    res.write(`id: ${sent[1].id}\ndata: `);
    setTimeout(() => {
      res.write(`${sent[1].data}\n\n`);
      res.write(`id: ${sent[2].id}\ndata: ${sent[2].data}\n\n`);
      res.end();
    }, 20);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  const res = await fetch(`http://localhost:${port}/`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const received: Array<{ id: string | null; event: string; data: string }> = [];

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    received.push(...parser.push(decoder.decode(value, { stream: true })));
  }

  server.close();

  const wantIds = sent.map((s) => s.id);
  const gotIds = received.map((e) => e.id);
  const wantData = sent.map((s) => s.data);
  const gotData = received.map((e) => e.data);

  check(
    'sse: parses 3 events split across chunk boundaries, ids in order',
    JSON.stringify(gotIds) === JSON.stringify(wantIds),
    `expected ids ${JSON.stringify(wantIds)}, got ${JSON.stringify(gotIds)}`,
  );
  check(
    'sse: data field reassembled correctly across a split mid-value',
    JSON.stringify(gotData) === JSON.stringify(wantData),
    `expected data ${JSON.stringify(wantData)}, got ${JSON.stringify(gotData)}`,
  );
  check(
    'sse: parser tracks lastEventId as the running Last-Event-ID',
    parser.lastEventId === '3',
    `expected lastEventId "3", got "${parser.lastEventId}"`,
  );
}

await checkSse();

// ── the spec rule the page quotes: no blank line, no dispatch ────────────
{
  const { createSseParser } = loadModel<{ createSseParser: () => {
    push(chunk: string): Array<{ id: string | null; event: string; data: string }>;
    buffered: string;
  } }>('sse', ['createSseParser']);

  // "Note that the last still has to end with a blank line, the end of the
  // stream is not enough to trigger the dispatch of the last event."
  const noBlankLine = createSseParser();
  const dispatchedWithout = noBlankLine.push('data: done\n');
  const withBlankLine = createSseParser();
  const dispatchedWith = withBlankLine.push('data: done\n\n');

  check(
    'sse: a stream ending without a blank line dispatches nothing (WHATWG rule)',
    dispatchedWithout.length === 0 && dispatchedWith.length === 1,
    `without: ${dispatchedWithout.length}, with: ${dispatchedWith.length}`,
  );

  const midLine = createSseParser();
  const none = midLine.push('id: 1\nda');
  check(
    'sse: an incomplete line is held in the buffer, not guessed at',
    none.length === 0 && midLine.buffered === 'da',
    `dispatched ${none.length}, buffered ${JSON.stringify(midLine.buffered)}`,
  );

  const comment = createSseParser();
  const fromComment = comment.push(': keep-alive\n\n');
  check(
    'sse: a comment line dispatches nothing',
    fromComment.length === 0,
    `dispatched ${fromComment.length}`,
  );
}

// ── utf-8 across a chunk boundary, against the real TextDecoder ──────────
{
  const { decodeChunks, splitUtf8 } = loadModel<{
    decodeChunks: (chunks: Uint8Array[], streaming: boolean, atEnd: boolean) => string;
    splitUtf8: (text: string, offsets: number[]) => Uint8Array[];
  }>('utf8', ['decodeChunks', 'splitUtf8']);

  const TEXT = 'data: {"t":"café ☕"}';
  const chunks = splitUtf8(TEXT, [8, 14, 19]);

  check(
    'utf8: the fixture really does cut a multi-byte character in half',
    chunks.length === 4 && chunks[2][chunks[2].length - 1] === 0xe2,
    `chunk 3 ends with 0x${chunks[2][chunks[2].length - 1].toString(16)} (0xe2 is the lead byte of ☕)`,
  );

  const streamed = decodeChunks(chunks, true, true);
  check(
    'utf8: decode(chunk, { stream: true }) reassembles the split character exactly',
    streamed === TEXT,
    `expected ${JSON.stringify(TEXT)}, got ${JSON.stringify(streamed)}`,
  );

  const naive = decodeChunks(chunks, false, true);
  check(
    'utf8: without the stream option the character is replaced, permanently',
    naive !== TEXT && naive.includes('\uFFFD'),
    `got ${JSON.stringify(naive)}`,
  );

  // Round-trip: a clean split (between characters) is harmless either way.
  const clean = splitUtf8(TEXT, [8]);
  check(
    'utf8: a boundary that falls between characters is harmless either way',
    decodeChunks(clean, false, true) === TEXT && decodeChunks(clean, true, true) === TEXT,
    'both decoders agree when the split is clean — which is why this bug survives review',
  );
}

// ── the two resumption designs from §04 ──────────────────────────────────
{
  interface Ev { id: string; text: string }
  const { eventsOnReconnect, acceptEvents } = loadModel<{
    eventsOnReconnect: (mode: string, log: Ev[], lastId: string) => Ev[];
    acceptEvents: (received: Ev[], incoming: Ev[], dedup: boolean) => Ev[];
  }>('resume', ['eventsOnReconnect', 'acceptEvents']);

  const log: Ev[] = [1, 2, 3, 4, 5].map((n) => ({ id: String(n), text: `e${n}` }));
  const hadFirstTwo = log.slice(0, 2);

  const resumed = eventsOnReconnect('lastid', log, '2');
  check(
    'resume: Last-Event-ID sends exactly what the client missed',
    JSON.stringify(resumed.map((e) => e.id)) === JSON.stringify(['3', '4', '5']),
    `got ${JSON.stringify(resumed.map((e) => e.id))}`,
  );

  const replayed = eventsOnReconnect('replay', log, '2');
  check(
    'resume: replay mode ignores the header and re-sends the whole buffer',
    replayed.length === 5,
    `got ${replayed.length}`,
  );

  const dupes = acceptEvents(hadFirstTwo, replayed, false);
  const ids = dupes.map((e) => e.id);
  check(
    'resume: replay without client de-duplication produces duplicates',
    ids.length === 7 && ids.filter((i) => i === '1').length === 2,
    `client ended up with ${JSON.stringify(ids)}`,
  );

  const deduped = acceptEvents(hadFirstTwo, replayed, true);
  check(
    'resume: replay with client de-duplication ends up identical to Last-Event-ID',
    JSON.stringify(deduped.map((e) => e.id))
      === JSON.stringify(acceptEvents(hadFirstTwo, resumed, true).map((e) => e.id)),
    `deduped ${JSON.stringify(deduped.map((e) => e.id))}`,
  );

  // A client that has never connected announces nothing and must get everything.
  const fresh = eventsOnReconnect('lastid', log, '');
  check(
    'resume: a client with no Last-Event-ID gets the whole buffer, not nothing',
    fresh.length === 5,
    `got ${fresh.length}`,
  );
}

console.log(failures ? `\n${failures} failing` : '\nall model checks pass');
process.exit(failures ? 1 : 0);
