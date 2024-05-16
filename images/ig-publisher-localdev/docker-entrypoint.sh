#!/bin/bash

npm install -g fsh-sushi
git clone https://github.com/HL7/ig-publisher-scripts /home/publisher/bin/ig-publisher-scripts

exec "$@"
