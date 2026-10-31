// Produce a TEE-signed verdict bundle for one milestone (used by the CLI and the demo server).
import { NEARAI, answerOf, checkRequestShape, sha256hex, view } from './lib.mjs';

async function photoItem(data) {
  let mime = data.subarray(0, 4).toString('hex') === '89504e47' ? 'png' : 'jpeg';
  try { // shrink so a bundle fits into one NEAR transaction
    const sharp = (await import('sharp')).default;
    data = await sharp(data).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    mime = 'jpeg';
  } catch { /* sharp not installed: send as is */ }
  return `,{"type":"image_url","image_url":{"url":"data:image/${mime};base64,${data.toString('base64')}"}}`;
}

export async function makeEvidence({ project, milestone, kind = 'MILESTONE', photos, apiKey = process.env.NEARAI_API_KEY }) {
  if (!apiKey) throw new Error('NEARAI_API_KEY is not set');
  if (!photos?.length || photos.length > 6) throw new Error('send 1 to 6 photos');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'identity', 'x-no-aliasing': 'true' };
  const tpl = await view('request_template', { project_id: project, milestone_id: milestone, kind });
  const request = Buffer.from(tpl.prefix + (await Promise.all(photos.map(photoItem))).join('') + tpl.suffix);
  const shapeError = checkRequestShape(request, tpl);
  if (shapeError) throw new Error(shapeError);
  // a reasoning model occasionally spends its whole token budget thinking and returns no answer: ask again
  let response;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${NEARAI}/chat/completions`, { method: 'POST', headers, body: request });
    response = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new Error(`NEAR AI ${res.status}: ${response.toString().slice(0, 300)}`);
    try { answerOf(response); break; } catch { if (attempt >= 3) throw new Error('the inspector returned no verdict three times; try again'); }
  }
  const id = JSON.parse(response).id;
  let signature;
  for (let i = 0; i < 15 && !signature; i++) {
    const r = await fetch(`${NEARAI}/signature/${id}?signing_algo=ed25519`, { headers });
    const j = r.ok ? await r.json() : null;
    if (j?.signature) signature = j;
    else await new Promise((ok) => setTimeout(ok, 2000));
  }
  if (!signature) throw new Error('no TEE signature returned');
  if (signature.text !== `${tpl.model}:${sha256hex(request)}:${sha256hex(response)}`) throw new Error('signed text does not match our exact bytes');
  return { request, response, signature };
}
