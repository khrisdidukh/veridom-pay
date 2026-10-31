// Offline checks: every real bundle verifies; any tampering is detected.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { answerOf, ed25519Verify, readBundle, sha256hex } from './lib.mjs';

const dirs = fs.readdirSync('../evidence', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `../evidence/${d.name}`);
assert.ok(dirs.length >= 4, 'expected evidence bundles');
for (const dir of dirs) {
  const { request, response, signature: s } = readBundle(dir);
  const model = JSON.parse(request).model;
  const text = `${model}:${sha256hex(request)}:${sha256hex(response)}`;
  assert.equal(text, s.text, `${dir}: signed text must match exact bytes`);
  assert.ok(ed25519Verify(s.signing_address, text, s.signature), `${dir}: signature valid`);
  // flip the verdict -> signature must no longer match
  const v = answerOf(response).verdict;
  const forged = Buffer.from(response.toString().replace(v, v === 'APPROVED' ? 'REJECTED' : 'APPROVED'));
  const forgedText = `${model}:${sha256hex(request)}:${sha256hex(forged)}`;
  assert.ok(!ed25519Verify(s.signing_address, forgedText, s.signature), `${dir}: forged verdict must fail`);
  // swap a photo byte -> must fail
  const tampered = Buffer.from(request);
  tampered[tampered.length - 20] ^= 1;
  assert.ok(!ed25519Verify(s.signing_address, `${model}:${sha256hex(tampered)}:${sha256hex(response)}`, s.signature), `${dir}: altered photo must fail`);
  console.log(`ok  ${dir.split('/').pop()}: genuine verifies, forged verdict and altered photo are rejected`);
}
console.log(`\n${dirs.length} bundles, all checks passed`);
