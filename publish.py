import boto3
import json
import os
import requests
import shutil
import subprocess
import tempfile
from os.path import normpath

WAIT_SECOUNDS = 20
POLLS_PER_MINUTE = 60 / WAIT_SECONDS
QUEUE_URL= os.environ.get('QUEUE_URL', 'https://sqs.us-east-1.amazonaws.com/515384486676/ig-build-queue')
BUCKET_URL = os.environ.get('BUCKET_URL', 'ig-build.fhir.org')
WEBROOT = normpath(os.environ.get('WEBROOT', '/var/www/ig'))
GITHUB_COMMITS = 'https://api.github.com/repos/%(org)s/%(repo)s/commits'
DEBUG_FILE = 'debug.tgz'
BUILT_IG_PATH = '%(org)s/%(repo)s/%(commit)s.' + DEBUG_FILE

queue = boto3.resource('sqs').Queue(QUEUE_URL)
bucket = boto3.resource('s3').Bucket(BUCKET_URL)

is_head_commit = lambda d: d['commit'] == requests.get(GITHUB_COMMITS%d).json()[0]['sha']

def publish(message):
  message.delete()
  details = json.loads(message.body)

  if is_head_commit(details):
    temp_dir = tempfile.mkdtemp()

    bucket.download_file(Key=BUILT_IG_PATH%details, Filename=os.path.join(temp_dir, DEBUG_FILE))
    subprocess.Popen(["tar", "-zxf", DEBUG_FILE], cwd=temp_dir).wait()

    publication_path = normpath(os.path.join(WEBROOT, details['org'], details['repo']))
    assert publication_path.startswith(WEBROOT) # Safety check: ensure we're still in webroot

    # First publishing a new IG, the path won't exist
    if os.path.exists(publication_path):
      shutil.rmtree(publication_path)
    shutil.move(temp_dir, publication_path)

def poll_once():
  [publish(m) for m in queue.receive_messages(WaitTimeSeconds=WAIT_SECONDS)]

if __name__ == '__main__':
  [poll_once() for i in range(POLLS_PER_MINUTE)]
