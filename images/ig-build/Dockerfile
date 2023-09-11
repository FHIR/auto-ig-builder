FROM openjdk:21-jdk-bullseye
MAINTAINER Josh Mandel

RUN apt-get update && apt-get -y install python3 python3-pip gosu openssl wget graphviz ruby2.7 ruby2.7-dev inotify-tools
RUN pip3 install --upgrade  requests zulip
RUN gem install jekyll jekyll-asciidoc

RUN  cd /tmp && \
     wget --quiet https://nodejs.org/dist/v18.17.1/node-v18.17.1-linux-x64.tar.xz && \
     cd /usr/local && \
     tar --strip-components 1 -xf /tmp/node-v18.17.1-linux-x64.tar.xz

# Install required packages

RUN mkdir -p /app/builder && mkdir /ig && mkdir /scratch
ADD builder /app/builder

WORKDIR /app

RUN mkdir -p /root/.ssh && \
  printf "Host ci-build\n\
  HostName ci-build-service.fhir.svc.cluster.local\n\
  User fhir_upload\n\
  StrictHostKeyChecking no\n\
  Port 2222\n\
  IdentityFile /etc/ci_build_keys/id\n\
  IdentitiesOnly yes" > /root/.ssh/config && \
  chmod go-wrx /root/.ssh/config

ADD watch-and-publish /usr/local/bin/watch-and-publish
ADD publish /usr/local/bin/publish

ENTRYPOINT python3 -m builder.builder || true
