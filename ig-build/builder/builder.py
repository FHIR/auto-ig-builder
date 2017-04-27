import logging
import os
import random
import requests
import shutil
import string
import subprocess
import sys

from .util  import make_temp_dir, do, send_zulip
from os.path import normpath

GITHUB = 'https://github.com/%(org)s/%(repo)s'
HOSTED_ROOT = os.environ.get('HOSTED_ROOT', 'https://storage.googleapis.com/fhir-igs')

def build(config):
  temp_dir = make_temp_dir()
  clone_dir = os.path.join(temp_dir, 'repo')
  build_dir = os.path.join(clone_dir, 'output')
  logfile = os.path.join(temp_dir, 'build.log')
  logging.basicConfig(filename=logfile, level=logging.DEBUG)
  logging.info('about to clone!')
  do(['git', 'clone', GITHUB%config, 'repo'], temp_dir)
  do(['wget', '-q', 'http://build.fhir.org/org.hl7.fhir.igpublisher.jar',
        '-O', 'publisher.jar'], temp_dir)

  details = {
    'root': HOSTED_ROOT,
    'org': config['org'],
    'repo': config['repo'],
    'commit': subprocess.check_output(['git', 'log', '-1', '--pretty=%B (%an)'], cwd=clone_dir).strip()
  }


  built_exit = do(['java',
         '-jar', '../publisher.jar',
         '-ig', 'ig.json',
         '-auto-ig-build',
         '-out', clone_dir], clone_dir)
  built = (0 == built_exit)
  print built, built_exit

  message = ["**[%(org)s/%(repo)s](https://github.com/%(org)s/%(repo)s)** rebuilt\n",
             "Commit: %(commit)s :%(emoji)s:\n",
             "Details: [build logs](%(root)s/%(org)s/%(repo)s/%(buildlog)s)"]

  if not built:
    print "Build error occurred"
    details['emoji'] = 'thumbsdown'
    details['buildlog'] = 'build.log'
    message += [" | [debug](%(root)s/%(org)s/%(repo)s)"]
    shutil.copy(logfile, clone_dir)
    do(['publish', details['org'], details['repo']], clone_dir)
  else:
    print "Build succeeded"
    details['emoji'] = 'thumbsup'
    details['buildlog'] = 'build.log'
    message += [" | [published](%(root)s/%(org)s/%(repo)s/index.html)"]
    shutil.copy(logfile, build_dir)
    do(['publish', details['org'], details['repo']], build_dir)

  shutil.rmtree(temp_dir)
  send_zulip('committers', 'ig-build', "".join(message)%details)
  # sys.exit(0 if built else 1)

if __name__ == '__main__':
  build({
    'org': os.environ.get('IG_ORG', 'test-igs'),
    'repo': os.environ.get('IG_REPO', 'simple'),
  })
