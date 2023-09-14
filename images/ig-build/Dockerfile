FROM openjdk:21-jdk-bullseye
MAINTAINER Josh Mandel

RUN apt-get update && apt-get -y install python3 python3-pip gosu openssl wget graphviz ruby2.7 ruby2.7-dev inotify-tools
RUN pip3 install --upgrade  requests zulip
RUN gem install jekyll jekyll-asciidoc

RUN  cd /tmp && \
     wget --quiet https://nodejs.org/dist/v18.17.1/node-v18.17.1-linux-x64.tar.xz && \
     cd /usr/local && \
     tar --strip-components 1 -xf /tmp/node-v18.17.1-linux-x64.tar.xz

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

ENTRYPOINT python3 -m builder.builder || touch /scratch/done
