#!/bin/bash
set -e

git clone https://github.com/HL7/ig-publisher-scripts /home/publisher/bin/ig-publisher-scripts
npm install -g fsh-sushi

exec "$@"
