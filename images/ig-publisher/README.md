### IG Publisher Docker Images


## Overview

This project provides Docker images for the FHIR IG Publisher, designed to support both local development and continuous integration builds. The setup includes a common base image with essential dependencies and two specific images: `localdev` for local development and `ig-build` for automated builds.

### Docker Images

#### Base Image

- **Purpose**: Contains common dependencies required for both local development and CI builds.
- **Dependencies**: Java, Node.js, Ruby, Jekyll, AsciiDoctor.

#### Local Development Image (`localdev`)

- **Purpose**: Provides an environment for local development and testing of the FHIR IG Publisher.
- **Dependencies**: Inherits from the base image and includes additional configurations for local development.
- **Entry Point**: `docker-entrypoint.sh`

#### CI Build Image (`ci`)

- **Purpose**: Designed for continuous integration pipelines, automating the build and publishing of FHIR Implementation Guides.
- **Dependencies**: Inherits from the base image and includes Python, necessary scripts, and configurations for CI builds.
- **Entry Point**: Executes `builder.py` script.

### Building the Images

You can build and tag each image using Docker's multi-stage build feature.

1. **Build the Base Image**

```sh
docker build --target base -t ghcr.io/fhir/ig-publisher-base .
```

2. **Build the Local Development Image**

```sh
docker build --target localdev -t ghcr.io/fhir/ig-publisher-localdev .
```

3. **Build the CI Build Image**

```sh
docker build --target ci -t ghcr.io/fhir/ig-publisher-ci .
```

### Multiplatform build

```sh
docker buildx build   --platform linux/arm64,linux/amd64 .
```


### Usage

#### Local Development

1. **Run the Local Development Container**

```sh
docker run -it --rm -v $(pwd)/ig:/home/publisher/ig ghcr.io/fhir/ig-publisher-localdev
```

Inside the Docker container, you'll have access to the following commands:

- `_updatePublisher.sh` — download the latest FHIR IG Publisher jar.
- `_genonce.sh` — run Sushi + FHIR IG Publisher to create output.
- `_gencontinuous.sh` — run Sushi + FHIR IG Publisher in "watch mode".

#### Build an Implementation Guide (IG)

Mount an IG into the Docker container at `/home/publisher/ig`. For example:

```sh
cd /path/to/my-ig
docker run --rm -it -v $(pwd):/home/publisher/ig ghcr.io/fhir/ig-publisher-localdev
```

#### Build the Core FHIR Spec

Mount the FHIR core spec into the Docker container at `/home/publisher/ig`. For example:

```sh
git clone https://github.com/hl7/fhir
cd fhir

docker run --rm -it \
  -v $(pwd):/home/publisher/ig \
  ghcr.io/fhir/ig-publisher-localdev \
  ./publish.sh
```

Avoid downloading dependencies like Gradle and Kindling on each run by mounting a `/home/publisher/.gradle` directory into the container:

```sh
cd fhir
mkdir .gradle

docker run --rm -it \
  -v $(pwd)/.gradle:/home/publisher/.gradle \
  -v $(pwd):/home/publisher/ig \
  ghcr.io/fhir/ig-publisher-localdev \
  ./publish.sh
```

Similarly, avoid downloading FHIR cache entries repeatedly by mounting a `/home/publisher/.fhir` directory into the container:

```sh
cd fhir
mkdir .fhir

docker run --rm -it \
  -v $(pwd)/.fhir:/home/publisher/.fhir \
  -v $(pwd):/home/publisher/ig \
  ghcr.io/fhir/ig-publisher-localdev \
  ./publish.sh
```

Combine these mounts:

```sh
cd fhir

mkdir .gradle
mkdir .fhir

docker run --rm -it \
  -v $(pwd)/.fhir:/home/publisher/.fhir \
  -v $(pwd)/.gradle:/home/publisher/.gradle \
  -v $(pwd):/home/publisher/ig \
  ghcr.io/fhir/ig-publisher-localdev \
  ./publish.sh
```

To maintain these volumes elsewhere, e.g., as system-wide shared resources in your host filesystem, mount them from elsewhere:

```sh
-v /home/$USER/.fhir:/home/publisher/.fhir
```

### Running on WSL2

Using this image to build your IG using Docker on WSL2 is slow due to a known limitation when mounting the Windows filesystem. You can run the IG publisher without Docker by following the instructions at [IG Publisher Documentation](https://confluence.hl7.org/display/FHIR/IG+Publisher+Documentation#IGPublisherDocumentation-Installing); or you can improve performance in WSL2 by first copying your input files inside WSL and mounting them from there.

Save this as `run.sh`:

```sh
#!/bin/bash
echo "Copying current folder over to WSL filesystem"
mkdir -p ~/.fhir
mkdir -p ~/ig-publisher
cp ./* ~/ig-publisher
cp -R ./input ~/ig-publisher
cp -R ./input-cache ~/ig-publisher

echo "Starting Docker"
docker run --rm -it -v ~/ig-publisher:/home/publisher/ig -v ~/.fhir:/home/publisher/.fhir ghcr.io/fhir/ig-publisher-localdev "$@"

echo "Copying back to Windows filesystem"
cp -R ~/ig-publisher/output .

#rm -r ~/ig-publisher
```

Then build your IG with:

```sh
wsl ./run.sh _genonce.sh
```

### Contributing

Please ensure that your contributions align with the project's coding standards and conventions. Fork the repository, make your changes, and submit a pull request for review.

### License

This project is licensed under the MIT License.

### Maintainers

- Josh Mandel

### Additional Resources

For more information on the FHIR IG Publisher, visit the [official documentation](https://confluence.hl7.org/display/FHIR/IG+Publisher+Documentation).
