#!/bin/bash

rm -rf .git
mkdir debug
mv * debug
mv debug/output/* .
rm -r debug/output

cd debug
build-index.sh > index.html
cd ..

aws s3 sync . s3://$1/$2/$3 --delete
