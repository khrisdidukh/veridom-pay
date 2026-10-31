// Re-verify signed evidence bundles exactly like the contract does, offline (no API key, no wallet).
// usage: node verify-bundle.mjs DIR [DIR...]
import { answerOf, ed25519Verify, readBundle, sha256hex } from './lib.mjs';

let failed = 0;
for (const dir of process.argv.slice(2)) {
  const { request, response, signature: s } = readBundle(dir);
  const model = JSON.parse(request).model;
  const text = `${model}:${sha256hex(request)}:${sha256hex(response)}`;
  const textOk = text === s.text;
  const sigOk = s.signing_algo === 'ed25519' && ed25519Verify(s.signing_address, text, s.signature);
  const a = answerOf(response);
  const ok = textOk && sigOk;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${dir.replace(/\/$/, '').split('/').pop().padEnd(16)} ${a.project}/${a.milestone} ${a.verdict.padEnd(20)} signer ${s.signing_address.slice(0, 12)}… ${textOk ? '' : '[hash mismatch]'}${sigOk ? '' : '[bad signature]'}`);
}
process.exit(failed ? 1 : 0);
