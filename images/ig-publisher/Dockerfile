FROM openjdk:23-jdk-slim-bookworm as base
LABEL maintainer="Josh Mandel"

ARG NODE_VERSION=v20.13.1

# Install dependencies, clean up, and set up non-root user
RUN apt-get update && apt-get -y install curl git openssl wget graphviz ruby ruby-dev build-essential libffi-dev && \
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
    fi;\
    echo "DOWNLOAD https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_DISTRO}.tar.gz" && \
    wget --quiet https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_DISTRO}.tar.gz && \
    tar --strip-components 1 -xf node-${NODE_VERSION}-${NODE_DISTRO}.tar.gz -C /usr/local && \
    rm node-${NODE_VERSION}-${NODE_DISTRO}.tar.gz

# ------- Begin Local Dev -------
FROM base as localdev
LABEL maintainer="Josh Mandel"

COPY ./localdev-files/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN useradd -d /home/publisher -m publisher
USER publisher
RUN mkdir /home/publisher/ig && \
    mkdir /home/publisher/.node && \
    echo "prefix = /home/publisher/.node" > /home/publisher/.npmrc && \
    mkdir /home/publisher/bin && \
    git config --global pull.ff only

WORKDIR /home/publisher/ig
VOLUME /home/publisher/ig
ENV PATH="/home/publisher/bin:/home/publisher/bin/ig-publisher-scripts:/home/publisher/.node/bin:${PATH}"
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bash"]

# ------- Begin CI -------
FROM base as ci
LABEL maintainer="Josh Mandel"

RUN apt-get update && apt-get -y install inotify-tools python3 python3-pip python3-venv python3-requests openssl && \
    apt-get clean

ADD ./ci-files/watch-and-publish /usr/local/bin/watch-and-publish
ADD ./ci-files/publish /usr/local/bin/publish

RUN groupadd -r fhirgroup -g 2000 && \
    useradd -r -u 1000 -g fhirgroup -m -d /home/fhiruser -s /sbin/nologin fhiruser && \
    mkdir /app /var/lib/.fhir  && \
    chown fhiruser.fhirgroup /app && \
    chown fhiruser.fhirgroup /var/lib/.fhir && \
    ln -s /var/lib/.fhir /home/fhiruser/.fhir

USER fhiruser

# Configure SSH for non-root user
RUN mkdir -p /home/fhiruser/.ssh && \
    printf "Host ci-build\n\
    HostName ci-build-service.fhir.svc.cluster.local\n\
    User fhir_upload\n\
    StrictHostKeyChecking no\n\
    Port 2222\n\
    IdentityFile /etc/ci_build_keys/id\n\
    IdentitiesOnly yes" > /home/fhiruser/.ssh/config && \
    chmod go-wrx /home/fhiruser/.ssh/config

RUN mkdir -p /app/builder
ADD ./ci-files/builder /app/builder
WORKDIR /app

RUN python3 -m venv venv

# Activate the virtual environment and install the zulip library
RUN /app/venv/bin/pip install --upgrade pip && \
    /app/venv/bin/pip install zulip

ENTRYPOINT python3 -m builder.builder || touch /scratch/done
