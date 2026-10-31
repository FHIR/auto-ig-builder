# Historical: how the cluster was first created in 2017. Don't use it to
# recreate the cluster; it predates Workload Identity, Shielded Nodes, the
# current node pools and every setting in dev-setup.md "Cluster security setup".
# k8s/check-cluster.sh lists what a replacement cluster must have.
gcloud container clusters create fhir-k8s \
    --num-nodes 1 \
    --disk-size 100 \
    --machine-type n1-standard-4 \
    --scopes cloud-platform
