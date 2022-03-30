FROM openjdk:11-jdk-buster
MAINTAINER Josh Mandel

RUN apt-get update && apt-get -y install python3 python3-pip gosu openssl wget graphviz
RUN pip3 install --upgrade  requests zulip

ENV PATH="/usr/local/rvm/bin:/usr/local/rvm/rubies/ruby-2.5.1/bin:${PATH}"
RUN gpg --keyserver keyserver.ubuntu.com --recv-keys 409B6B1796C275462A1703113804BB82D39DC0E3 7D2BAF1CF37B13E2069D6956105BD0E739499BDB && \
    curl -L get.rvm.io | bash -s stable  && \
    rvm install 2.5.1 && \
    gem install jekyll jekyll-asciidoc

RUN  cd /tmp && \
     wget --quiet https://nodejs.org/dist/v16.4.2/node-v16.4.2-linux-x64.tar.xz && \
     cd /usr/local && \
     tar --strip-components 1 -xf /tmp/node-v16.4.2-linux-x64.tar.xz

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

ADD publish /usr/local/bin/publish

ENTRYPOINT python3 -m builder.builder || true
