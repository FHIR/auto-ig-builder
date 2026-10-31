import datetime
import logging
import os
import string
import subprocess
import time

SCRATCH_SPACE = os.environ.get('SCRATCH', '/scratch')
DEADLINE_SECONDS = int(os.environ.get('DEADLINE_SECONDS', '1800'))
DEADLINE_BUFFER = int(os.environ.get('DEADLINE_BUFFER', '120'))
deadline_time = datetime.datetime.now() + datetime.timedelta(seconds=(DEADLINE_SECONDS-DEADLINE_BUFFER))

def do(args, cwd=SCRATCH_SPACE, pipe=False, deadline=False):
  logging.debug('running: %s'%" ".join(args))
  logfile = logging.getLoggerClass().root.handlers[0].baseFilename
  logopen = open(logfile, 'a')
  if pipe: logopen = None
  pr = subprocess.Popen(args, cwd=cwd, stdout=logopen, stderr=logopen)
  try:
    if deadline:
      time_to_deadline = (deadline_time - datetime.datetime.now()).total_seconds()
      logging.debug("Time to deadline %s seconds"%time_to_deadline)
      return pr.wait(timeout=time_to_deadline)
    else:
      return pr.wait()
  except subprocess.TimeoutExpired:
    pr.kill()
    logging.debug("\n\n*** Timeout -- deadline reached")
    return 1

def do_retry(args, cwd=SCRATCH_SPACE, attempts=4, waits=(10, 30, 60), ok=None, before_retry=None):
  """Run a network step up to `attempts` times. A run succeeds when it exits 0
  and ok() (if given) agrees; before_retry() can clear a partial result."""
  code = 1
  for attempt in range(1, attempts + 1):
    code = do(args, cwd, deadline=True)
    if code == 0 and (ok is None or ok()):
      return 0
    wait = waits[min(attempt - 1, len(waits) - 1)]
    if attempt == attempts or datetime.datetime.now() + datetime.timedelta(seconds=wait) >= deadline_time:
      break
    logging.info("%s failed (attempt %d of %d, exit %s); retrying in %d s", args[0], attempt, attempts, code, wait)
    time.sleep(wait)
    if before_retry:
      before_retry()
  return code or 1
