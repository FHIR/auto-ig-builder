FROM python:2.7
MAINTAINER Josh Mandel

RUN pip install requests zulip
ADD sync.py /usr/local/bin/sync.py

ENTRYPOINT sync.py
