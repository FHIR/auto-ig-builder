FROM eclipse-temurin:21-jdk-noble AS gem-builder
ARG TARGETARCH

# Compile native gem extensions in a throwaway stage
RUN apt-get update && apt-get -y --no-install-recommends install \
        ruby ruby-dev build-essential libffi-dev && \
    rm -rf /var/lib/apt/lists/* && \
    gem install jekyll

# ------- Runtime base (no build toolchain) -------
FROM eclipse-temurin:21-jdk-noble AS base
LABEL maintainer="Josh Mandel"

ARG NODE_VERSION=v22.22.2
ARG TARGETARCH

# Runtime-only packages (no build-essential, no ruby-dev, no libffi-dev)
RUN apt-get update && apt-get -y --no-install-recommends install \
        curl git openssl openssh-client wget graphviz ruby libffi8 && \
    rm -rf /var/lib/apt/lists/*

# Copy compiled gems from build stage
COPY --from=gem-builder /var/lib/gems /var/lib/gems
COPY --from=gem-builder /usr/local/bin/jekyll /usr/local/bin/jekyll

# Download and install Node.js + update npm for latest security patches
WORKDIR /tmp
RUN if [ "$TARGETARCH" = "amd64" ]; then \
        NODE_DISTRO=linux-x64; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
        NODE_DISTRO=linux-arm64; \
    else \
        echo "Unsupported architecture"; \
        exit 1; \
    fi; \
    echo "DOWNLOAD https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_DISTRO}.tar.gz" && \
    wget --quiet https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_DISTRO}.tar.gz && \
    tar --strip-components 1 -xf node-${NODE_VERSION}-${NODE_DISTRO}.tar.gz -C /usr/local && \
    rm node-${NODE_VERSION}-${NODE_DISTRO}.tar.gz

# Patch npm's bundled picomatch (CVE-2026-33671: ReDoS via crafted extglob)
RUN cd /usr/local/lib/node_modules/npm/node_modules/picomatch && \
    wget -q https://registry.npmjs.org/picomatch/-/picomatch-4.0.4.tgz && \
    tar xzf picomatch-4.0.4.tgz --strip-components=1 && \
    rm picomatch-4.0.4.tgz

# ------- Begin Local Dev -------
FROM base AS localdev
LABEL maintainer="Josh Mandel"
LABEL org.opencontainers.image.source=https://github.com/fhir/auto-ig-builder
COPY ./localdev-files/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN apt-get update && apt-get -y --no-install-recommends install gosu && \
    rm -rf /var/lib/apt/lists/*

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
USER root
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bash"]


# ------- Begin CI -------
FROM base AS ci
LABEL maintainer="Josh Mandel"

RUN apt-get update && apt-get -y --no-install-recommends install \
        inotify-tools python3 python3-pip python3-venv openssl && \
    rm -rf /var/lib/apt/lists/*

COPY ./ci-files/watch-and-publish /usr/local/bin/watch-and-publish
COPY ./ci-files/publish /usr/local/bin/publish

RUN userdel -r ubuntu 2>/dev/null || true && \
    groupadd -r fhirgroup -g 2000 && \
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
COPY ./ci-files/builder /app/builder
WORKDIR /app

RUN python3 -m venv venv

# Activate the virtual environment and install the zulip library
RUN /app/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /app/venv/bin/pip install --no-cache-dir zulip

ENTRYPOINT ["/bin/sh", "-c", "python3 -m builder.builder || touch /scratch/done"]
