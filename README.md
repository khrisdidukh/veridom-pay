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

## Repository

| Path | What |
|---|---|
| `contracts/veridom-pay` | Rust contract (near-sdk 5.5): escrow, TEE verdict verification, NEP-171 receivables, early-payment market, retainage |
| `contracts/veridom-pay-tests` | 12 tests incl. forged verdict, prompt injection, lenient prompt, wrong milestone, unknown signer |
| `verifier/` | Node tools: produce signed evidence (`make-evidence.mjs`), verify bundles offline (`verify-bundle.mjs`), submit (`submit.mjs`) |
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

## Honest limits

- A photo can be staged or taken elsewhere. The inspector rejects mismatched or partial evidence, but
  photo provenance (C2PA-signed camera captures, geotag checks) is the next step.
- The TEE signing key is registered by the contract owner after an off-chain DCAP check; verifying the
  TDX quote inside the contract is planned.
- Payments use native NEAR on testnet. Cross-chain payout to the contractor's preferred stablecoin uses
  NEAR Intents (1Click API), which has no testnet.
- Disputes after a contested approval go to an arbiter (`resolve_dispute`).
