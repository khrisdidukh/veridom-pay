"""Ask the private NEAR AI inspector to judge photos for one milestone and save the signed evidence bundle.

usage: python3 make_evidence.py TEMPLATE.json OUT_DIR photo1.jpg [photo2.jpg ...]
TEMPLATE.json is the contract's request_template(project_id, milestone_id) result.
Writes OUT_DIR/request.json, response.json, signature.json (exact bytes that the TEE signed).
"""
import base64, hashlib, io, json, os, sys, time, urllib.request

KEY = next(l.split('=', 1)[1].strip() for l in open(os.path.join(os.path.dirname(__file__), '.env')) if l.startswith('NEARAI_API_KEY='))
API = 'https://cloud-api.near.ai/v1'


def photo_b64(path):
    data = open(path, 'rb').read()
    mime = 'png' if data[:4] == b'\x89PNG' else 'webp' if data[8:12] == b'WEBP' else 'jpeg'
    try:  # shrink large photos so the bundle fits in one NEAR transaction
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert('RGB')
        im.thumbnail((1024, 1024))
        buf = io.BytesIO(); im.save(buf, 'JPEG', quality=82); data, mime = buf.getvalue(), 'jpeg'
    except Exception:
        pass
    return mime, base64.b64encode(data).decode()


def http(method, url, body=None):
    req = urllib.request.Request(url, data=body, method=method, headers={
        'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json', 'Accept': 'application/json',
        'Accept-Encoding': 'identity', 'x-no-aliasing': 'true'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def main():
    tpl, out, photos = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3:]
    os.makedirs(out, exist_ok=True)
    items = ''.join(',{"type":"image_url","image_url":{"url":"data:image/%s;base64,%s"}}' % photo_b64(p) for p in photos)
    request = (tpl['prefix'] + items + tpl['suffix']).encode()
    response = http('POST', f'{API}/chat/completions', request)
    chat_id = json.loads(response)['id']
    sig = None
    for _ in range(15):
        try:
            sig = json.loads(http('GET', f'{API}/signature/{chat_id}?signing_algo=ed25519'))
            if 'signature' in sig: break
        except Exception:
            pass
        time.sleep(2)
    assert sig and 'signature' in sig, 'no TEE signature returned'
    text = f"{tpl['model']}:{hashlib.sha256(request).hexdigest()}:{hashlib.sha256(response).hexdigest()}"
    assert sig['text'] == text, 'signed text does not match our exact bytes'
    open(os.path.join(out, 'request.json'), 'wb').write(request)
    open(os.path.join(out, 'response.json'), 'wb').write(response)
    json.dump(sig, open(os.path.join(out, 'signature.json'), 'w'))
    answer = json.loads(response)['choices'][0]['message']['content']
    print('request', len(request), 'bytes; verdict:', answer.strip()[:400])


if __name__ == '__main__':
    main()
