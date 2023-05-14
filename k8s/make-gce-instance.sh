gcloud container clusters create fhir-k8s \
    --num-nodes 1 \
    --disk-size 100 \
    --machine-type n1-standard-4 \
    --scopes cloud-platform
