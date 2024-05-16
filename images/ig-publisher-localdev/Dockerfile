FROM ghcr.io/fhir/ig-publisher-base:latest
LABEL maintainer="Josh Mandel"

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

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
