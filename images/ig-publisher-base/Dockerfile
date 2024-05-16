FROM openjdk:23-jdk-slim-bookworm
LABEL maintainer="Josh Mandel"

ARG NODE_VERSION=v20.13.1

# Install dependencies, clean up, and set up non-root user
RUN apt-get update && apt-get -y install curl git openssl wget graphviz ruby ruby-dev && \
    apt-get clean && \
    gem install jekyll jekyll-asciidoc

# Download and install Node.js
WORKDIR /tmp

# Set platform-specific variables
RUN if [ -z "$NODE_DISTRO" ]; then \
        if [ "$(uname -m)" = "x86_64" ]; then \
            NODE_DISTRO=linux-x64; \
        elif [ "$(uname -m)" = "arm64" ]; then \
            NODE_DISTRO=darwin-arm64; \
        else \
            echo "Unsupported architecture"; \
            exit 1; \
        fi; \
    fi; && echo "DOWNLOAD https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_DISTRO}.tar.gz" && \
    wget --quiet https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_DISTRO}.tar.gz && \
    tar --strip-components 1 -xf node-${NODE_VERSION}-${NODE_DISTRO}.tar.gz -C /usr/local && \
    rm node-${NODE_VERSION}-${NODE_DISTRO}.tar.gz
