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

GITHUB_COMMITS = 'https://api.github.com/repos/%(org)s/%(repo)s/commits'
GITHUB = 'https://github.com/%(org)s/%(repo)s'
WEBROOT = normpath(os.environ.get('WEBROOT', '/var/www/ig'))

def copy_build_failure(config, build_dir):
  failure_publication_path = normpath(os.path.join(WEBROOT, config['org'], config['repo'], 'failed'))
  move(build_dir, failure_publication_path)

def copy_build_success(config, build_dir):
  publication_path = normpath(os.path.join(WEBROOT, config['org'], config['repo']))
  move(build_dir, publication_path)

def move(from_dir, to_dir):
  assert to_dir.startswith(WEBROOT) # Safety check: ensure we're still in webroot
  if os.path.exists(to_dir):
    shutil.rmtree(to_dir)
  shutil.move(from_dir, to_dir)

def build(config):
  temp_dir = make_temp_dir()
  clone_dir = os.path.join(temp_dir, 'repo')
  logfile = os.path.join(temp_dir, 'build.log')
  logging.basicConfig(filename=logfile, level=logging.DEBUG)

  logging.warning('about to clone!')
  do(['git', 'clone', GITHUB%config, 'repo'], temp_dir)
  do(['wget', 'http://build.fhir.org/org.hl7.fhir.igpublisher.jar',
        '-O', 'publisher.jar'], temp_dir)

  details = {
    'org': config['org'],
    'repo': config['repo'],
    'commit': subprocess.check_output(['git', 'log', '-1', '--pretty=%B'], cwd=clone_dir).strip()
  }


  built_exit = do(['java',
         '-jar', '../publisher.jar',
         '-ig', 'ig.json',
         '-out', clone_dir], clone_dir)
  built = (0 == built_exit)
  print built, built_exit

  message = ["**[%(org)s/%(repo)s](https://github.com/%(org)s/%(repo)s)** rebuilt\n",
             "Commit: %(commit)s :%(emoji)s:\n",
             "Details: [build logs](http://build.fhir.org/ig/%(org)s/%(repo)s/%(buildlog)s) | [publisher logs](http://build.fhir.org/ig/%(org)s/%(repo)s/%(log)s)"]


  if not built:
    print "Build error occurred"
    details['emoji'] = 'thumbsdown'
    details['buildlog'] = 'failed/build.log'
    details['log'] = 'failed/fhir-ig-publisher.log'
    message += [" | [debug](http://build.fhir.org/ig/%(org)s/%(repo)s/failed)"]
    shutil.copy('/tmp/fhir-ig-publisher.log', clone_dir)
    shutil.copy(logfile, clone_dir)
    copy_build_failure(config, clone_dir)
  else:
    print "Build succeeded"
    details['emoji'] = 'thumbsup'
    details['buildlog'] = 'build.log'
    details['log'] = 'fhir-ig-publisher.log'
    message += [" | [published](http://build.fhir.org/ig/%(org)s/%(repo)s)"]
    shutil.copy('/tmp/fhir-ig-publisher.log', os.path.join(clone_dir, 'output'))
    shutil.copy(logfile, os.path.join(clone_dir, 'output'))
    copy_build_success(config, os.path.join(clone_dir, 'output'))

  shutil.rmtree(temp_dir)
  send_zulip('committers', 'ig-build', "".join(message)%details)
  sys.exit(0 if built else 1)

if __name__ == '__main__':
  build({
    'org': os.environ.get('ORG', 'test-igs'),
    'repo': os.environ.get('REPO', 'simple'),
  })

