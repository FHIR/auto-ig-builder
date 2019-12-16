#!/bin/bash

PAT=$1

echo debconf shared/accepted-oracle-license-v1-1 select true | \
	        sudo debconf-set-selections
echo debconf shared/accepted-oracle-license-v1-1 seen true | \
	        sudo debconf-set-selections

sudo DEBIAN_FRONTEND=noninteractive add-apt-repository -y ppa:webupd8team/java
sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -yq oracle-java8-installer ant python-pip ruby ruby2.5-dev

pip install zulip
cd
wget https://vstsagentpackage.azureedge.net/agent/2.136.1/vsts-agent-linux-x64-2.136.1.tar.gz

sudo gem install jekyll jekyll-asciidoc

mkdir agents
cd agents
for agent in "01" "02" "03" "04";
do
  mkdir $agent
  cd $agent
  tar -xzvf ~/vsts-agent-linux-x64-2.136.1.tar.gz
  echo ./config.sh --auth pat --token $PAT --url https://fhir-build.visualstudio.com/ --agent agent-${agent} --runAsService --unattended
  ./config.sh --auth pat --token $PAT --url https://fhir-build.visualstudio.com/ --agent agent-${agent} --runAsService --unattended
  sudo ./svc.sh install
  sudo ./svc.sh start
  cd ..
done

# Manually add deploy key (should encrypt with passphrasae, and a protected env var if VSTS supports
echo -e "Host build.fhir.org\n  Compression yes\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null
\n  User fhir_upload" > ~/.ssh/config
