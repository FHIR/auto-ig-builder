gcloud container clusters create fhir-k8s \
    --num-nodes 1 \
    --disk-size 100 \
    --machine-type n1-standard-4 \
    --scopes cloud-platform

gcloud compute --project "fhir-org-starter-project" \
    instances create "fhir-build" \
    --zone "us-east1-d" \
    --machine-type "custom-2-8192" \
    --subnet "default" --address 35.185.17.144 \
    --metadata "ssh-keys=jmandel:ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC02Vm42jsJhGRmHp85AJGPrYYZYCY5lA9AOKtz8Dj0OL7+lVHiGYQp8atFVrGc384wOQraY0+I57mXzKnGksgSmZ11LgZ/JQousB3qTMNUUVPIy6lgnASx51YxQCZzS3Yg6ocAemcUSiMOOZxpTLXIe1e9USPKRcuNDDGSQWkTP/rp78/PGFMMYHNjex21ioEFzEKbP96K0rImU9pkQ1ndEYj4+NDuC1OjmPOIUvwJwpGfUzceYiHtwfe6eyBXKKEp+475bW+NDobns2idWRJCkMY5i3djhVNGCzpRHzuO0BzP6wWRyKZ/M0/KRHGhgbEnbMOvu8XkjTtJyEE+p0QL jmandel@morel" \
    --maintenance-policy "MIGRATE" \
    --service-account "fhir-build-gce@fhir-org-starter-project.iam.gserviceaccount.com"\
    --scopes "https://www.googleapis.com/auth/cloud-platform" \
    --tags "http-server","https-server" \
    --image "ubuntu-1604-xenial-v20170330" \
    --image-project "ubuntu-os-cloud" \
    --boot-disk-size "100" \
    --boot-disk-type "pd-standard" \
    --boot-disk-device-name "fhir-build-boot-disk"
gcloud compute --project "fhir-org-starter-project" \
    instances create "fhir-zulip" \
    --zone "us-east1-d" \
    --machine-type "custom-2-8192" \
    --subnet "default" --address 104.196.157.89 \
    --maintenance-policy "MIGRATE" \
    --service-account "fhir-zulip-gce@fhir-org-starter-project.iam.gserviceaccount.com"\
    --scopes "https://www.googleapis.com/auth/cloud-platform" \
    --tags "http-server","https-server" \
    --image "ubuntu-1604-xenial-v20170330" \
    --image-project "ubuntu-os-cloud" \
    --boot-disk-size "200" \
    --boot-disk-type "pd-standard" \
    --boot-disk-device-name "fhir-build-boot-disk"
