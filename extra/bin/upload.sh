#!/bin/bash

rm -rf .git
aws s3 cp s3://$1/$2/$3/debug.tgz .

mkdir prev && cd prev
tar -xzf ../debug.tgz
cd debug

for i in `find output -type f`; do
    if [ -e "../../$i" ] && [ $(md5sum ../../$i | awk '{ print $1 }') = $(md5sum  $i | awk '{ print $1 }') ]; then
        echo "cp -p $i ../../$i";
        cp -p $i ../../$i;
    fi;
done

cd ../..
rm -rf prev
mkdir debug
mv * debug
cp -rp debug/output/* .
tar -czf debug.tgz debug
rm -rf debug

aws s3 sync . s3://$1/$2/$3 --delete
