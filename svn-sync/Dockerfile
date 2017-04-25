FROM ubuntu:16.04

RUN apt-get update
RUN apt-get install -y svn git git-svn

RUN mkdir /svn
WORKDIR /svn

ADD setup sync ./

ENTRYPOINT setup
