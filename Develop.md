# Install dependencies

    apt-get install docker-engine gradle

# Build Jekyll for lambda

    docker build -t lambda_jekyll -f Dockerfile.jekyll .
    docker run --rm -v $(pwd)/extra:/tmp  lambda_jekyll cp -r ruby /tmp
    rm -rf extra/ruby/lib/ruby/gems/2.3.0/cache
    rm -rf extra/ruby/lib/ruby/gems/2.3.0/doc/

# Build lambda deployment artifact

    gradle clean  build

# Build and deploy

    ./gradlew clean build && aws lambda update-function-code --function-name ig-er --zip-file fileb://./build/distributions/ig-er.zip


# Upload to S3

    aws s3 cp build/distributions/ig-er.zip  s3://fhir-ig-deps/lambda.zip --acl public-read

 * function from `https://s3.amazonaws.com/fhir-ig-deps/lambda.zip`

# Configure lambda

    aws lambda update-function-code --function-name ig-er --zip-file fileb://./build/distributions/ig-er.zip

# Configure lambda role policy

Allow access to a limited set of S3 buckets

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket",
                "s3:CreateBucket",
                "s3:PutBucketWebsite",
                "s3:PutBucketPolicy",
                "s3:PutBucketAcl"
            ],
            "Resource": [
                "arn:aws:s3:::*.ig.fhir.org"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:*"
            ],
            "Resource": [
                "arn:aws:s3:::*.ig.fhir.org/*"
            ]
        }
    ]
}
```

# Call the thing

Example: build the SMART on FHIR docs site, and publish to an S3 bucket called `smart-5`:

    curl -X POST "https://2rxzc1u4ji.execute-api.us-east-1.amazonaws.com/prod/publish?source=https%3A%2F%2Fgithub.com%2Fsmart-on-fhir%2Fsmart-on-fhir.github.io&target=smart-5"


