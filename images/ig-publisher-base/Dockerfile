FROM openjdk:21-jdk-bullseye
MAINTAINER Josh Mandel

RUN apt-get update && apt-get -y install python3 python3-pip gosu openssl wget graphviz ruby2.7 ruby2.7-dev
RUN pip3 install --upgrade  requests zulip
RUN gem install jekyll jekyll-asciidoc

RUN useradd -d /home/publisher -m publisher

RUN  cd /tmp && \
     wget --quiet https://nodejs.org/dist/latest-v18.x/node-v18.16.0-linux-x64.tar.xz && \
     cd /usr/local && \
     tar --strip-components 1 -xf /tmp/node-v18.16.0-linux-x64.tar.xz


USER publisher
RUN mkdir /home/publisher/ig
ENV PATH="/home/publisher/bin:/home/publisher/bin/ig-publisher-scripts:/home/publisher/.node/bin:${PATH}"
ENV NODE_PATH="/home/publisher/.node/lib/node_modules:${PATH}"

RUN mkdir /home/publisher/.node && \
    echo "prefix = /home/publisher/.node" > /home/publisher/.npmrc


# Latest fsh and ig-publisher-scripts each time we start
RUN mkdir /home/publisher/bin && \
    cd /home/publisher/bin && \
    git config --global pull.ff only && \
    git clone https://github.com/HL7/ig-publisher-scripts && \
    printf "#!/bin/sh\n\
    npm install -g fsh-sushi\n\
    cd /home/publisher/bin/ig-publisher-scripts && git pull\
    " >>  /home/publisher/bin/with-latest-sushi.sh && \
    chmod +x /home/publisher/bin/with-latest-sushi.sh && \
    /home/publisher/bin/with-latest-sushi.sh

# Following technique from https://gist.github.com/yogeek/bc8dc6dadbb72cb39efadf83920077d3
WORKDIR /home/publisher/ig
VOLUME /home/publisher/ig

USER root
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bash"]
