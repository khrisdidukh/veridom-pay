// Ask the private NEAR AI inspector (TEE) to judge photos for one milestone; save the signed bundle.
// usage: NEARAI_API_KEY=... node make-evidence.mjs PROJECT MILESTONE OUT_DIR photo1.jpg [photo2.jpg ...] [--kind DEFECT]
import fs from 'node:fs';
import { makeEvidence } from './evidence.mjs';

const args = process.argv.slice(2);
const kindAt = args.indexOf('--kind');
const kind = kindAt >= 0 ? args.splice(kindAt, 2)[1] : 'MILESTONE';
const [project, milestone, out, ...files] = args;
if (!files.length) {
  console.error('usage: NEARAI_API_KEY=... node make-evidence.mjs PROJECT MILESTONE OUT_DIR photo... [--kind DEFECT]');
  process.exit(2);
}
const b = await makeEvidence({ project, milestone, kind, photos: files.map((f) => fs.readFileSync(f)) });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(`${out}/request.json`, b.request);
fs.writeFileSync(`${out}/response.json`, b.response);
fs.writeFileSync(`${out}/signature.json`, JSON.stringify(b.signature));
console.log(`${b.request.length} bytes sent; verdict: ${JSON.parse(b.response).choices[0].message.content.trim()}`);
