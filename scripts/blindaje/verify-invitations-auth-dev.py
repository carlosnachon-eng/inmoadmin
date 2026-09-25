"""Explicit DEV-only E2E: real GoTrue sessions and real Preview endpoints.
Fixture JSON and Vercel cookie jar must be private local files, never committed.
Run after SQL fixture setup. Logouts and explicit DB cleanup are separate steps.
"""
import base64, datetime, hashlib, http.cookiejar, json, os, pathlib, subprocess, sys, urllib.error, urllib.request

root = pathlib.Path(sys.argv[1])
preview = sys.argv[2].rstrip('/')
assert preview.startswith('https://inmoadmin-') and preview.endswith('.vercel.app')
dev = 'https://hjfwjnejbcpmknvfpdcq.supabase.co'
fixtures = json.loads((root / 'fixtures.json').read_text())
assert all(f['email'].startswith('i2a0-qa-') and f['email'].endswith('@example.test') for f in fixtures.values())
key = (root / 'publishable-key.txt').read_text().strip()
jar = http.cookiejar.MozillaCookieJar(str(root / 'cookies.txt')); jar.load(ignore_discard=True)
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def call(url, body=None, method='POST', headers=None):
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
        method=method, headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with opener.open(request, timeout=35) as response: return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())

def private(name, value):
    path = root / name
    path.write_text(json.dumps(value)); os.chmod(path, 0o600)

sessions = {}
for role, fixture in fixtures.items():
    status, data = call(dev + '/auth/v1/token?grant_type=password', {'email': fixture['email'], 'password': fixture['password']}, headers={'apikey': key})
    assert status == 200, ('DEV real login failed', role, status)
    assert data['user']['id'] == fixture['user']
    sessions[role] = data['access_token']
    private('sessions.json', sessions)
    print('PASS real DEV password login Partner', role)

def api(path, body, actor=None, method='POST'):
    # Vercel interprets a custom Authorization header before its bypass cookie.
    # Its authenticated CLI adds the platform bypass independently of Partner JWT.
    private('request.json', body)
    header_path = root / 'request-header.txt'
    header_path.write_text('Authorization: Bearer ' + sessions.get(actor, actor) if actor else '')
    os.chmod(header_path, 0o600)
    command = [os.environ.get('PNPM_BIN', 'pnpm'), 'dlx', 'vercel', 'curl',
        '/api/partners/' + path, '--deployment', preview, '--', '--request', method,
        '--header', 'Content-Type: application/json', '--data-binary', '@' + str(root / 'request.json'),
        '--silent', '--write-out', '\n%{http_code}']
    if actor: command += ['--header', '@' + str(header_path)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, 'Authenticated Preview transport failed'
    payload, status = result.stdout.strip().rsplit('\n', 1)
    return int(status), json.loads(payload)

body = {'operation_id': fixtures['A']['operation'], 'role': 'inquilino'}
for actor in [None, 'invalid-bearer']:
    status, _ = api('invitations', body, actor)
    assert status == 401 and _ == {'error': 'No autorizado'}
    print('PASS missing/invalid session denied', status)
issued = {}
for role in ['inquilino', 'propietario']:
    status, data = api('invitations', {**body, 'role': role}, 'A')
    assert status == 201, ('own generation failed', status)
    token = data['token']
    assert len(base64.urlsafe_b64decode(token + '=')) == 32
    expiry = datetime.datetime.fromisoformat(data['expires_at'].replace('Z', '+00:00'))
    assert abs((expiry - datetime.datetime.now(datetime.timezone.utc)).total_seconds() - 30 * 86400) < 60
    issued[role] = data
    private('issued.json', issued)
    print('PASS real authenticated generation', role, '256 bits, 30 days', status)
status, _ = api('invitations', {'operation_id': fixtures['B']['operation'], 'role': 'inquilino'}, 'A')
assert status == 404
print('PASS real cross-agency generation denied', status)
status, _ = api('invitations', body, 'B', 'DELETE')
assert status == 404
print('PASS real cross-agency revocation denied', status)
responses = {}
for role, invitation in issued.items():
    status, data = api('invitation-public', {'token': invitation['token']})
    assert status == 200
    assert data == {'valid': True, 'role': role,
        'agency': {'nombre_comercial': 'I2A0-QA Agencia A', 'logo_url': None, 'brand_color': '#b91c3c'},
        'operation': {'direccion_inmueble': 'I2A0-QA Inmueble A', 'monto_renta': 15000,
            ('nombre_inquilino' if role == 'inquilino' else 'nombre_propietario'): 'I2A0-QA ' + ('Inquilino' if role == 'inquilino' else 'Propietario') + ' A'}}
    responses[role] = data
    print('PASS real public role allowlist', role)
status, _ = api('invitations', body, 'A', 'DELETE')
assert status == 200
revoked = api('invitation-public', {'token': issued['inquilino']['token']})
invalid = api('invitation-public', {'token': 'Z' * 43})
assert revoked == invalid and revoked[0] == 404
print('PASS real own revocation, uniform invalid/revoked', revoked[0])
evidence = {'public_responses': responses, 'tokens': {role: {'sha256': hashlib.sha256(data['token'].encode()).hexdigest(), 'expires_at': data['expires_at']} for role, data in issued.items()},
    'own_generation': 201, 'cross_generation': 404, 'cross_revocation': 404, 'own_revocation': 200, 'revoked_public': 404, 'no_session': 401, 'invalid_session': 401}
(root / 'evidence.json').write_text(json.dumps(evidence, indent=2))
print('PASS auth DEV E2E; SQL persistence checks and explicit cleanup required next')
