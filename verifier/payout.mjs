// Mainnet stablecoin payout through NEAR Intents (1Click API): NEAR in, USDC out on the chain the payee chooses.
//
//   node payout.mjs keygen                          create a mainnet payout account (key stays in keys/, never printed)
//   node payout.mjs quote 1 sol:<address>           live quote, nothing moves
//   node payout.mjs send 1 sol:<address>            REAL MONEY: wraps 1 NEAR, deposits it to NEAR Intents, waits
//                                                   for USDC to land, saves a receipt in ../evidence/payouts/
// Chains: sol:<base58> · base:<0x…> · arb:<0x…> · near:<account.near>
import fs from 'node:fs';
import path from 'node:path';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, keyToImplicitAddress } from 'near-api-js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const KEYFILE = path.join(HERE, '..', 'keys', 'mainnet-payout.json');
const RECEIPTS = path.join(HERE, '..', 'evidence', 'payouts');
const RPC = process.env.NEAR_MAINNET_RPC || 'https://rpc.mainnet.fastnear.com';
const INTENTS = 'https://1click.chaindefuser.com/v0';
const WNEAR = 'wrap.near';
const DEST = {
  near: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
  sol: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
  base: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  arb: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
};
const TGAS = 10n ** 12n;
const yocto = (n) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n;
const fmt = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(4);
const headers = { 'Content-Type': 'application/json', ...(process.env.ONECLICK_JWT ? { Authorization: `Bearer ${process.env.ONECLICK_JWT}` } : {}) };

function payoutAccount() {
  if (!fs.existsSync(KEYFILE)) throw new Error('no payout account yet: run `node payout.mjs keygen` first');
  const k = JSON.parse(fs.readFileSync(KEYFILE, 'utf8'));
  return new Account(k.account_id, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(k.private_key));
}

async function quote(amountNear, target, refundTo, dry) {
  const [chain, ...rest] = target.split(':');
  const recipient = rest.join(':');
  if (!DEST[chain] || !recipient) throw new Error('target must look like sol:<address>, base:<0x…>, arb:<0x…> or near:<account>');
  const body = {
    dry, swapType: 'EXACT_INPUT', slippageTolerance: 100,
    originAsset: `nep141:${WNEAR}`, depositType: 'ORIGIN_CHAIN', amount: yocto(amountNear).toString(),
    destinationAsset: DEST[chain], recipient, recipientType: 'DESTINATION_CHAIN',
    refundTo, refundType: 'ORIGIN_CHAIN', deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
  const r = await fetch(`${INTENTS}/quote`, { method: 'POST', headers, body: JSON.stringify(body) });
  const q = await r.json();
  if (!r.ok || !q.quote) throw new Error(`quote failed: ${q.message || r.status}`);
  return q;
}

process.on('uncaughtException', (e) => { console.error('error:', e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('error:', e?.message || e); process.exit(1); });
const [cmd, amount, target] = process.argv.slice(2);

if (cmd === 'keygen') {
  if (fs.existsSync(KEYFILE)) {
    console.log('payout account already exists:', JSON.parse(fs.readFileSync(KEYFILE, 'utf8')).account_id);
  } else {
    const kp = KeyPair.fromRandom('ed25519');
    const id = keyToImplicitAddress(kp.getPublicKey());
    fs.mkdirSync(path.dirname(KEYFILE), { recursive: true });
    fs.writeFileSync(KEYFILE, JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
    console.log('mainnet payout account:', id);
    console.log('send it a little NEAR (the payout amount + 0.05 for fees); the private key stays in', KEYFILE);
  }
} else if (cmd === 'quote') {
  const refund = fs.existsSync(KEYFILE) ? JSON.parse(fs.readFileSync(KEYFILE, 'utf8')).account_id : 'intents.near';
  const q = (await quote(amount, target, refund, true)).quote;
  console.log(`${q.amountInFormatted} NEAR (≈ $${Number(q.amountInUsd).toFixed(2)}) -> ${q.amountOutFormatted} USDC, about ${q.timeEstimate} s. Nothing was sent.`);
} else if (cmd === 'send') {
  const acc = payoutAccount();
  const bal = await acc.getBalance().catch(() => 0n);
  const need = yocto(amount) + yocto(0.05);
  if (BigInt(bal) < need) throw new Error(`${acc.accountId} holds ${fmt(bal)} NEAR; needs ${fmt(need)} (amount + 0.05 for fees)`);
  const q = await quote(amount, target, acc.accountId, false);
  const dep = q.quote.depositAddress;
  console.log(`quote: ${q.quote.amountInFormatted} NEAR -> ${q.quote.amountOutFormatted} USDC; deposit address ${dep}`);
  // one transaction to wrap.near: wrap NEAR, register the deposit address, transfer the wNEAR to it
  const tx = await acc.signAndSendTransaction({
    receiverId: WNEAR,
    actions: [
      actions.functionCall('near_deposit', {}, 20n * TGAS, yocto(amount)),
      actions.functionCall('storage_deposit', { account_id: dep, registration_only: true }, 20n * TGAS, 1_250_000_000_000_000_000_000n),
      actions.functionCall('ft_transfer', { receiver_id: dep, amount: yocto(amount).toString(), memo: 'Veridom Pay payout' }, 30n * TGAS, 1n),
    ],
  });
  const txHash = tx.transaction.hash;
  console.log('deposit tx:', `https://nearblocks.io/txns/${txHash}`);
  await fetch(`${INTENTS}/deposit/submit`, { method: 'POST', headers, body: JSON.stringify({ txHash, depositAddress: dep }) }).catch(() => {});
  let st;
  for (let i = 0; i < 90; i++) {
    st = await (await fetch(`${INTENTS}/status?depositAddress=${dep}`, { headers })).json();
    if (['SUCCESS', 'REFUNDED', 'FAILED'].includes(st.status)) break;
    process.stdout.write(`  ${st.status}…\r`);
    await new Promise((ok) => setTimeout(ok, 4000));
  }
  console.log('\nstatus:', st.status);
  fs.mkdirSync(RECEIPTS, { recursive: true });
  const file = path.join(RECEIPTS, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ from: acc.accountId, to: target, quote: q.quote, deposit_tx: txHash, status: st }, null, 2));
  console.log('receipt:', file);
  for (const h of st.swapDetails?.destinationChainTxHashes || []) console.log('payout tx:', h.explorerUrl || h.hash);
} else {
  console.log('usage: node payout.mjs keygen | quote <NEAR> <chain:address> | send <NEAR> <chain:address>');
}
