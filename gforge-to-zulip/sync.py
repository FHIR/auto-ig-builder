#!/usr/bin/python

import StringIO
import unicodecsv
import requests
import zulip
import time
import os

login = {'username':'fhir_bot','password':os.environ['GFORGE_PASSWORD']}
session = requests.Session()

zulip_client = zulip.Client(
    site='https://chat.fhir.org',
    api_key=os.environ['ZULIP_API_KEY'],
    email=os.environ['ZULIP_EMAIL'])


def read_issues(s):
    s.post('http://gforge.hl7.org/gf/account/?action=LoginAction',data=login)
    changes = s.get('http://gforge.hl7.org/gf/project/fhir/tracker/?action=TrackerQueryCSV&tracker_id=677&tracker_query_id=143')
    reader = unicodecsv.reader(StringIO.StringIO(changes.text.encode("utf-8")), encoding='utf-8')
    reader.next()
    return {
        int(row[0]): (int(row[0]), row[1], row[4], row[5]) for row in reader
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
while True:
    issues = read_issues(session)
    for issue_number, issue in issues.iteritems():
        if issue_number > max(posted_issues.keys()):
            post_issue(issue)
    posted_issues.update(issues)
    time.sleep(60)
