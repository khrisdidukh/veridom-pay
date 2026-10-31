# Veridom Pay — construction milestones, paid on proof

Small contractors finish the work and then wait 30–90 days to be paid, while part of every
invoice (retainage, *Haftrücklass*) is held back for years. Homeowners pay in advance and hope.
Veridom Pay replaces "trust me" with proof that a contract can check:

1. The homeowner funds every milestone into a NEAR contract.
2. The contractor sends site photos. A **private AI inspector** (NEAR AI Cloud, model `Qwen/Qwen3.8-27B`
   running in a **TEE**) judges them against the milestone's acceptance criteria and signs its answer
   *inside the enclave*.
3. The **contract verifies that signature itself** — ed25519 over
   `<model>:<sha256(request bytes)>:<sha256(response bytes)>` — checks that the request is exactly
   the on-chain inspection prompt for that milestone (only photos may vary), and reads the verdict.
4. An approved milestone becomes a **receivable NFT** (NEP-171). The contractor can sell it to an
   investor at a small discount and get cash today. After the homeowner's review window, escrow pays
   whoever holds the NFT.
5. Retainage stays in the contract until the warranty ends and goes back to the contractor —
   unless the homeowner proves a defect through the same verified-AI pipeline.

Veridom Pay is the payments module of [Veridom](https://veridom.space), a live house-building control app for
private builders in Austria and Ukraine. This hackathon build is new code written for NEAR HACKATHON
(1–14 Nov 2026).

**Tracks:** Real-World Money · Privacy & Private AI · NFTs That Do Something · AI Security & Defense

**Live demo:** https://veridom-pay.onrender.com. Switch between homeowner, contractor and investor, upload
site photos for a real TEE inspection, buy a receivable, and check any verdict's proof in your browser.
(Free hosting: the first load after a quiet period takes about 40 seconds.)

## Try it in two minutes

The demo site holds three testnet accounts. You switch between them with the role buttons at the top.

1. Open https://veridom-pay.onrender.com. Pick project **VIENNA-02**, then milestone **Floor tiling**.
   → The money trail is complete: escrow, receivable NFT, sold early to the investor, paid out by escrow.
2. Press **Check this verdict in your browser** under the APPROVED stamp.
   → Green checks computed in your browser:
   - the photos are extracted from the signed request and re-hashed;
   - the request matches the on-chain inspection prompt;
   - the enclave's ed25519 signature is valid.
3. As **Homeowner**, press **New project**, add a milestone with acceptance criteria, then **Fund and create**.
   → A real testnet transaction locks the money in escrow.
4. As **Contractor**, open that milestone, choose one to six site photos, then **Send for inspection**.
   → In about 40 seconds a stamp lands: APPROVED, REJECTED or NEEDS MORE EVIDENCE, with findings. Try a
   photo that doesn't match the criteria: the inspector is strict.
5. If it was approved, press **Sell receivable now** (97%). Then switch to **Investor** and press **Buy**.
   → The NFT changes hands and the contractor has cash before the review window ends.
6. Under **Get paid in a stablecoin, on any chain**, pick USDC on Solana, Base, Arbitrum or NEAR, paste an
   address and press **Get a live quote**.
   → A live mainnet quote from NEAR Intents: how much USDC the receivable's holder would receive, and in
   how many seconds. Nothing moves.
7. Offline: `cd verifier && npm install && npm test`
   → Every bundle in `evidence/` verifies, and every altered or forged one fails.

## Getting paid where the money is useful

**Real money, on mainnet (31 Oct 2026):** 5 USDC sent from a Solana wallet (Phantom) arrived as **4.994 USDC
on NEAR** in about 10 seconds, through the same NEAR Intents rail the app uses.
- Solana deposit: [solscan](https://solscan.io/tx/rHKMHbzvx7m4fweosYc69wwUFVYQkk66Q5btDPPcuST8jg2SQdqk7amGDrgPCxPq4MEdtMvzsL5yDVJ63vxfU48)
- NEAR settlement: [nearblocks](https://nearblocks.io/txns/8nmeStktAyUiHKzn1rz2f6aRdp8shLkn3SEzbng1gd6x)
- Receipt: [`evidence/payouts/`](evidence/payouts)

A contractor in Ukraine or Austria doesn't want NEAR; they want dollars they can spend. When escrow pays a
receivable, NEAR Intents can deliver it as USDC on the payee's chain. The app shows a live mainnet quote
for the milestone's payout, and `verifier/payout.mjs` executes it:

```bash
cd verifier
node payout.mjs quote 0.95 sol:<your Solana address>   # live quote, nothing moves
node payout.mjs keygen                                 # mainnet payout account; the key stays in keys/
node payout.mjs send 0.95 sol:<your Solana address>    # real: wrap → deposit to the intent → USDC lands, receipt saved
```

## What is verified, by whom

| Claim | Checked by |
|---|---|
| The verdict came from the TEE model, unchanged | the contract (`env::ed25519_verify` + `env::sha256` over the exact bytes) |
| The model was given the strict inspection prompt for *this* milestone, not a lenient one, and no injected text | the contract (byte-exact prefix/suffix; the middle may contain only `data:image/...;base64` items — base64 cannot contain a quote, so nothing can be smuggled in) |
| The verdict is about this project and milestone | the contract (answer JSON must name both) |
| The signing key lives in a genuine, up-to-date Intel TDX enclave | `tools/attest.py`: DCAP quote verification (Phala `dcap-qvl`), TCB status `UpToDate`, `report_data = signing key ‖ fresh nonce`; the contract owner registers the key with the quote hash |
| Any past verdict | anyone, in the browser: the web app re-hashes the stored bytes and checks the signature without trusting the server |

The inspector is strict by design. Real results from 31 Oct 2026 (bundles in [`evidence/`](evidence)):

| Photos | Verdict |
|---|---|
| open metal-stud framing for a "drywall" milestone | **REJECTED** — "metal stud framing is fully exposed" |
| bathroom with bare screed for a "floor tiling" milestone | **REJECTED** |
| tiles still in leveling clips, joints open | **REJECTED** — saw the clips and the open joints |
| two photos of *different* floors passed off as one | **NEEDS_MORE_EVIDENCE** — "different tile formats… implying different areas" |
| a wide shot of a finished, grouted floor | **APPROVED** → receivable minted → sold at 97% → investor paid at settlement |
| close-ups of a real terrazzo floor, judged against "the whole floor is finished" | **NEEDS_MORE_EVIDENCE** — close-ups can't show the whole room |
| the same close-ups, with criteria scoped to the photographed section | **APPROVED** |

## Repository

| Path | What |
|---|---|
| `contracts/veridom-pay` | Rust contract (near-sdk 5.5): escrow, TEE verdict verification, NEP-171 receivables, early-payment market, retainage |
| `contracts/veridom-pay-tests` | 12 tests incl. forged verdict, prompt injection, lenient prompt, wrong milestone, unknown signer |
| `verifier/` | Node tools: produce signed evidence (`make-evidence.mjs`), verify bundles offline (`verify-bundle.mjs`), submit (`submit.mjs`), and the mainnet stablecoin payout through NEAR Intents (`payout.mjs`) |
| `server/` | Demo API: three testnet role accounts, photo inspection, market actions; serves the web app |
| `web/` | React app: inspection sheet, money trail, in-browser proof check |
| `evidence/` | Real signed request/response/signature bundles (photos from Wikimedia Commons, credits inside) |
| `tools/` | `attest.py` (TDX attestation check), `make_evidence.py` (first prototype) |

## Run it

Requirements: Node ≥ 20, Rust with the `1.81.0` toolchain (`rustup toolchain install 1.81.0 --target wasm32-unknown-unknown`).

```bash
# 1. Contract tests (no network)
cd contracts/veridom-pay-tests && cargo test

# 2. Re-verify the real TEE-signed verdicts offline (no API key)
cd verifier && npm install && npm test && npm run verify

# 3. Build the contract wasm (Rust 1.81: newer compilers emit wasm features NEAR rejects)
cd contracts/veridom-pay && cargo +1.81.0 build --release --target wasm32-unknown-unknown

# 4. Web app + demo server against the live testnet contract
cd web && npm install && npm run build
cd ../server && npm install && npm start      # http://localhost:8787
```

New inspections need a NEAR AI Cloud key in `.env` (`NEARAI_API_KEY=...`) and demo account keys
(`VP_ACCOUNTS` JSON or `keys/vp-<role>-*.json`). Without them the app still shows the live contract state
and lets you verify every verdict.

Live testnet contract: [`vp-vpay-2158.testnet`](https://testnet.nearblocks.io/address/vp-vpay-2158.testnet)

## What is new, what came before, what it uses

Built in the hackathon window (from 19 Oct 2026): everything in this repository.
- The contracts and tests, the verifier, the server and the web app.
- All on-chain projects and evidence bundles.
- Veridom (veridom.space) is my existing house-building control app on the web. No code from it is used
  here; Veridom Pay is its new payments module, built for NEAR.

Libraries and services:
- near-sdk and near-contract-standards 5.5 (NEP-171), serde_json, hex;
- near-api-js 7.4, express, multer, sharp;
- React 18, Vite, `@noble/curves`;
- `dcap-qvl` (attestation check);
- NEAR AI Cloud (`Qwen/Qwen3.8-27B` in a TEE);
- Google Fonts (Archivo, JetBrains Mono).

Demo photos: Wikimedia Commons (credits in `evidence/README.md`) and my own photos of a terrazzo floor.
Code was written with AI assistance (Claude).

## Honest limits

- A photo can be staged or taken elsewhere. The inspector rejects mismatched or partial evidence, but
  photo provenance (C2PA-signed camera captures, geotag checks) is the next step.
- The TEE signing key is registered by the contract owner after an off-chain DCAP check; verifying the
  TDX quote inside the contract is planned.
- Escrow runs in native NEAR on testnet. The payout leg is real and mainnet-only:
  - the app quotes the holder's payout in USDC on Solana, Base, Arbitrum or NEAR via NEAR Intents (1Click API);
  - `verifier/payout.mjs send` performs the actual swap and transfer from a mainnet payout account,
    wrapping NEAR and depositing it to the intent;
  - a real 5 USDC Solana → NEAR transfer went through on mainnet (links above);
  - NEAR Intents has no testnet, so the testnet escrow and the mainnet rail are not yet joined in one
    contract call.
- Disputes after a contested approval go to an arbiter (`resolve_dispute`).

## The other project in this submission

[Throughput Treasury](https://github.com/khrisdidukh/throughput-treasury): an autonomous business treasury
that only pays for work at the constraint. A private AI CFO in a TEE judges each vendor offer against the
business's real flow, and the contract verifies its signature and enforces hard money rules. Live demo:
https://throughput-treasury.onrender.com

Built by Khrystyna Didukh for NEAR HACKATHON 2026 (1–14 Nov). MIT licence.
