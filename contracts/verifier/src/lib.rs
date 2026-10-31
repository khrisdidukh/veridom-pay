//! Spike: verify on-chain that a verdict really came from a NEAR AI Cloud TEE model.
//!
//! NEAR AI Cloud signs `<model>:<sha256(request bytes)>:<sha256(response bytes)>` with an
//! Ed25519 key that lives inside the model's TEE. The contract receives the exact request
//! and response bytes, recomputes both hashes, checks the signature against a registered
//! signer, then reads the verdict JSON out of the model's answer.
use near_sdk::json_types::Base64VecU8;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Verdict {
    pub milestone: String,
    pub verdict: String,
    pub model: String,
    pub request_hash: String,
    pub response_hash: String,
    pub signer: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    /// hex ed25519 public key -> model id it signs for (registered after off-chain attestation check)
    signers: LookupMap<String, String>,
    verdicts: LookupMap<String, Verdict>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Msg { content: Option<String> }
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Choice { message: Msg }
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Completion { choices: Vec<Choice> }
#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Answer { milestone: String, verdict: String }

fn verdict_json(content: &str) -> Answer {
    // the model may wrap JSON in whitespace or a code fence: take the outermost {...}
    let start = content.find('{').unwrap_or_else(|| env::panic_str("no JSON in answer"));
    let end = content.rfind('}').unwrap_or_else(|| env::panic_str("no JSON in answer"));
    serde_json::from_str(&content[start..=end]).unwrap_or_else(|_| env::panic_str("bad verdict JSON"))
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self { owner, signers: LookupMap::new(b"s"), verdicts: LookupMap::new(b"v") }
    }

    pub fn register_signer(&mut self, signer_hex: String, model: String) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
        require!(hex::decode(&signer_hex).map(|k| k.len() == 32).unwrap_or(false), "bad key");
        self.signers.insert(signer_hex, model);
    }

    pub fn submit_verdict(&mut self, request: Base64VecU8, response: Base64VecU8, signature_hex: String, signer_hex: String) -> Verdict {
        let model = self.signers.get(&signer_hex).cloned().unwrap_or_else(|| env::panic_str("unknown signer"));
        let rh = hex::encode(env::sha256(&request.0));
        let sh = hex::encode(env::sha256(&response.0));
        let text = format!("{model}:{rh}:{sh}");
        let sig: [u8; 64] = hex::decode(&signature_hex).ok().and_then(|v| v.try_into().ok()).unwrap_or_else(|| env::panic_str("bad signature"));
        let pk: [u8; 32] = hex::decode(&signer_hex).ok().and_then(|v| v.try_into().ok()).unwrap();
        require!(env::ed25519_verify(&sig, text.as_bytes(), &pk), "signature does not match request/response");
        let c: Completion = serde_json::from_slice(&response.0).unwrap_or_else(|_| env::panic_str("bad response JSON"));
        let content = c.choices.first().and_then(|ch| ch.message.content.clone()).unwrap_or_default();
        let a = verdict_json(&content);
        let v = Verdict { milestone: a.milestone.clone(), verdict: a.verdict, model, request_hash: rh, response_hash: sh, signer: signer_hex };
        self.verdicts.insert(a.milestone, v.clone());
        env::log_str(&format!("verified verdict {} for {}", v.verdict, v.milestone));
        v
    }

    pub fn get_verdict(&self, milestone: String) -> Option<Verdict> { self.verdicts.get(&milestone).cloned() }
}
