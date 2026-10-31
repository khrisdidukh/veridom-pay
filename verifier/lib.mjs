import crypto from 'node:crypto';
import fs from 'node:fs';

export const RPC = process.env.NEAR_RPC || 'https://rpc.testnet.fastnear.com';
export const CONTRACT = process.env.VERIDOM_CONTRACT || 'vp-vpay-2158.testnet';
export const NEARAI = 'https://cloud-api.near.ai/v1';

export const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** ed25519 verify with a raw 32-byte public key (hex), using Node's built-in crypto. */
export function ed25519Verify(pubHex, message, sigHex) {
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pubHex, 'hex')]);
  const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  return crypto.verify(null, Buffer.from(message), key, Buffer.from(sigHex, 'hex'));
}

export async function view(method, args = {}) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'query',
      params: { request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') },
    }),
  });
  const j = await r.json();
  if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error || j.result.error));
  return JSON.parse(Buffer.from(j.result.result).toString());
}

/** Same structural check the contract does: prefix + only data-URI photos + suffix. */
export function checkRequestShape(request, template) {
  const s = request.toString('latin1');
  if (!s.startsWith(template.prefix)) return 'request is not the on-chain inspection prompt';
  if (!s.endsWith(template.suffix)) return 'unexpected trailing content';
  const mid = s.slice(template.prefix.length, s.length - template.suffix.length);
  const item = /^,\{"type":"image_url","image_url":\{"url":"data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+"\}\}/;
  let rest = mid, n = 0;
  while (rest.length) {
    const m = rest.match(item);
    if (!m) return 'request contains something other than photos';
    rest = rest.slice(m[0].length);
    n++;
  }
  return n >= 1 && n <= 6 ? null : 'need 1 to 6 photos';
}

export function readBundle(dir) {
  return {
    request: fs.readFileSync(`${dir}/request.json`),
    response: fs.readFileSync(`${dir}/response.json`),
    signature: JSON.parse(fs.readFileSync(`${dir}/signature.json`)),
  };
}

export function answerOf(response) {
  const content = JSON.parse(response).choices[0].message.content || '';
  return JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
}
