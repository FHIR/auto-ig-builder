#!/bin/bash
set -e

# Change uid and gid of node user so it matches ownership of current dir
if [ "$MAP_NODE_UID" != "no" ]; then
    if [ ! -d "$MAP_NODE_UID" ]; then
        MAP_NODE_UID=$PWD
    fi

    uid=$(stat -c '%u' "$MAP_NODE_UID")
    gid=$(stat -c '%g' "$MAP_NODE_UID")
    echo "publisher ---> UID = $uid / GID = $gid"

    export USER=publisher

    usermod -u $uid publisher 2> /dev/null && {
      groupmod -g $gid publisher 2> /dev/null || usermod -a -G $gid publisher
    }
fi

gosu publisher git clone https://github.com/HL7/ig-publisher-scripts /home/publisher/bin/ig-publisher-scripts
gosu publisher npm install -g fsh-sushi
exec gosu publisher "$@"
