#!/usr/local/bin/python

import StringIO
import unicodecsv
import requests
import zulip
import time
import os

login = {'username':'fhir_bot','password':os.environ['GFORGE_PASSWORD']}
TIMEOUT = os.environ.get('GFORGE_TIMEOUT', '50')
TIMEOUT = int(TIMEOUT)

session = requests.Session()
print "Boot"

zulip_client = zulip.Client(
    site='https://chat.fhir.org',
    api_key=os.environ['ZULIP_API_KEY'],
    email=os.environ['ZULIP_EMAIL'])


def read_issues(s):
    print "login"
    s.post('https://gforge.hl7.org/gf/account/?action=LoginAction',data=login, timeout=TIMEOUT)
    print "get issues"
    changes = s.get('https://gforge.hl7.org/gf/project/fhir/tracker/?action=TrackerQueryCSV&tracker_id=677&tracker_query_id=143', timeout=TIMEOUT)
    reader = unicodecsv.reader(StringIO.StringIO(changes.text.encode("utf-8")), encoding='utf-8')
    reader.next()
    print "read all issues"
    return {
        int(row[0]): (int(row[0]), row[1], row[5]) for row in reader
        #'TrackerItemID', 'Summary', 'Submitted By'
    }

def post_issue(issue):
    zulip_client.send_message({
        "type": 'stream',
        "content": "GF#%s: **%s** posted by `%s`" % (
                issue[0],
                issue[1],
                issue[2]),
        "subject": "tracker-item",
        "to": "committers",
    })

posted_issues = read_issues(session)
last_synced_issue = os.environ.get('LAST_SYNCED_ISSUE')
if last_synced_issue:
  last_synced_issue = int(last_synced_issue)
  existing = list(posted_issues)
  for p in existing:
    if p > last_synced_issue:
      del posted_issues[p]

while True:
    print "About to issues"
    try:
        issues = read_issues(session)
    except:
        print "GForge fetch failed; sleeping"
        time.sleep(60)
        continue
    print "got issues: %s"%(len(posted_issues))
    for issue_number, issue in issues.iteritems():
        if issue_number > max(posted_issues.keys()):
            post_issue(issue)
    posted_issues.update(issues)
    print "Max %s"%(max(posted_issues.keys()))
    time.sleep(60)
