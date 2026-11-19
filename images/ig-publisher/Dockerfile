# Toolchains come straight from their upstreams, pinned and checksum-verified:
#   Ruby  - the Ruby team's official image (also our Debian base)
#   Java  - Eclipse Temurin JDK tarball from Adoptium
#   Node  - nodejs.org release tarball
# Run ./update-pins.sh to move every pin below to the latest upstream release.

# --- pins (managed by update-pins.sh) ---
ARG RUBY_IMAGE=ruby:3.4.13-slim-trixie@sha256:03e203fab47d495a1d0046d10040db89367b361328ecd4af469f0433e2dd9ce1
ARG JEKYLL_VERSION=4.4.1
ARG JDK_URL_AMD64=https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13.1%2B2/OpenJDK21U-jdk_x64_linux_hotspot_21.0.13.1_2.tar.gz
ARG JDK_SHA256_AMD64=bb8a93f9ae6e7a693b2b721e85dbeff26ae1a77447985a8d7afcdd9c7cf6222e
ARG JDK_URL_ARM64=https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.13_9.tar.gz
ARG JDK_SHA256_ARM64=e3522e707fc7dbe2a72c30746b1e7068301a0213ecd213d4491f35a14eb55578
ARG NODE_VERSION=v22.23.5
ARG NODE_SHA256_AMD64=c54118104acc524633b5abe106bbf44a53126ec8b4e5fa105cb92b5d7de8a1a1
ARG NODE_SHA256_ARM64=8bd3dc69eee8f3f226315a80d7d1d4faccf217a4c8fae500168ac2e38f3bdba3
# npm's bundled picomatch < 4.0.4 has CVE-2026-33671 (ReDoS); replaced when older
ARG PICOMATCH_VERSION=4.0.7
ARG PICOMATCH_SHA256=697b463be3cdbd9ffc8f4194fd5019a69ddf95875fb703d78b2b115cc9e740a8
# --- end pins ---

# ------- Gems (native extensions compiled here, toolchain discarded) -------
FROM ${RUBY_IMAGE} AS gem-builder
ARG JEKYLL_VERSION
RUN apt-get update && apt-get -y --no-install-recommends install build-essential && \
    rm -rf /var/lib/apt/lists/* && \
    gem install --no-document jekyll -v "${JEKYLL_VERSION}"

# ------- Java -------
FROM ${RUBY_IMAGE} AS jdk
ARG TARGETARCH JDK_URL_AMD64 JDK_SHA256_AMD64 JDK_URL_ARM64 JDK_SHA256_ARM64
ADD --checksum=sha256:${JDK_SHA256_AMD64} ${JDK_URL_AMD64} /tmp/jdk-amd64.tar.gz
ADD --checksum=sha256:${JDK_SHA256_ARM64} ${JDK_URL_ARM64} /tmp/jdk-arm64.tar.gz
RUN mkdir -p /opt/java/openjdk && \
    tar -xzf /tmp/jdk-${TARGETARCH}.tar.gz -C /opt/java/openjdk --strip-components=1 && \
    /opt/java/openjdk/bin/java -version

# ------- Node -------
FROM ${RUBY_IMAGE} AS node
ARG TARGETARCH NODE_VERSION NODE_SHA256_AMD64 NODE_SHA256_ARM64
ADD --checksum=sha256:${NODE_SHA256_AMD64} https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz /tmp/node-amd64.tar.gz
ADD --checksum=sha256:${NODE_SHA256_ARM64} https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-arm64.tar.gz /tmp/node-arm64.tar.gz
ARG PICOMATCH_VERSION PICOMATCH_SHA256
ADD --checksum=sha256:${PICOMATCH_SHA256} https://registry.npmjs.org/picomatch/-/picomatch-${PICOMATCH_VERSION}.tgz /tmp/picomatch.tgz
RUN mkdir -p /opt/node && \
    tar -xzf /tmp/node-${TARGETARCH}.tar.gz -C /opt/node --strip-components=1 --no-same-owner --exclude='*/CHANGELOG.md' --exclude='*/README.md' && \
    PM=/opt/node/lib/node_modules/npm/node_modules/picomatch && \
    if [ "$(printf '%s\n' "$(/opt/node/bin/node -p "require('$PM/package.json').version")" "${PICOMATCH_VERSION}" | sort -V | head -1)" != "${PICOMATCH_VERSION}" ]; then \
        tar -xzf /tmp/picomatch.tgz -C $PM --strip-components=1; \
    fi && \
    /opt/node/bin/node --version && /opt/node/bin/node -p "'picomatch ' + require('$PM/package.json').version"

# ------- Runtime base -------
FROM ${RUBY_IMAGE} AS base
LABEL maintainer="Josh Mandel"
LABEL org.opencontainers.image.source=https://github.com/fhir/auto-ig-builder

RUN apt-get update && apt-get -y --no-install-recommends install \
        curl wget git openssl openssh-client graphviz \
        fontconfig fonts-dejavu-core tzdata && \
    rm -rf /var/lib/apt/lists/*

COPY --from=gem-builder /usr/local/bundle /usr/local/bundle
COPY --from=jdk /opt/java/openjdk /opt/java/openjdk
COPY --from=node /opt/node/bin /usr/local/bin
COPY --from=node /opt/node/lib /usr/local/lib
COPY --from=node /opt/node/include /usr/local/include
COPY --from=node /opt/node/share /usr/local/share

ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# ------- Begin Local Dev -------
FROM base AS localdev
LABEL maintainer="Josh Mandel"
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
        inotify-tools python3 python3-venv && \
    rm -rf /var/lib/apt/lists/*

COPY ./ci-files/watch-and-publish /usr/local/bin/watch-and-publish
COPY ./ci-files/publish /usr/local/bin/publish

RUN groupadd -r fhirgroup -g 2000 && \
    useradd -r -u 1000 -g fhirgroup -m -d /home/fhiruser -s /sbin/nologin fhiruser && \
    mkdir /app /var/lib/.fhir  && \
    chown fhiruser:fhirgroup /app && \
    chown fhiruser:fhirgroup /var/lib/.fhir && \
    ln -s /var/lib/.fhir /home/fhiruser/.fhir

USER fhiruser

# builder.py runs `npm -g install fsh-sushi` as this user; give global
# installs a home of its own instead of making /usr/local writable.
ENV NPM_CONFIG_PREFIX=/home/fhiruser/.npm-global
ENV PATH="/home/fhiruser/.npm-global/bin:${PATH}"
RUN mkdir -p /home/fhiruser/.npm-global

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
