FROM ghcr.io/fhir/ig-publisher-base:latest
LABEL maintainer="Josh Mandel"

RUN apt-get update && apt-get -y install python3 python3-pip python3-venv python3-requests openssl && \
    apt-get clean

ADD watch-and-publish /usr/local/bin/watch-and-publish
ADD publish /usr/local/bin/publish

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
ADD builder /app/builder
WORKDIR /app

RUN python3 -m venv venv

# Activate the virtual environment and install the zulip library
RUN /app/venv/bin/pip install --upgrade pip && \
    /app/venv/bin/pip install zulip

ENTRYPOINT python3 -m builder.builder || touch /scratch/done
