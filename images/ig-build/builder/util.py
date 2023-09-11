import datetime
import logging
import os
import string
import subprocess

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
