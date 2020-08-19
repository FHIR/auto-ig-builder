FROM openjdk:16-jdk-buster
MAINTAINER Josh Mandel

RUN apt-get update && apt-get -y install python3 python3-pip gosu

ENV PATH="/usr/local/rvm/bin:/usr/local/rvm/rubies/ruby-2.5.1/bin:${PATH}"
RUN gpg --keyserver keyserver.ubuntu.com --recv-keys 409B6B1796C275462A1703113804BB82D39DC0E3 7D2BAF1CF37B13E2069D6956105BD0E739499BDB && \
    curl -L get.rvm.io | bash -s stable  && \
    rvm install 2.5.1 && \
    gem install jekyll jekyll-asciidoc

RUN  cd /tmp && \
     wget --quiet https://nodejs.org/dist/v12.16.1/node-v12.16.1-linux-x64.tar.xz && \
     cd /usr/local && \
     tar --strip-components 1 -xf /tmp/node-v12.16.1-linux-x64.tar.xz

RUN useradd -d /home/publisher -m publisher

USER publisher
RUN mkdir /home/publisher/ig
ENV PATH="/home/publisher/bin:/home/publisher/.node/bin:/home/publisher/.node/lib/node_modules/fsh-sushi/dist/ig/files:${PATH}"
ENV NODE_PATH="/home/publisher/.node/lib/node_modules:${PATH}"

RUN mkdir /home/publisher/.node && \
    echo "prefix = /home/publisher/.node" > /home/publisher/.npmrc

RUN mkdir /home/publisher/bin && \
    printf "#!/bin/sh\n\
            npm install -g fsh-sushi" >>  /home/publisher/bin/with-latest-sushi.sh && \
    chmod +x /home/publisher/bin/with-latest-sushi.sh && \
    /home/publisher/bin/with-latest-sushi.sh

# Following technique from https://gist.github.com/yogeek/bc8dc6dadbb72cb39efadf83920077d3
WORKDIR /home/publisher/ig
VOLUME /home/publisher/ig

USER root
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bash"]
