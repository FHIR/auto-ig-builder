FROM java:8
MAINTAINER Josh Mandel

# Install required packages
RUN apt-get update
RUN apt-get install -y  --force-yes jekyll git python-pip
RUN gem install jekyll-asciidoc

RUN mkdir -p /app/builder && mkdir /ig && mkdir /scratch
ADD builder /app/builder

WORKDIR /app
RUN pip install requests zulip

RUN mkdir -p /root/.ssh && echo "Host ci-build\n\
  HostName ci-build-service.fhir.svc.cluster.local\n\
  User fhir_upload\n\
  StrictHostKeyChecking no\n\
  Port 2222\n\
  IdentityFile /etc/ci_build_keys/id\n\
  IdentitiesOnly yes" > /root/.ssh/config && chmod go-wrx /root/.ssh/config

ADD publish /usr/local/bin/publish

ENTRYPOINT python2.7 -m builder.builder || true
