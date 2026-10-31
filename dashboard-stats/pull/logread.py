#!/usr/bin/env python3
"""Fast read-only Cloud Logging entries.list via REST (gcloud CLI is CPU-bound on big entries).
Usage: logread.py FILTER [FIELDS] > out.ndjson   (FIELDS = partial-response mask for entries, optional)
Paces requests to stay under the 60 req/min read quota."""
import sys, json, subprocess, urllib.request, time
filt = sys.argv[1]; fields = sys.argv[2] if len(sys.argv) > 2 else None
tok = subprocess.check_output(['gcloud','auth','print-access-token']).decode().strip(); t0=time.time()
import os
body = {'resourceNames':['projects/'+os.environ.get('GCP_PROJECT','fhir-org-starter-project')],'filter':filt,'orderBy':'timestamp asc','pageSize':1000}
url = 'https://logging.googleapis.com/v2/entries:list'
if fields: url += '?fields=nextPageToken,' + urllib.request.quote(f'entries({fields})')
n=0
while True:
    if time.time()-t0 > 3000:
        tok = subprocess.check_output(['gcloud','auth','print-access-token']).decode().strip(); t0=time.time()
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Authorization':'Bearer '+tok,'Content-Type':'application/json'})
            r = json.load(urllib.request.urlopen(req, timeout=120)); break
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(30*(attempt+1)); continue
            sys.stderr.write(e.read().decode()[:500]); raise
    for e in r.get('entries', []):
        print(json.dumps(e)); n+=1
    if not r.get('nextPageToken'): break
    body['pageToken'] = r['nextPageToken']; time.sleep(1.2)
print(f'{n} entries', file=sys.stderr)
