"""Prove that a NEAR AI Cloud model's signing key lives inside a genuine, up-to-date Intel TDX enclave.

usage: python3 attest.py [MODEL]   (default Qwen/Qwen3.8-27B)
1. asks NEAR AI Cloud for the model's attestation with a fresh random nonce
2. verifies the Intel TDX quote with Phala's dcap-qvl (Intel collateral, TCB status)
3. checks quote report_data == signing_key (32 bytes) || our nonce (32 bytes)
Prints the attested ed25519 signing key and the sha256 of the quote, which the Veridom Pay
contract stores in register_signer(signer_hex, quote_sha256).
"""
import asyncio, hashlib, json, os, secrets, sys, urllib.parse, urllib.request

import dcap_qvl  # pip install dcap-qvl

MODEL = sys.argv[1] if len(sys.argv) > 1 else 'Qwen/Qwen3.8-27B'
KEY = next(l.split('=', 1)[1].strip() for l in open(os.path.join(os.path.dirname(__file__), '.env')) if l.startswith('NEARAI_API_KEY='))


def find(o, key):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == key:
                return v
            r = find(v, key)
            if r is not None:
                return r
    if isinstance(o, list):
        for v in o:
            r = find(v, key)
            if r is not None:
                return r


nonce = secrets.token_hex(32)
q = urllib.parse.urlencode({'model': MODEL, 'provider': 'near', 'signing_algo': 'ed25519', 'nonce': nonce, 'include_tls_fingerprint': 'false'})
req = urllib.request.Request(f'https://cloud-api.near.ai/v1/attestation/report?{q}', headers={
    'Authorization': f'Bearer {KEY}', 'Accept': 'application/json', 'x-no-aliasing': 'true'})
att = json.load(urllib.request.urlopen(req, timeout=60))
cands = att.get('model_attestations') or []
assert cands, 'no NEAR model attestation returned'
for m in cands:
    quote = bytes.fromhex(m['intel_quote'])
    verified = asyncio.run(dcap_qvl.get_collateral_and_verify(quote))
    rd = find(json.loads(verified.to_json()), 'report_data')
    rd = bytes(rd) if isinstance(rd, list) else bytes.fromhex(str(rd).removeprefix('0x'))
    expected = bytes.fromhex(m['signing_address']).ljust(32, b'\0') + bytes.fromhex(nonce)
    ok = verified.status == 'UpToDate' and rd == expected and m['request_nonce'] == nonce
    print(json.dumps({
        'model': MODEL, 'tcb_status': verified.status, 'advisories': verified.advisory_ids,
        'report_data_binds_key_and_nonce': rd == expected, 'nonce_echoed': m['request_nonce'] == nonce,
        'signer_hex': m['signing_address'], 'quote_sha256': hashlib.sha256(quote).hexdigest(), 'ATTESTED': ok}, indent=1))
