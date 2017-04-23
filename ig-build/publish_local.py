import boto3
import json
import os
import requests
import shutil
import subprocess
import tempfile
from os.path import normpath

WAIT_SECONDS = 20
POLLS_PER_MINUTE = 60 / WAIT_SECONDS
QUEUE_URL= os.environ.get('QUEUE_URL', 'https://sqs.us-east-1.amazonaws.com/515384486676/ig-build-selfhosted')
queue = boto3.resource('sqs').Queue(QUEUE_URL)

def publish(message):
  message.delete()
  org = message.body.split("/")[0]
  repo = message.body.split("/")[1]
  details = {'org': org, 'repo': repo}
  print 'publishing', details
  new_env = os.environ.copy()
  new_env.update({
        'ORG': org,
        'REPO': repo,
  })
  print "runnign with new env"
  print new_env
  print subprocess.check_output([
    'python', '-m', 'builder.builder'],
    env=new_env).strip()

def poll_once():
  print 'Polling and waiting %s seconds'%(WAIT_SECONDS)
  [publish(m) for m in queue.receive_messages(WaitTimeSeconds=WAIT_SECONDS)]

if __name__ == '__main__':
  [poll_once() for i in range(POLLS_PER_MINUTE)]

