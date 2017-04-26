FROM ubuntu:16.04

RUN apt-get update
RUN apt-get install -y openssh-server supervisor

RUN mkdir /var/run/sshd
RUN useradd -m -r -s /bin/bash fhir_upload
RUN mkdir /home/fhir_upload/.ssh
RUN echo "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDRh4advuDXquHexIHn44hY5E1oO8iay98ogCe4iLd/SDwsG7WzE77dnMsFpMmSAdQqbSmNLGKX87v3du0CzgQiGB5E+u4QxAqWBwfTRRyyLaBOryW5KDIwBmNkZPoI4sA5MT/sliNg0Cpaygw5n1oQA9Bk1ehdAIWLFEjXD0J+LUDQ0LEueF+eUwdJbPQjiLy2KogZ7+9rjRofx8G1MxxZGjikuiKd2s+sM/7Ikens84itpCG0/B9DO32QKRA5Cpculq5u3EU05Crwx/cXYevSMhQwJnz7isY/t9aIFy4XExIeqxL8FSXFvyTN8uRFxbxuq2DSbUZ9JzB0ixJxHiChmaQPpIQ8LkhUxJaBsEohb1S4BMKonNrHNuIoJwEpeoU/52A70glAEuQPsja2HjXQCiGVGoAmWrbWG7w8XsiAqjpxZl8QE67kMh97A41oUJSRyPaAT5QN/J1N7jkM0/7I88/uZZODkU6L2ybWOi08TVjJqFwlNvXIgM16Yem5rAOUE6jQD0EMa9U8CPaeFr2YtwKThT1IIkXRlsvjqNB3xBYf0JrDzJwIXzZVrHHwsETy1y/+3bmxpFYLo6QS4eZDsr3Htuz3k+fDbbvC+TA+JZ+x4X3b+2QB/QF4VacSom1aMf3eyCaewocrDvW+weOF/8idjo4UplCQfaj7Pqs7tQ==" > /home/fhir_upload/.ssh/authorized_keys
RUN chmod 700 /home/fhir_upload/.ssh
RUN chmod 400 /home/fhir_upload/.ssh/authorized_keys
RUN chown -R fhir_upload. /home/fhir_upload/.ssh/

VOLUME /home/fhir_upload/uploading

ADD publish publish-ig /home/fhir_upload/
RUN chown fhir_upload /home/fhir_upload/publish && chmod +x /home/fhir_upload/publish

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
RUN echo "chmod go+rwx /home/fhir_upload/uploading; /usr/bin/supervisord" > /usr/bin/setup && chmod +x /usr/bin/setup

EXPOSE 22
CMD setup
