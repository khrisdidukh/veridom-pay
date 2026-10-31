import { ed25519 } from '@noble/curves/ed25519';

export interface Bundle { request: Uint8Array; response: Uint8Array; signature: { text: string; signature: string; signing_address: string; signing_algo: string } }
export interface Step { label: string; ok: boolean; detail: string }

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));
export const sha256hex = async (b: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", b as BufferSource));

const cache = new Map<string, Promise<Bundle>>();
export function fetchBundle(responseHash: string): Promise<Bundle> {
  if (!cache.has(responseHash)) {
    const get = (f: string) => fetch(`/api/bundle/${responseHash}/${f}`).then((r) => { if (!r.ok) throw new Error('evidence not stored on this server'); return r.arrayBuffer(); });
    cache.set(responseHash, Promise.all([get('request.json'), get('response.json'), get('signature.json')]).then(([q, a, s]) => ({
      request: new Uint8Array(q), response: new Uint8Array(a), signature: JSON.parse(new TextDecoder().decode(s)),
    })));
  }
  return cache.get(responseHash)!;
}

/** The photos are taken from the exact request bytes the enclave signed. */
export function photosOf(b: Bundle): string[] {
  const text = new TextDecoder().decode(b.request);
  return [...text.matchAll(/"url":"(data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+)"/g)].map((m) => m[1]);
}

export async function verifyInBrowser(b: Bundle, onChain: { request_hash: string; response_hash: string; signer: string; model: string }): Promise<Step[]> {
  const rh = await sha256hex(b.request);
  const sh = await sha256hex(b.response);
  const text = `${onChain.model}:${rh}:${sh}`;
  let sigOk = false;
  try { sigOk = ed25519.verify(unhex(b.signature.signature), new TextEncoder().encode(text), unhex(onChain.signer)); } catch { sigOk = false; }
  return [
    { label: 'Photos and inspection prompt match the hash stored on-chain', ok: rh === onChain.request_hash, detail: `sha256 ${rh}` },
    { label: 'AI answer matches the hash stored on-chain', ok: sh === onChain.response_hash, detail: `sha256 ${sh}` },
    { label: 'Enclave signature is valid for exactly these bytes', ok: sigOk, detail: `ed25519 over "${onChain.model}:${rh.slice(0, 8)}…:${sh.slice(0, 8)}…"` },
    { label: 'Signer is the enclave key the contract accepts', ok: b.signature.signing_address === onChain.signer, detail: onChain.signer },
  ];
}
