FROM openjdk:21-jdk-bullseye
LABEL maintainer="Josh Mandel"

# Set environment variables
ENV NODE_VERSION=v18.18.2 \
    PATH="/home/publisher/bin:/home/publisher/bin/ig-publisher-scripts:/home/publisher/.node/bin:${PATH}" \
    NODE_PATH="/home/publisher/.node/lib/node_modules:${PATH}"

# Install dependencies, clean up, and set up non-root user
RUN apt-get update && apt-get -y install python3 python3-pip gosu openssl wget graphviz ruby2.7 ruby2.7-dev && \
    apt-get clean && \
    pip3 install --upgrade requests zulip && \
    gem install jekyll jekyll-asciidoc && \
    useradd -d /home/publisher -m publisher

# Download and install Node.js
WORKDIR /tmp 
RUN wget --quiet https://nodejs.org/dist/latest-v18.x/node-${NODE_VERSION}-linux-x64.tar.gz && \
    tar --strip-components 1 -xf node-${NODE_VERSION}-linux-x64.tar.gz -C /usr/local && \
    rm node-${NODE_VERSION}-linux-x64.tar.gz

# Set up publisher environment
USER publisher
RUN mkdir /home/publisher/ig && \
    mkdir /home/publisher/.node && \
    echo "prefix = /home/publisher/.node" > /home/publisher/.npmrc && \
    mkdir /home/publisher/bin && \
    git config --global pull.ff only && \
    git clone https://github.com/HL7/ig-publisher-scripts /home/publisher/bin/ig-publisher-scripts && \
    echo "#!/bin/sh\nnpm install -g fsh-sushi\ncd /home/publisher/bin/ig-publisher-scripts && git pull" > /home/publisher/bin/with-latest-sushi.sh && \
    chmod +x /home/publisher/bin/with-latest-sushi.sh && \
    /home/publisher/bin/with-latest-sushi.sh

# Following technique from https://gist.github.com/yogeek/bc8dc6dadbb72cb39efadf83920077d3
WORKDIR /home/publisher/ig
VOLUME /home/publisher/ig

USER root
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bash"]
