"""Real DEV-only E2E. Uses private I2A-QA fixture credentials and a Preview bypass cookie.
No Production hosts accepted. No service key is loaded; inserts use the DEV publishable key.
Keeps only synthetic fixtures for Preview review; records tokens in a private local file, never logs.
"""
import base64, hashlib, http.cookiejar, json, os, pathlib, subprocess, sys, urllib.error, urllib.request
root=pathlib.Path(sys.argv[1]); preview=sys.argv[2].rstrip('/')
assert preview.startswith('https://inmoadmin-') and preview.endswith('.vercel.app')
dev='https://hjfwjnejbcpmknvfpdcq.supabase.co'
fixtures=json.loads((root/'fixtures.json').read_text()); key=(root/'publishable-key.txt').read_text().strip()
jar=http.cookiejar.MozillaCookieJar(str(root/'cookies.txt'));jar.load(ignore_discard=True)
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def call(url, body=None, headers=None, raw=None):
    assert url.startswith(preview+'/') or url.startswith(dev+'/')
    req=urllib.request.Request(url,data=raw if raw is not None else json.dumps(body).encode(),method='POST',headers={'Content-Type':'application/json',**(headers or {})})
    try:
        with opener.open(req,timeout=60) as res: return res.status,json.loads(res.read() or b'null')
    except urllib.error.HTTPError as err: return err.code,json.loads(err.read())
def api(path,body):
    request_path=root/'request.json';request_path.write_text(json.dumps(body));request_path.chmod(0o600)
    command=[os.environ.get('PNPM_BIN','/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm'),'dlx','vercel','curl','/api/'+path,'--deployment',preview,'--','--request','POST','--header','Content-Type: application/json','--data-binary','@'+str(request_path),'--silent','--write-out','\\n%{http_code}']
    result=subprocess.run(command,capture_output=True,text=True,timeout=90)
    assert result.returncode==0,'Preview transport failed'
    payload,status=result.stdout.strip().rsplit('\n',1)
    return int(status),json.loads(payload)
def private(value):
    p=root/'issued.json';p.write_text(json.dumps(value));p.chmod(0o600)
if '--proof-only' in sys.argv:
    issued=json.loads((root/'issued.json').read_text())
else:
    issued={'b2c':{},'partner':{}}
    for role in ['inquilino','propietario']:
        status,claim=api('blindaje/b2c-submission-token',{'role':role});assert status==201,('claim',status)
        assert len(base64.urlsafe_b64decode(claim['token']+'='))==32
        assert claim['claim_hash']==hashlib.sha256(claim['token'].encode()).hexdigest()
        table='solicitudes_inquilino' if role=='inquilino' else 'propietarios_inmuebles'
        fields={'nombre_completo':'I2A-QA Real B2C inquilino'} if role=='inquilino' else {'nombre_propietario':'I2A-QA Real B2C propietario','direccion_inmueble':'I2A-QA dirección sintética'}
        payload={**fields,'origen_operacion':'b2c','blindaje_submission_claim_hash':claim['claim_hash']}
        status,inserted=call(dev+'/rest/v1/'+table+'?select=id',payload,{'apikey':key,'Prefer':'return=representation'})
        assert status==201,('real public insert',role,status)
        status,_=call(dev+'/rest/v1/'+table,payload,{'apikey':key});assert status==409,('unique claim',status)
        status,payment=api('blindaje/external-payment/bootstrap-b2c',{'token':claim['token'],'role':role});assert status==200,('b2c bootstrap',role,status)
        status,retry=api('blindaje/external-payment/bootstrap-b2c',{'token':claim['token'],'role':role});assert status==200 and payment['folio']==retry['folio']
        assert payment['payment_token']!=retry['payment_token']
        issued['b2c'][role]={'claim':claim,'record':inserted[0]['id'],'payment':payment,'retry':retry};private(issued)
        status,_=api('blindaje/external-payment/bootstrap-b2c',{'token':claim['token'],'role':role,'record_id':inserted[0]['id']});assert status==404
        print('PASS real DEV claim + public INSERT + duplicate rejection + B2C bootstrap/retry',role)
    assert issued['b2c']['inquilino']['payment']['folio']!=issued['b2c']['propietario']['payment']['folio']
    for role,item in fixtures['roles'].items():
        status,_=api('blindaje/external-payment/bootstrap-partner',{'invitation_token':item['invitation_token']});assert status==404
        table='solicitudes_inquilino' if role=='inquilino' else 'propietarios_inmuebles'
        fields={'nombre_completo':'I2A-QA Real Partner inquilino'} if role=='inquilino' else {'nombre_propietario':'I2A-QA Real Partner propietario','direccion_inmueble':'I2A-QA dirección sintética'}
        status,_=call(dev+'/rest/v1/'+table,{'id':item['record'],**fields,'origen_operacion':'partner'},{'apikey':key});assert status==201
        status,_=api('partners/link-submission-invited',{'token':item['invitation_token'],'tipo':role,'record_id':item['record']});assert status==200,('real I2A.0 link',role,status)
        status,payment=api('blindaje/external-payment/bootstrap-partner',{'invitation_token':item['invitation_token']});assert status==200
        issued['partner'][role]=payment;private(issued)
        print('PASS real DEV existing I2A.0 link + Partner bootstrap',role)
    assert issued['partner']['inquilino']['folio']==issued['partner']['propietario']['folio']
payment=issued['partner']['inquilino']; token=payment['payment_token']
status,context=api('blindaje/external-payment/payment-public',{'token':token});assert status==200
assert context=={'folio':payment['folio'],'amount':1000,'currency':'MXN','status':context['status'],'bank':{'banco':'I2A-QA Banco sintético','titular':'I2A-QA Cuenta de pruebas','clabe':'000000000000000000'}}
assert context['status'] in ['pending','proof_received']
(root/'public-response.json').write_text(json.dumps(context,indent=2,ensure_ascii=False))
print('PASS exact public projection and synthetic official bank lookup')
url=dev+'/functions/v1/blindaje-payment-proof'
headers={'Authorization':'Bearer '+token,'Content-Type':'application/pdf','X-Payer-Role':'tercero','X-Payer-Name':'I2A-QA','X-File-Name':'I2A-QA.pdf'}
pdf=b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
for data,mime in [(pdf,'image/png'),(b'invalid','application/pdf'),(pdf,'text/plain'),(pdf+b' '*(5*1024*1024+1-len(pdf)),'application/pdf')]:
    status,_=call(url,headers={**headers,'Content-Type':mime},raw=data);assert status==400,('invalid upload',mime,status)
    print('PASS denied proof',mime,'bytes',len(data),flush=True)
print('PASS Edge false MIME/magic and >5 MB denied')
for data,mime in [(pdf+b' '*(5*1024*1024-len(pdf)),'application/pdf'),((root/'I2A-QA.png').read_bytes(),'image/png'),((root/'I2A-QA.jpg').read_bytes(),'image/jpeg')]:
    status,result=call(url,headers={**headers,'Content-Type':mime},raw=data);assert status==200,('valid proof',mime,status,result)
    assert result=={'status':'proof_received'}
    print('PASS real Edge proof/replacement',mime,'bytes',len(data))
status,context=api('blindaje/external-payment/payment-public',{'token':issued['partner']['propietario']['payment_token']});assert status==200 and context['status']=='proof_received'
assert set(context)=={'folio','amount','currency','status','bank'}
print('PASS other Partner role sees same payment pending validation')
(root/'real-evidence.json').write_text(json.dumps({'b2c':{k:v['payment']['folio'] for k,v in issued['b2c'].items()},'partner_folio':payment['folio'],'public_response_after_proof':context,'edge_5mb':200,'edge_oversize':400},indent=2,ensure_ascii=False))
