FROM java:8
MAINTAINER Josh Mandel

# Install required packages
RUN apt-get update
RUN apt-get install -y  --force-yes jekyll
RUN gem install jekyll-asciidoc


RUN wget http://build.fhir.org/org.hl7.fhir.igpublisher.jar
RUN git clone --depth 1 https://github.com/hl7-fhir/fhir-svn/ fhir
RUN java -jar org.hl7.fhir.igpublisher.jar -ig fhir/tests/ig/test-ig.json

ENV HOME /
ENV CLOUDSDK_PYTHON_SITEPACKAGES 1
RUN wget https://dl.google.com/dl/cloudsdk/channels/rapid/google-cloud-sdk.zip && unzip google-cloud-sdk.zip && rm google-cloud-sdk.zip
RUN google-cloud-sdk/install.sh --usage-reporting=true --path-update=true --bash-completion=true --rc-path=/.bashrc --additional-components app-engine-java app-engine-python app kubectl alpha beta gcd-emulator pubsub-emulator cloud-datastore-emulator app-engine-go bigtable
RUN google-cloud-sdk/bin/gcloud config set --installation component_manager/disable_update_check true
RUN sed -i -- 's/\"disable_updater\": false/\"disable_updater\": true/g' /google-cloud-sdk/lib/googlecloudsdk/core/config.json

ENV PATH $PATH:/google-cloud-sdk/bin/

RUN mkdir /app
ADD builder /app/builder
ADD publish_local.py /app/
