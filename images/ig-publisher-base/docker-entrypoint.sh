#!/bin/bash
set -e

/home/publisher/bin/with-latest-sushi.sh
exec "$@"
