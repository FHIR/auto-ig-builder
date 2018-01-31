FROM ubuntu:16.04

RUN apt-get update
RUN apt-get install -y openssh-server supervisor curl jq

RUN mkdir /var/run/sshd
RUN useradd -m -r -s /bin/bash fhir_upload && \
    mkdir /home/fhir_upload/.ssh && \
    touch /home/fhir_upload/.ssh/authorized_keys && \
    chmod 700 /home/fhir_upload/.ssh && \
    chmod 400 /home/fhir_upload/.ssh/authorized_keys && \
    chown -R fhir_upload. /home/fhir_upload/.ssh/

VOLUME /home/fhir_upload/uploading

ADD publish publish-ig /home/fhir_upload/
RUN chown fhir_upload /home/fhir_upload/publish && chmod +x /home/fhir_upload/publish

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 22
CMD echo $SSH_AUTHORIZED_KEY >> /home/fhir_upload/.ssh/authorized_keys && /usr/bin/supervisord
