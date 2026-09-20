// fixtures/build-fixture.mjs
// Parses fixtures/ai-stream-raw.txt — SSE bytes quoted verbatim from Anthropic's
// own "Streaming messages" documentation (source URL recorded in the output
// JSON's `source` field) — into the ordered list of {event, data} chunks the
// page's section-06 stepper walks through. No API call, no key: this is a
// citation of a real primary source, not a live capture.
import { readFileSync, writeFileSync } from 'node:fs';

const raw = readFileSync(new URL('./ai-stream-raw.txt', import.meta.url), 'utf8');
const chunks = [];
let eventType = '';
let dataLines = [];

function flush() {
  if (dataLines.length === 0) return;
  chunks.push({ event: eventType || 'message', data: JSON.parse(dataLines.join('\n')) });
  eventType = '';
  dataLines = [];
}

for (const line of raw.split(/\r?\n/)) {
  if (line === '') { flush(); continue; }
  if (line.startsWith('event:')) { eventType = line.slice(6).trim(); continue; }
  if (line.startsWith('data:')) { dataLines.push(line.slice(5).trim()); continue; }
}
flush();

writeFileSync(
  new URL('./ai-stream-tool-call.json', import.meta.url),
  JSON.stringify({
    source: 'https://platform.claude.com/docs/en/build-with-claude/streaming',
    source_section: 'Streaming request with tool use',
    retrieved_at: '2026-09-19',
    model: chunks.find((c) => c.event === 'message_start')?.data?.message?.model ?? 'unknown',
    chunks,
  }, null, 2),
);
console.log(`Wrote fixtures/ai-stream-tool-call.json with ${chunks.length} chunks`);
