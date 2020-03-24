FROM openjdk:15
MAINTAINER Josh Mandel

# Install required packages

RUN yum install -y python36 python36-pip git openssl which wget

RUN pip3.6 install --upgrade  requests zulip

ENV PATH="/usr/local/rvm/bin:/usr/local/rvm/rubies/ruby-2.5.1/bin:${PATH}"
RUN gpg --keyserver keyserver.ubuntu.com --recv-keys 409B6B1796C275462A1703113804BB82D39DC0E3 7D2BAF1CF37B13E2069D6956105BD0E739499BDB && \
    curl -L get.rvm.io | bash -s stable  && \
    rvm install 2.5.1 && \
    gem install jekyll jekyll-asciidoc

RUN mkdir -p /app/builder && mkdir /ig && mkdir /scratch
ADD builder /app/builder

WORKDIR /app
RUN pip3.6 install requests zulip

RUN  cd /tmp && \
     wget --quiet https://nodejs.org/dist/v12.16.1/node-v12.16.1-linux-x64.tar.xz && \
     cd /usr/local && \
     tar --strip-components 1 -xf /tmp/node-v12.16.1-linux-x64.tar.xz && \
     npm install -g fsh-sushi

RUN mkdir -p /root/.ssh && echo -e "Host ci-build\n\
  HostName ci-build-service.fhir.svc.cluster.local\n\
  User fhir_upload\n\
  StrictHostKeyChecking no\n\
  Port 2222\n\
  IdentityFile /etc/ci_build_keys/id\n\
  IdentitiesOnly yes" > /root/.ssh/config && chmod go-wrx /root/.ssh/config

ADD publish /usr/local/bin/publish

ENTRYPOINT python36 -m builder.builder || true
