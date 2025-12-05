import logging
import os
import shutil
import string
import subprocess
import urllib.parse

from .util  import do, SCRATCH_SPACE
from os.path import normpath

GITHUB = 'https://github.com/%(org)s/%(repo)s'
HOSTED_ROOT = os.environ.get('HOSTED_ROOT', 'https://build.fhir.org/ig')
PUBLISHER_JAR_URL = os.environ.get('PUBLISHER_JAR_URL', 'https://github.com/HL7/fhir-ig-publisher/releases/latest/download/publisher.jar')
TX_SERVER_URL = os.environ.get('TX_SERVER_URL', 'http://tx.fhir.org')

# Get Git credentials from environment
GIT_USERNAME = os.environ.get('GIT_USERNAME')
GIT_PASSWORD = os.environ.get('GIT_PASSWORD')

def get_authenticated_url(config):
    """Build authenticated Git URL if credentials are available"""
    if GIT_USERNAME and GIT_PASSWORD:
        # URL encode the credentials to handle special characters
        username = urllib.parse.quote(GIT_USERNAME, safe='')
        password = urllib.parse.quote(GIT_PASSWORD, safe='')
        return f'https://{username}:{password}@github.com/{config["org"]}/{config["repo"]}'
    else:
        return GITHUB % config

def encode_branch_name(branch):
    """Replace forward slashes with underscores for safe use in file paths"""
    return branch.replace('/', '_')

temp_dir = SCRATCH_SPACE
clone_dir = os.path.join(temp_dir, 'repo')
build_dir = os.path.join(clone_dir, 'output')
logfile = os.path.join(temp_dir, 'build.log')
upload_dir = os.path.join(SCRATCH_SPACE, 'upload')

def get_qa_score(build_dir):
  qa_file = os.path.join(build_dir, 'qa.html')
  try:
    with open(qa_file, 'r') as f:
      f.readline()
      f.readline()
      report_line = f.readline()
    return report_line.split("--")[1].strip()
  except:
    return "No QA File"


def finalize(result_dir, message, pubargs):
  shutil.copy(logfile, result_dir)
  os.rename(result_dir, upload_dir)
  message_path = os.path.join(SCRATCH_SPACE, 'message')
  with open(message_path, 'w') as f:
    f.write(message)

  # Write each argument to a new line in a temporary file
  done_path = os.path.join(SCRATCH_SPACE, 'done')
  done_temp_path = done_path + '.temp'
  with open(done_temp_path, 'w') as f:
    for arg in pubargs:
      f.write(arg + '\n')
  # Atomically rename the temporary file to the desired file name
  os.rename(done_temp_path, done_path)


def build(config):
  logging.basicConfig(filename=logfile, level=logging.DEBUG)
  logging.info('about to clone!')

  print(f"Starting build for {config['org']}/{config['repo']}:{config['branch']}")

  def run_git_cmd(cmds):
    return subprocess.check_output(cmds, cwd=clone_dir, universal_newlines=True).strip()

  def is_default_branch():
    default_branch_full = run_git_cmd(['git', 'symbolic-ref', 'refs/remotes/origin/HEAD'])
    default_branch = default_branch_full.split('/')[-1]
    return bool(default_branch == config['branch'])

  print("Executing git clone...")
  cloned_exit = do(['git', 'clone', '--recursive', get_authenticated_url(config), '--branch', config['branch'], 'repo'], temp_dir, deadline=True)
  print(f"Git clone completed with exit code: {cloned_exit}")
  os.makedirs(clone_dir, exist_ok=True)

  message_header = "**[{org}/{repo}: {branch}]({root}/{org}/{repo}/tree/{branch})** ".format(**config)

  def early_failure(msg):
    config["msg"] = msg
    print(f"Early failure: {msg}")
    return {
      "result_dir": clone_dir,
      "message": message_header + msg,
      "pubargs": ['failure', 'nondefault']
    }

  # Check if clone actually succeeded by looking for repository content
  repo_has_content = os.path.exists(clone_dir) and os.path.exists(os.path.join(clone_dir, '.git'))
  print(f"Repository directory exists: {os.path.exists(clone_dir)}")
  print(f"Repository has .git directory: {repo_has_content}")

  if cloned_exit != 0 and not repo_has_content:
    print(f"Clone failed - exit code {cloned_exit} and no repository content found")
    return early_failure("Failed to clone git repository")
  elif cloned_exit != 0 and repo_has_content:
    print(f"Clone succeeded despite non-zero exit code {cloned_exit} - continuing...")
  else:
    print("Clone succeeded normally")

  dl_publisher_exit = do(['wget', '-q', PUBLISHER_JAR_URL, '-O', 'publisher.jar'], temp_dir, deadline=True)
  if dl_publisher_exit != 0:
    return early_failure("Failed to download publisher")


  install_sushi_exit = do(['npm', '-g', 'install', 'fsh-sushi'], temp_dir, deadline=True)
  if install_sushi_exit != 0:
    return early_failure("Failed to install sushi")

  details = {
    'root': HOSTED_ROOT,
    'org': config['org'],
    'repo': config['repo'],
    'branch': config['branch'],
    'branch_encoded': encode_branch_name(config['branch']),
    'default': 'default' if is_default_branch() else 'nondefault',
    'commit': run_git_cmd(['git', 'log', '-1', '--pretty=%B (%an)'])
  }

  java_memory = os.environ.get('JAVA_MEMORY', '2g')

  built_exit = do(['java',
         '-Xms%s'%java_memory, '-Xmx%s'%java_memory,
         '-jar', '../publisher.jar',
         '-ig', 'ig.json',
         '-api-key-file', '/etc/ig.builder.keyfile.ini',
         '-fhir-settings', '/etc/fhir-settings.json',
         '-auto-ig-build',
         '-tx', TX_SERVER_URL,
         '-target', '{root}/{org}/{repo}/'.format(**details),
         '-out', clone_dir], clone_dir, deadline=True)

  built = (0 == built_exit)

  message = [message_header + "rebuilt\n",
             "Commit: {commit} :{emoji}:\n",
             "Details: [build logs]({root}/{org}/{repo}/branches/{branch_encoded}/{buildlog})"]
  print("finalizing")
  if not built:
    print("Build error occurred")
    details['emoji'] = 'thumbs_down'
    details['buildlog'] = 'failure/build.log'
    message += [" | [debug]({root}/{org}/{repo}/branches/{branch_encoded}/failure)"]
    return {
      "result_dir": clone_dir,
      "message":"".join(message).format(**details),
      "pubargs": ['failure', details['default']]
    }


  else:
    print("Build succeeded")
    details['emoji'] = 'thumbs_up'
    details['buildlog'] = 'build.log'
    message += [" | [published]({root}/{org}/{repo}/branches/{branch_encoded}/index.html)"]
    message += [f" | [qa: {get_qa_score(build_dir)}]", "({root}/{org}/{repo}/branches/{branch_encoded}/qa.html)"]
    return {
      "result_dir": build_dir,
      "message":"".join(message).format(**details),
      "pubargs": ['success', details['default']]
    }

if __name__ == '__main__':
  results = build({
    'org': os.environ.get('IG_ORG', 'test-igs'),
    'repo': os.environ.get('IG_REPO', 'simple'),
    'branch': os.environ.get('IG_BRANCH', 'master'),
    'root': os.environ.get('HOSTED_ROOT', 'https://build.fhir.org/ig')
  })
  print("results")
  print(results)
  finalize(**results)
