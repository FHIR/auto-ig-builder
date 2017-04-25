FROM java:8
MAINTAINER Josh Mandel

# Install required packages
RUN apt-get update
RUN apt-get install -y  --force-yes jekyll git python-pip
RUN gem install jekyll-asciidoc

ENV HOME /
ENV CLOUDSDK_PYTHON_SITEPACKAGES 1
RUN wget https://dl.google.com/dl/cloudsdk/channels/rapid/google-cloud-sdk.zip && unzip google-cloud-sdk.zip && rm google-cloud-sdk.zip
RUN google-cloud-sdk/install.sh --usage-reporting=true --path-update=true --bash-completion=true --rc-path=/.bashrc --additional-components app-engine-java app-engine-python app kubectl alpha beta gcd-emulator pubsub-emulator cloud-datastore-emulator app-engine-go bigtable
RUN google-cloud-sdk/bin/gcloud config set --installation component_manager/disable_update_check true
RUN sed -i -- 's/\"disable_updater\": false/\"disable_updater\": true/g' /google-cloud-sdk/lib/googlecloudsdk/core/config.json
ENV PATH $PATH:/google-cloud-sdk/bin/

RUN mkdir -p /app/builder && mkdir /ig && mkdir /scratch
ADD builder /app/builder
WORKDIR /app
RUN pip install requests zulip
ENTRYPOINT python2.7 -m builder.builder
