# Install dependencies

    apt-get install docker-engine gradle

# Build Jekyll for lambda

    docker build -t lambda_jekyll -f Dockerfile.jekyll .
    docker run --rm -v $(pwd)/extras:/tmp  lambda_jekyll cp -r ruby /tmp
    rm -rf extra/ruby/lib/ruby/gems/2.3.0/cache
    rm -rf extra/ruby/lib/ruby/gems/2.3.0/doc/

# Build lambda deployment artifact

    gradle clean  build
