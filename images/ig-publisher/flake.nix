{
  description = "Docker image with Java, Ruby, Jekyll, Node, and npm";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    fhirPublisherJarFile = {
      url = "https://github.com/HL7/fhir-ig-publisher/releases/download/1.6.7/publisher.jar";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, fhirPublisherJarFile }:
    let
      pkgs = import nixpkgs { system = "x86_64-linux"; };
      tarballPath = pkgs.dockerTools.pullImage {
        imageName = "alpine";
        imageDigest = "sha256:c5b1261d6d3e43071626931fc004f70149baeba2c8ec672bd4f27761f8e1ad6b";
        sha256 = "1sqv78kskab3f9cby9njlr67g1pnm748msza2nf61wbnnf98dyjz";
        finalImageName = "alpine";
        finalImageTag = "latest";
      };
    in
    {
      packages.x86_64-linux.default = pkgs.dockerTools.buildImage {
        name = "ghcr.io/fhir/ig-publisher-localdev-nix";
        tag = "latest";
        fromImage = tarballPath;
        copyToRoot = pkgs.buildEnv {
          name = "image-root";
          paths = with pkgs; [
            shadow
            curl
            wget
            jq
            bash
            jdk
            bashInteractive
            readline
            ncurses
            jekyll
            nodejs
            nodePackages.npm
            git
            graphviz
            openssl
            (pkgs.runCommand "copy-files" {} ''
              mkdir -p $out/usr/local/bin
              cp ${./localdev-files/docker-entrypoint.sh} $out/usr/local/bin/docker-entrypoint.sh
              mkdir -p $out/app/lib
              cp ${fhirPublisherJarFile} $out/app/lib/publisher.jar
            '')
          ];
        };
        config = {
          Entrypoint = [ "/usr/local/bin/docker-entrypoint.sh" ];
          Cmd = [ "bash" ];
          WorkingDir = "/home/publisher/ig";
          Env = [
            "PATH=/usr/local/bin:/usr/bin:/bin:/home/publisher/bin:/home/publisher/bin/ig-publisher-scripts:/home/publisher/.node/bin"
          ];
          User = "publisher";
          ExposedPorts = {
            "4000/tcp" = {};
          };
        };

        runAsRoot = ''
          useradd -d /home/publisher -m publisher
          chown -R publisher:publisher /home/publisher
          su - publisher -c '
            mkdir /home/publisher/ig
            mkdir /home/publisher/.node
            echo "prefix = /home/publisher/.node" > /home/publisher/.npmrc
            mkdir /home/publisher/bin
            git config --global pull.ff only
          '

        '';

      };
    };
}
