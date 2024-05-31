FROM ghcr.io/fwcd/archlinux:latest as base
LABEL maintainer="Josh Mandel"

# Install dependencies and sudo
RUN pacman -Syu --noconfirm && \
    pacman -S --noconfirm curl git openssl wget graphviz nodejs npm base-devel sudo jdk11-openjdk && \
    pacman -Scc --noconfirm

# Create a non-root user for building AUR packages
RUN useradd -m builduser && echo "builduser ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

USER builduser
WORKDIR /home/builduser

# Install yay for AUR package management 
RUN git clone https://aur.archlinux.org/yay-bin.git && cd yay-bin && makepkg -si --noconfirm && cd .. && rm -rf yay-bin

# Install Jekyll from AUR
RUN yay -S --noconfirm jekyll

# Switch back to root to clean up and continue with other installations
USER root

# Clean up build dependencies and unnecessary files
RUN pacman -Rs --noconfirm base-devel && \
    yay -Yc --noconfirm && \
    pacman -Scc --noconfirm && \
    rm -rf /var/cache/pacman/pkg/* /tmp/* /var/tmp/* /home/builduser && \
    userdel builduser

# ------- Begin Local Dev -------
FROM scratch as localdev
LABEL maintainer="Josh Mandel"
LABEL org.opencontainers.image.source=https://github.com/fhir/auto-ig-builder

COPY --from=base / /
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
USER root
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bash"]

# ------- Begin CI -------
FROM scratch as ci
LABEL maintainer="Josh Mandel"
LABEL org.opencontainers.image.source=https://github.com/fhir/auto-ig-builder

COPY --from=base / /
ADD ./ci-files/watch-and-publish /usr/local/bin/watch-and-publish
ADD ./ci-files/publish /usr/local/bin/publish

RUN pacman -S --noconfirm inotify-tools python python-pip python-virtualenv openssl && pacman -Scc --noconfirm
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
    chmod go-wrx /home/fhiruser/.ssh/config && \
    mkdir /home/fhiruser/.node && \
    echo "prefix = /home/fhiruser/.node" > /home/fhiruser/.npmrc

RUN mkdir -p /app/builder
ADD ./ci-files/builder /app/builder
WORKDIR /app

RUN python -m venv venv

# Activate the virtual environment and install the zulip library
RUN /app/venv/bin/pip install --upgrade pip && \
    /app/venv/bin/pip install zulip

ENV PATH="/home/fhiruser/.node/bin:${PATH}"

ENTRYPOINT python -m builder.builder || touch /scratch/done
