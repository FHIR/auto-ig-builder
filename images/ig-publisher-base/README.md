## FHIR Publisher for local development

### Get the image locally

    # Pull from Docker Hub
    docker pull hl7fhir/ig-publisher-base

    # Build it yourself
    git clone https://github.com/fhir/auto-ig-builder
    cd auto-ig-builder/images/ig-publisher-base
    docker build -t hl7fhir/ig-publisher-base .

## Build an IG

You'll want to mount an IG into the Docker container at `/home/publisher/ig`. For example:

```
cd /path/to/my-ig
docker run --rm -it -v $(pwd):/home/publisher/ig hl7fhir/ig-publisher-base:latest
```

Inside the docker container, you'll have access to the following commands:

* `_updatePublisher.sh` -- download the latest FHIR IG Publisher jar
* `_genonce.sh` -- run sushi + FHIR IG PUblisher to create output
* `_gencontinuous.sh` -- run sushi + FHIR IG PUblisher in "watch mode"


## Build the core FHIR spec

You'll want to mount the FHIR core spec into the Docker container at `/home/publisher/ig`. For example:


```
git clone https://github.com/hl7/fhir
cd fhir

docker run --rm -it \
  -v $(pwd):/home/publisher/ig \
  hl7fhir/ig-publisher-base:latest \
  ./publish.sh
```


If you want to avoid downloading depenencies like gradle and kindling on each
run, you can mount a `/home/publisher/.gradle` directory into the container:

```
cd fhir
mkdir .gradle

docker run --rm -it \
  -v $(pwd)/.gradle:/home/publisher/.gradle \
  -v $(pwd):/home/publisher/ig \
  hl7fhir/ig-publisher-base:latest \
  ./publish.sh

```

Similarly if you wan to avoid downloading FHIR cache entries repeatedly, you
can mount a `/home/publisher/.fhir` directory into the container:

```
cd fhir
mkdir .fhir

docker run --rm -it \
  -v $(pwd)/.fhir:/home/publisher/.fhir \
  -v $(pwd):/home/publisher/ig \
  hl7fhir/ig-publisher-base:latest \
  ./publish.sh
```

And of course these can be combined:

```
cd fhir

mkdir .gradle
mkdir .fhir

docker run --rm -it \
  -v $(pwd)/.fhir:/home/publisher/.fhir \
  -v $(pwd)/.gradle:/home/publisher/.gradle \
  -v $(pwd):/home/publisher/ig \
  hl7fhir/ig-publisher-base:latest \
  ./publish.sh
```

If you prefer to maintain these volumes elsewhere, e.g., as system-wide shared
resources in your host filesystem, you can mount them from elsewhere. For
instance, to bring in the `.fhir` cache from your host machine home directory:

    -v /home/$USER/.fhir:/home/publisher/.fhir
