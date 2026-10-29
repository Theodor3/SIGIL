// Optional future statusLine adapter; NOT installed or configured by this change.
// Reads only explicit stdin, emits allowlisted quota JSON. No network/file writes.
import {parseClaudeStatusline, MAX_PAYLOAD_BYTES} from './usage-summary.mjs';
const chunks = []; let bytes = 0; let overflow = false;
for await (const chunk of process.stdin) {
  bytes += chunk.length;
  if (bytes > MAX_PAYLOAD_BYTES) { overflow = true; chunks.length = 0; break; }
  chunks.push(chunk);
}
try {
  if (overflow) throw new Error();
  console.log(JSON.stringify(parseClaudeStatusline(Buffer.concat(chunks).toString('utf8'))));
} catch {
  console.error('Claude quota unavailable: invalid or oversized statusline input.');
  process.exitCode = 1;
}
