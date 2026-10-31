// Veridom Pay demo server.
// - Holds three demo testnet accounts (client, contractor, investor) so judges can click through every role.
// - Runs the private NEAR AI inspection for uploaded photos and submits the signed verdict on-chain.
// - Serves signed evidence bundles so the browser can re-verify every verdict itself.
// env: NEARAI_API_KEY, VP_ACCOUNTS (JSON {role:{account_id,private_key}}) or ../keys/vp-<role>-*.json, VERIDOM_CONTRACT, PORT
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { Account, JsonRpcProvider, KeyPairSigner } from 'near-api-js';
import { CONTRACT, RPC, sha256hex, view } from '../verifier/lib.mjs';
import { makeEvidence } from '../verifier/evidence.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
// load ../.env (NEARAI_API_KEY=...) without extra dependencies
for (const line of fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n') : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const STORE = process.env.BUNDLE_DIR || path.join(ROOT, 'server', 'data', 'bundles');
const ROLES = ['client', 'contractor', 'investor'];
const provider = new JsonRpcProvider({ url: RPC });

function loadAccounts() {
  if (process.env.VP_ACCOUNTS) return JSON.parse(process.env.VP_ACCOUNTS);
  const dir = path.join(ROOT, 'keys');
  const out = {};
  for (const role of ROLES) {
    const f = fs.readdirSync(dir).find((x) => x.startsWith(`vp-${role}-`));
    if (f) out[role] = JSON.parse(fs.readFileSync(path.join(dir, f)));
  }
  return out;
}
const KEYS = loadAccounts();
const accounts = Object.fromEntries(Object.entries(KEYS).map(([r, k]) => [r, new Account(k.account_id, provider, KeyPairSigner.fromSecretKey(k.private_key))]));
const idOf = (role) => KEYS[role]?.account_id;

// ---- evidence store: bundles by response hash (seeded with the repo's real bundles)
fs.mkdirSync(STORE, { recursive: true });
function saveBundle(b) {
  const h = sha256hex(b.response);
  const d = path.join(STORE, h);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'request.json'), b.request);
  fs.writeFileSync(path.join(d, 'response.json'), b.response);
  fs.writeFileSync(path.join(d, 'signature.json'), JSON.stringify(b.signature));
  return h;
}
for (const d of fs.existsSync(path.join(ROOT, 'evidence')) ? fs.readdirSync(path.join(ROOT, 'evidence')) : []) {
  const p = path.join(ROOT, 'evidence', d);
  if (fs.existsSync(path.join(p, 'response.json'))) {
    saveBundle({ request: fs.readFileSync(path.join(p, 'request.json')), response: fs.readFileSync(path.join(p, 'response.json')), signature: JSON.parse(fs.readFileSync(path.join(p, 'signature.json'))) });
  }
}

const call = (role, methodName, args, deposit = 0n) => {
  const a = accounts[role];
  if (!a) throw new Error(`no ${role} account configured`);
  return a.callFunction({ contractId: CONTRACT, methodName, args, gas: 300_000_000_000_000n, deposit });
};
const balance = async (id) => (await provider.viewAccount({ accountId: id })).amount.toString();

const app = express();
app.use(express.json({ limit: '1mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 6 } });
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (e) { res.status(400).json({ error: cleanError(e) }); }
};
function cleanError(e) {
  const s = String(e?.message || e);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/) || s.match(/panicked at[^:]*: ([^"\\]+)/);
  return m ? m[1] : s.slice(0, 400);
}

app.get('/api/config', wrap(async () => ({
  contract: CONTRACT, rpc: RPC, explorer: 'https://testnet.nearblocks.io',
  roles: Object.fromEntries(await Promise.all(ROLES.filter(idOf).map(async (r) => [r, { account_id: idOf(r), balance: await balance(idOf(r)) }]))),
  ai: { model: 'Qwen/Qwen3.8-27B', privacy: 'Private TEE on NEAR AI Cloud, signing key attested by an Intel TDX quote', canInspect: Boolean(process.env.NEARAI_API_KEY) },
})));

app.get('/api/projects', wrap(async () => {
  const projects = await view('list_projects');
  const listings = Object.fromEntries((await view('get_listings')).map(([t, l]) => [t, l]));
  const owners = {};
  for (const p of projects) for (const m of p.milestones) if (m.token_id) owners[m.token_id] = (await view('nft_token', { token_id: m.token_id }))?.owner_id;
  return { projects, listings, owners };
}));

app.get('/api/bundle/:hash/:file', (req, res) => {
  const { hash, file } = req.params;
  if (!/^[0-9a-f]{64}$/.test(hash) || !['request.json', 'response.json', 'signature.json'].includes(file)) return res.status(404).end();
  const p = path.join(STORE, hash, file);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'bundle not stored on this server' });
  res.type('application/octet-stream').send(fs.readFileSync(p));
});

app.post('/api/projects', wrap(async (req) => {
  const { id, title_milestones, retainage_bps = 500, review_period_secs = 300, warranty_secs = 900 } = req.body;
  const milestones = (title_milestones || []).map((m, i) => ({ id: `M${i + 1}`, title: m.title, criteria: m.criteria, amount: (BigInt(Math.round(Number(m.amount_near) * 1e6)) * 10n ** 18n).toString() }));
  const total = milestones.reduce((s, m) => s + BigInt(m.amount), 0n);
  return call('client', 'create_project', { id, contractor: idOf('contractor'), retainage_bps, review_period_secs, warranty_secs, milestones }, total);
}));

app.post('/api/inspect', upload.array('photos', 6), wrap(async (req) => {
  const { project, milestone, role = 'contractor', kind = 'MILESTONE' } = req.body;
  const bundle = await makeEvidence({ project, milestone, kind, photos: req.files.map((f) => f.buffer) });
  const hash = saveBundle(bundle);
  const args = { project_id: project, milestone_id: milestone, request: bundle.request.toString('base64'), response: bundle.response.toString('base64'), signature_hex: bundle.signature.signature, signer_hex: bundle.signature.signing_address };
  const verdict = await call(role, kind === 'DEFECT' ? 'submit_defect_claim' : 'submit_evidence', args);
  return { verdict, bundle: hash };
}));

app.post('/api/list', wrap(async (req) => call('contractor', 'list_receivable', { token_id: req.body.token_id, price: req.body.price })));
app.post('/api/buy', wrap(async (req) => {
  const l = (await view('get_listings')).find(([t]) => t === req.body.token_id);
  if (!l) throw new Error('not listed');
  await call('investor', 'buy_receivable', { token_id: req.body.token_id }, BigInt(l[1].price));
  return { ok: true };
}));
// Stablecoin payout rail via NEAR Intents (1Click API). Live mainnet quote for the holder's payout; no funds move here.
const INTENTS = 'https://1click.chaindefuser.com/v0';
const PAYOUT = {
  near: { asset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', label: 'USDC on NEAR', ok: (a) => /^([a-z0-9_-]+\.)*[a-z0-9_-]+\.near$|^[0-9a-f]{64}$/.test(a) },
  sol: { asset: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', label: 'USDC on Solana', ok: (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) },
  base: { asset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', label: 'USDC on Base', ok: (a) => /^0x[0-9a-fA-F]{40}$/.test(a) },
  arb: { asset: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', label: 'USDC on Arbitrum', ok: (a) => /^0x[0-9a-fA-F]{40}$/.test(a) },
};
app.post('/api/payout-quote', wrap(async (req) => {
  const { chain, recipient, amount } = req.body;
  const dest = PAYOUT[chain];
  if (!dest) throw new Error('Pick where the money should land.');
  if (!dest.ok(String(recipient || '').trim())) throw new Error(`That is not a valid address for ${dest.label}.`);
  if (!/^\d+$/.test(String(amount)) || BigInt(amount) <= 0n || BigInt(amount) > 1000n * 10n ** 24n) throw new Error('bad amount');
  const body = {
    dry: true, swapType: 'EXACT_INPUT', slippageTolerance: 100,
    originAsset: 'nep141:wrap.near', depositType: 'ORIGIN_CHAIN', amount: String(amount),
    destinationAsset: dest.asset, recipient: String(recipient).trim(), recipientType: 'DESTINATION_CHAIN',
    refundTo: process.env.PAYOUT_REFUND_ACCOUNT || 'intents.near', refundType: 'ORIGIN_CHAIN',
    deadline: new Date(Date.now() + 3_600_000).toISOString(),
  };
  const r = await fetch(`${INTENTS}/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.ONECLICK_JWT ? { Authorization: `Bearer ${process.env.ONECLICK_JWT}` } : {}) }, body: JSON.stringify(body) });
  const q = await r.json();
  if (!r.ok || !q.quote) throw new Error(`NEAR Intents could not quote this payout: ${q.message || r.status}`);
  return { label: dest.label, amountIn: q.quote.amountInFormatted, amountInUsd: q.quote.amountInUsd, amountOut: q.quote.amountOutFormatted, minAmountOut: q.quote.minAmountOut, timeEstimate: q.quote.timeEstimate, at: new Date().toISOString() };
}));

app.post('/api/settle', wrap(async (req) => { await call(req.body.role || 'investor', 'settle', { project_id: req.body.project, milestone_id: req.body.milestone }); return { ok: true }; }));
app.post('/api/release-retainage', wrap(async (req) => { await call('contractor', 'release_retainage', { project_id: req.body.project }); return { ok: true }; }));

const web = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(web)) {
  app.use(express.static(web));
  app.get(/^\/(?!api).*/, (_q, res) => res.sendFile(path.join(web, 'index.html')));
}
const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`Veridom Pay demo on http://localhost:${port} (contract ${CONTRACT})`));
