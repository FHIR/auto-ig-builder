FROM openjdk:23-jdk-slim-bookworm
LABEL maintainer="Josh Mandel"

ENV NODE_VERSION=v20.13.1

# Install dependencies, clean up, and set up non-root user
RUN apt-get update && apt-get -y install curl git python3 python3-pip python3-requests openssl wget graphviz ruby-dev && \
    apt-get clean && \
    gem install jekyll jekyll-asciidoc

# Download and install Node.js
WORKDIR /tmp

RUN wget --quiet https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz && \
    tar --strip-components 1 -xf node-${NODE_VERSION}-linux-x64.tar.gz -C /usr/local && \
    rm node-${NODE_VERSION}-linux-x64.tar.gz

# Set up publisher environment
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN useradd -d /home/publisher -m publisher
USER publisher
RUN mkdir /home/publisher/ig && \
    mkdir /home/publisher/.node && \
    echo "prefix = /home/publisher/.node" > /home/publisher/.npmrc && \
    mkdir /home/publisher/bin && \
    git config --global pull.ff only && \
    git clone https://github.com/HL7/ig-publisher-scripts /home/publisher/bin/ig-publisher-scripts && \
    echo "#!/bin/sh\nnpm install -g fsh-sushi\ncd /home/publisher/bin/ig-publisher-scripts && git pull" > /home/publisher/bin/with-latest-sushi.sh && \
    chmod +x /home/publisher/bin/with-latest-sushi.sh


# Following technique from https://gist.github.com/yogeek/bc8dc6dadbb72cb39efadf83920077d3
WORKDIR /home/publisher/ig
VOLUME /home/publisher/ig
ENV PATH="/home/publisher/bin:/home/publisher/bin/ig-publisher-scripts:/home/publisher/.node/bin:${PATH}"
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bash"]
