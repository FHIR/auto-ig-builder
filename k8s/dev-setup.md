# FHIR IG Builder Development Setup

Comprehensive setup guide for developing and deploying the FHIR IG Builder on Kubernetes, supporting both local development clusters and Google Cloud Platform production deployments.

## Architecture Overview

The FHIR IG Builder consists of several components:

- **ci-build**: Main service that builds FHIR Implementation Guides
- **ig-publisher**: Container with the FHIR IG Publisher tool
- **caddy-ratelimit**: Rate-limiting reverse proxy
- **webhook triggers**: GitHub/GitLab integration for automated builds

### Workflow

1. **Trigger**: GitHub webhook or manual job submission
2. **Queue**: Kubernetes Job created for IG build
3. **Build**: ci-build container processes the IG using ig-publisher
4. **Publish**: Results uploaded to build.fhir.org
5. **Notify**: Optional Zulip notifications sent

## Prerequisites

## Choose Your Deployment Method

### Production/GCloud Deployment (Default)

1. Install `kubectl`
2. Install `gcloud`
3. Configure access to cluster

**Requirements:**

* GCloud CLI configured
* Access to `fhir-org-starter-project` GCP project
* `keyfile.ini` file (obtain from project maintainer)
* `fhir-settings.json` file (obtain from project maintainer)

**Setup:**

```bash
gcloud container clusters get-credentials fhir-k8s --zone us-east1-d
```

### Local Development

1. Install `kubectl`

**Requirements:**

- Local Kubernetes (minikube, kind, k3s, or kubeadm cluster)
- Docker

**Setup:**

```bash
# Start/prepare local cluster (choose one)

# minikube
./setup-minikube.sh  # Start minikube

# OR

# KIND 
./setup-kind.sh  # Create KIND cluster

# OR

# k3s
./setup-k3s.sh  # Start k3s

# OR

# kubeadm
./setup-kubeadm.sh  # Prepare existing kubeadm cluster

```

## Unified Setup Process

### 1. Clone and Setup Repository

```bash
git clone https://github.com/FHIR/auto-ig-builder/
cd auto-ig-builder/k8s
```

### 2. Run Setup Script

```bash
# For local development (all local types use same setup)
./setup.sh --type minikube     # for minikube
./setup.sh --type kind         # for KIND
./setup.sh --type k3s          # for k3s
./setup.sh --type kubeadm      # for kubeadm
./setup.sh --type local        # generic local (works with any)

# For local with custom registry
./setup.sh --type local --registry my-registry:5000
```

### 3. Build Images

```bash
# Build and push for GCloud (default)
./build-images.sh

# Build images for specific local deployment types
./build-images.sh --type minikube
./build-images.sh --type kind 
./build-images.sh --type k3s
./build-images.sh --type kubeadm
./build-images.sh --type local --push false  # Generic local

# Build and push to custom registry
./build-images.sh --type local --registry my-registry:5000
```

### 4. Deploy Application

```bash
kubectl apply -f ../mount/ci-build.deployment.generated.yaml
```

### 5. Verify Deployment

```bash
kubectl get pods -n fhir
kubectl get svc -n fhir
```

## Rate Limiting

The build service uses Caddy with the `caddy-ratelimit` plugin to limit requests to `qas.json` files:

- **Limit**: 100 requests per minute per IP address
- **Scope**: Only applies to external IPs; internal IPs (10.0.0.0/8) are exempt
- **Implementation**: Custom Caddy image with rate limiting configured in `k8s/Caddyfile`

This prevents abuse while allowing internal monitoring systems unlimited access.

## Recurring Tasks

### 1. Rebuild and Redeploy Images

```bash
# Use the build script for your deployment type
./build-images.sh --type minikube    # for minikube
./build-images.sh --type kind        # for KIND
./build-images.sh --type k3s         # for k3s
./build-images.sh --type kubeadm     # for kubeadm
./build-images.sh --type gcloud      # for GCloud production

# Restart deployments to use new images
kubectl rollout restart deployment/ci-build-deployment -n fhir
kubectl rollout status deployment/ci-build-deployment -n fhir
```

### 2. Local Webhook Testing

```bash
# Run webhook service locally (for development)
cd triggers/ig-commit-trigger
npm install
npm start

# Or deploy webhook to cluster
kubectl apply -f ig-commit-trigger-service.yaml
```

### 3. Monitor Build Jobs

```bash
# Watch running jobs
kubectl get jobs -n fhir -w

# Check job logs
kubectl logs job/<job-name> -n fhir

# Test with example job
kubectl apply -f example-job-for-minikube.yaml
kubectl logs job/test-ig-build -n fhir --follow
```

## Complete Local Setup Examples

### minikube Setup

```bash
# Step 1: Cluster Preparation
./setup-minikube.sh

# Step 2: Build and Deploy
./setup.sh --type minikube
./build-images.sh --type minikube
kubectl apply -f ../mount/ci-build.deployment.generated.yaml

# Step 3: Test
kubectl get pods -n fhir
kubectl apply -f example-job-for-minikube.yaml
```

### KIND Setup (Recommended)

```bash
# Step 1: Cluster Preparation
./setup-kind.sh

# Step 2: Build and Deploy
./setup.sh --type kind
./build-images.sh --type kind
kubectl apply -f ../mount/ci-build.deployment.generated.yaml

# Step 3: Test
kubectl get pods -n fhir
kubectl apply -f example-job-for-minikube.yaml
```

### k3s Setup

```bash
# Step 1: Cluster Preparation
./setup-k3s.sh

# Step 2: Build and Deploy
./setup.sh --type k3s
./build-images.sh --type k3s
kubectl apply -f ../mount/ci-build.deployment.generated.yaml

# Step 3: Test
kubectl get pods -n fhir
kubectl apply -f example-job-for-minikube.yaml
```

### kubeadm Setup

```bash
# Step 1: Cluster Preparation (manual - see prerequisites below)
./setup-kubeadm.sh

# Step 2: Build and Deploy
./setup.sh --type kubeadm
./build-images.sh --type kubeadm
kubectl apply -f ../mount/ci-build.deployment.generated.yaml

# Step 3: Test
kubectl get pods -n fhir
kubectl apply -f example-job-for-minikube.yaml
```

### Generic Local Setup

```bash
# For any existing Kubernetes cluster
./setup.sh --type local
./build-images.sh --type local --push false
kubectl apply -f ../mount/ci-build.deployment.generated.yaml

# Test
kubectl get pods -n fhir
kubectl apply -f example-job-for-minikube.yaml
```

## Troubleshooting

### Common Issues

**Pod Not Starting:**
```bash
# Check pod status
kubectl describe pod -l app=ci-build -n fhir
kubectl logs -l app=ci-build -n fhir
```

**Image Pull Failures:**
```bash
# For minikube - ensure Docker environment is set
eval $(minikube docker-env)
docker images | grep -E "(ig-publisher|ci-build|caddy-ratelimit)"

# For KIND - check image loading
kind load docker-image ig-publisher:latest --name fhir-ig-builder
```

**Storage Issues:**
```bash
# Check persistent volumes
kubectl get pv,pvc -n fhir
kubectl describe pvc fhir-volume-claim -n fhir

# Check node storage
df -h /tmp/fhir-*
```

**Networking Problems:**
```bash
# Test service connectivity
kubectl port-forward service/ci-build-service 8080:80 -n fhir
curl http://localhost:8080/

# Check endpoints
kubectl get endpoints -n fhir
```

### Deployment-Specific Troubleshooting

Refer to the comprehensive troubleshooting section in [README.md](README.md) for detailed deployment-specific issues and solutions.

## Cleanup

### Quick Cleanup (Preserve Cluster)

```bash
# Remove namespace and all resources
kubectl delete namespace fhir

# Remove generated files
rm -f ../mount/ci-build.deployment.generated.yaml
rm -f ../mount/kubeadm-persistent-volumes.yaml
rm -f ../mount/kubeadm-node-selector.yaml
rm -f ../mount/id
rm -f ../mount/id.pub
```

### Complete Cleanup (Remove Cluster)

```bash
# For minikube
minikube stop && minikube delete

# For KIND
kind delete cluster --name fhir-ig-builder

# For k3s
sudo systemctl stop k3s
sudo rm -rf /var/lib/rancher/k3s

# For kubeadm (careful - removes entire cluster)
# kubectl delete namespace fhir
# sudo kubeadm reset
```

For comprehensive cleanup procedures, see [README.md](README.md#cleanup-procedures).

## kubeadm Prerequisites

* Functioning kubeadm cluster with kubectl access
* Sufficient resources (20GB+ memory, 100GB+ storage per node)  
* Storage provisioner (local-path, OpenEBS, Longhorn, etc.)
* Container runtime (Docker, containerd, or CRI-O)
* Optional: Local container registry or pull access to gcr.io

## Development Workflow

### Making Changes

1. **Code Changes**: Modify files in `images/` directories
2. **Rebuild**: Run `./build-images.sh --type <your-type>`
3. **Redeploy**: `kubectl rollout restart deployment/ci-build-deployment -n fhir`
4. **Test**: Submit test job with `kubectl apply -f example-job-for-minikube.yaml`

### Debugging Builds

```bash
# Watch build logs in real-time
kubectl logs job/<job-name> -n fhir --follow

# Get shell access to running pod
kubectl exec -it deployment/ci-build-deployment -n fhir -- /bin/bash

# Check build artifacts
kubectl exec deployment/ci-build-deployment -n fhir -- ls -la /tmp/
```

## Additional Resources

- [Main README](../README.md) - Project overview and usage
- [Architecture Slides](https://docs.google.com/presentation/d/12JykZwSdQ1pwSuzP2fGZSXr3jYMmvEcwVgNAy3dWr_U/present)
- [Video Walkthrough](https://youtu.be/VVbF1O4pgQA)
- [FHIR IG Publisher Documentation](https://confluence.hl7.org/display/FHIR/IG+Publisher+Documentation)
