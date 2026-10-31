// Submit a signed bundle to the contract.
// usage: NEAR_ACCOUNT_ID=... NEAR_PRIVATE_KEY=ed25519:... node submit.mjs PROJECT MILESTONE BUNDLE_DIR [--defect]
import { Account, JsonRpcProvider, KeyPairSigner } from 'near-api-js';
import { CONTRACT, RPC, readBundle, view } from './lib.mjs';

const [project, milestone, dir, flag] = process.argv.slice(2);
const { request, response, signature } = readBundle(dir);
const account = new Account(process.env.NEAR_ACCOUNT_ID, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(process.env.NEAR_PRIVATE_KEY));
const verdict = await account.callFunction({
  contractId: CONTRACT,
  methodName: flag === '--defect' ? 'submit_defect_claim' : 'submit_evidence',
  args: { project_id: project, milestone_id: milestone, request: request.toString('base64'), response: response.toString('base64'), signature_hex: signature.signature, signer_hex: signature.signing_address },
  gas: 300_000_000_000_000n,
});
console.log(verdict);
const p = await view('get_project', { id: project });
console.log(p.milestones.map((m) => `${m.id}: ${m.status}`).join(' | '));
