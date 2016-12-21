import logging
import os
import random
import string
import subprocess
import zulip

ZULIP_API = os.environ.get('ZULIP_API', 'https://chat.fhir.org')
SCRATCH_SPACE = os.environ.get('SCRATCH', '/scratch')

def make_temp_dir(prefix='ig-build-temp-', N=6):
  dirname = prefix + ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(N))
  dirpath = os.path.abspath(os.path.join(SCRATCH_SPACE, dirname))
  os.makedirs(dirpath)
  return dirpath

def do(args, cwd=SCRATCH_SPACE):
  logging.debug('about to do %s'%" ".join(args))
  return subprocess.Popen(args, cwd=cwd).wait()

def send_zulip(stream, topic, content):
  logging.debug('zulip messaging: %s %s %s'%(stream, topic, content))
  zulip.Client(
    site=ZULIP_API,
    api_key=os.environ['ZULIP_API_KEY'],
    email=os.environ['ZULIP_EMAIL']
  ).send_message({
    'type': 'stream',
    'content': content,
    'to': stream,
    'subject': topic
  })

