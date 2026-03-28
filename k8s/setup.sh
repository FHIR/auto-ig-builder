#!/bin/bash

# Unified setup script for both local and GCloud deployments

set -e

# Configuration
DEPLOYMENT_TYPE="${DEPLOYMENT_TYPE:-gcloud}"
REGISTRY_PREFIX="${REGISTRY_PREFIX:-gcr.io/fhir-org-starter-project}"
NAMESPACE="${NAMESPACE:-fhir}"

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Setup FHIR IG Builder for either local or GCloud deployment.

OPTIONS:
    -t, --type TYPE         Deployment type: 'local', 'minikube', 'kind', 'k3s', 'kubeadm', or 'gcloud' (default: gcloud)
    -r, --registry PREFIX   Registry prefix (default: gcr.io/fhir-org-starter-project for gcloud, localhost:5000 for local types)
    -n, --namespace NS      Kubernetes namespace (default: fhir)
    -h, --help             Show this help message

ENVIRONMENT VARIABLES:
    DEPLOYMENT_TYPE         Same as --type
    REGISTRY_PREFIX         Same as --registry
    NAMESPACE              Same as --namespace
    ZULIP_EMAIL            Email for Zulip notifications
    ZULIP_API_KEY          API key for Zulip

EXAMPLES:
    # GCloud setup (default)
    $0

    # GCloud with explicit registry
    $0 --type gcloud --registry gcr.io/fhir-org-starter-project

    # Local setup with minikube/kind
    $0 --type local --registry localhost:5000

    # kubeadm cluster setup
    $0 --type kubeadm --registry localhost:5000

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--type)
            DEPLOYMENT_TYPE="$2"
            shift 2
            ;;
        -r|--registry)
            REGISTRY_PREFIX="$2"
            shift 2
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option $1"
            usage
            exit 1
            ;;
    esac
done

# Validate deployment type
if [[ "$DEPLOYMENT_TYPE" != "local" && "$DEPLOYMENT_TYPE" != "gcloud" && "$DEPLOYMENT_TYPE" != "kubeadm" && "$DEPLOYMENT_TYPE" != "minikube" && "$DEPLOYMENT_TYPE" != "kind" && "$DEPLOYMENT_TYPE" != "k3s" ]]; then
    echo "Error: DEPLOYMENT_TYPE must be 'local', 'minikube', 'kind', 'k3s', 'kubeadm', or 'gcloud'"
    exit 1
fi

# Set defaults based on deployment type
if [[ ("$DEPLOYMENT_TYPE" == "local" || "$DEPLOYMENT_TYPE" == "minikube" || "$DEPLOYMENT_TYPE" == "kind" || "$DEPLOYMENT_TYPE" == "k3s" || "$DEPLOYMENT_TYPE" == "kubeadm") && "$REGISTRY_PREFIX" == "gcr.io/fhir-org-starter-project" ]]; then
    REGISTRY_PREFIX="localhost:5000"
elif [[ "$DEPLOYMENT_TYPE" == "gcloud" && "$REGISTRY_PREFIX" == "localhost:5000" ]]; then
    REGISTRY_PREFIX="gcr.io/fhir-org-starter-project"
fi

# Handle empty registry prefix for local image builds
if [[ "$REGISTRY_PREFIX" == "" ]]; then
    # For local builds without registry, just use image names directly
    export CI_BUILD_IMAGE="ci-build:latest"
    export CADDY_IMAGE="caddy-ratelimit:latest"
else
    # Use registry prefix
    export CI_BUILD_IMAGE="${REGISTRY_PREFIX}/ci-build:latest"
    export CADDY_IMAGE="${REGISTRY_PREFIX}/caddy-ratelimit:latest"
fi

echo "Setting up FHIR IG Builder..."
echo "Deployment Type: $DEPLOYMENT_TYPE"
echo "Registry: $REGISTRY_PREFIX"
echo "Namespace: $NAMESPACE"
echo

# Create namespace
kubectl create ns "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# Create SSH keys for CI build
if [ ! -f ../mount/id ]; then
    echo "Generating SSH keys in mount directory..."
    ssh-keygen -t rsa -f ../mount/id -N ""
fi

# Create secrets
echo "Creating secrets..."

# CI build keys
kubectl -n "$NAMESPACE" create secret generic ci-build-keys \
    --from-file=id=../mount/id \
    --from-file=id.pub=../mount/id.pub \
    --dry-run=client -o yaml | kubectl apply -f -

# FHIR settings - create files if they don't exist for all deployment types
if [ ! -f ../mount/keyfile.ini ]; then
    if [[ "$DEPLOYMENT_TYPE" == "gcloud" ]]; then
        echo "Creating placeholder keyfile.ini for GCloud deployment..."
        echo "# Please replace with actual keyfile.ini from project maintainer" > ../mount/keyfile.ini
        echo "Warning: Using placeholder keyfile.ini. Builds may fail without real credentials."
    else
        echo "Creating dummy keyfile.ini for local development..."
        echo "# Dummy keyfile for local development" > ../mount/keyfile.ini
    fi
fi

if [ ! -f ../mount/fhir-settings.json ]; then
    if [[ "$DEPLOYMENT_TYPE" == "gcloud" ]]; then
        echo "Creating placeholder fhir-settings.json for GCloud deployment..."
        echo '{"warning": "Please replace with actual fhir-settings.json from project maintainer"}' > ../mount/fhir-settings.json
        echo "Warning: Using placeholder fhir-settings.json. Builds may fail without real settings."
    else
        echo "Creating dummy fhir-settings.json for local development..."
        echo '{}' > ../mount/fhir-settings.json
    fi
fi

# Create Kubernetes secret for all deployment types
kubectl -n "$NAMESPACE" create secret generic fhir-settings \
    --from-file=keyfile.ini=../mount/keyfile.ini \
    --from-file=fhir-settings.json=../mount/fhir-settings.json \
    --dry-run=client -o yaml | kubectl apply -f -

echo "Created fhir-settings secret with:"
if [[ "$DEPLOYMENT_TYPE" == "gcloud" ]]; then
    echo "  - keyfile.ini (placeholder - replace with real credentials)"
    echo "  - fhir-settings.json (placeholder - replace with real settings)"
else
    echo "  - keyfile.ini (dummy for local development)"
    echo "  - fhir-settings.json (dummy for local development)"
fi

# Zulip secrets
ZULIP_EMAIL="${ZULIP_EMAIL:-bot@localhost}"
ZULIP_API_KEY="${ZULIP_API_KEY:-dummy-api-key}"

if [[ "$DEPLOYMENT_TYPE" == "gcloud" && ("$ZULIP_EMAIL" == "bot@localhost" || "$ZULIP_API_KEY" == "dummy-api-key") ]]; then
    echo "Warning: Using dummy Zulip credentials for GCloud deployment."
    echo "Set ZULIP_EMAIL and ZULIP_API_KEY environment variables for production use."
elif [[ "$DEPLOYMENT_TYPE" == "kubeadm" && ("$ZULIP_EMAIL" == "bot@localhost" || "$ZULIP_API_KEY" == "dummy-api-key") ]]; then
    echo "Info: Using dummy Zulip credentials for kubeadm deployment."
    echo "Set ZULIP_EMAIL and ZULIP_API_KEY environment variables for production notifications."
fi

kubectl -n "$NAMESPACE" create secret generic zulip-secrets \
    --from-literal=email="$ZULIP_EMAIL" \
    --from-literal=api_key="$ZULIP_API_KEY" \
    --dry-run=client -o yaml | kubectl apply -f -

# Setup storage based on deployment type
if [[ "$DEPLOYMENT_TYPE" == "local" || "$DEPLOYMENT_TYPE" == "minikube" || "$DEPLOYMENT_TYPE" == "kind" || "$DEPLOYMENT_TYPE" == "k3s" ]]; then
    echo "Setting up local persistent volumes..."
    envsubst < persistent-volumes.template.yaml | kubectl apply -f -
elif [[ "$DEPLOYMENT_TYPE" == "kubeadm" ]]; then
    echo "Setting up kubeadm persistent volumes..."
    if [[ -f kubeadm-persistent-volumes.yaml ]]; then
        kubectl apply -f kubeadm-persistent-volumes.yaml
    else
        echo "Warning: kubeadm-persistent-volumes.yaml not found."
        echo "Run ./setup-kubeadm.sh first to configure storage."
        envsubst < persistent-volumes.template.yaml | kubectl apply -f -
    fi
elif [[ "$DEPLOYMENT_TYPE" == "gcloud" ]]; then
    echo "Setting up GCloud persistent disks..."

    # Check if disks exist, create if not
    if ! gcloud compute disks describe fhir-ci-build-disk --zone=us-east1-d &>/dev/null; then
        echo "Creating fhir-ci-build-disk..."
        gcloud compute disks create fhir-ci-build-disk --size 100GB --zone=us-east1-d
    fi

    if ! gcloud compute disks describe caddy-cert-disk --zone=us-east1-d &>/dev/null; then
        echo "Creating caddy-cert-disk..."
        gcloud compute disks create caddy-cert-disk --size=10GB --zone=us-east1-d
    fi
fi

# Create Caddy configuration
echo "Creating Caddy configuration..."
kubectl -n "$NAMESPACE" create configmap caddy-conf-volume \
    --from-file=Caddyfile \
    --dry-run=client -o yaml | kubectl apply -f -

# Apply base configurations
echo "Applying base configurations..."
kubectl apply -f ci-build.configmap.yaml
kubectl apply -f ci-build.service.yaml

# Create service account
kubectl -n "$NAMESPACE" create serviceaccount igbuild --dry-run=client -o yaml | kubectl apply -f -

# Generate deployment configuration
echo "Generating deployment configuration..."
export DEPLOYMENT_TYPE REGISTRY_PREFIX NAMESPACE CI_BUILD_IMAGE CADDY_IMAGE

# Set variables for template substitution
if [[ "$DEPLOYMENT_TYPE" == "minikube" ]]; then
    export IMAGE_PULL_POLICY="Never"
    export VOLUMES_CONFIG="      - name: caddy-cert-disk
        persistentVolumeClaim:
          claimName: caddy-cert-pvc
      - name: fhir-ci-build-disk
        persistentVolumeClaim:
          claimName: fhir-ci-build-pvc"
    export NODE_SELECTOR_CONFIG=""
elif [[ "$DEPLOYMENT_TYPE" == "kind" || "$DEPLOYMENT_TYPE" == "local" ]]; then
    export IMAGE_PULL_POLICY="Never"
    export VOLUMES_CONFIG="      - name: caddy-cert-disk
        persistentVolumeClaim:
          claimName: caddy-cert-pvc
      - name: fhir-ci-build-disk
        persistentVolumeClaim:
          claimName: fhir-ci-build-pvc"
    export NODE_SELECTOR_CONFIG=""
elif [[ "$DEPLOYMENT_TYPE" == "k3s" ]]; then
    export IMAGE_PULL_POLICY="IfNotPresent"
    export VOLUMES_CONFIG="      - name: caddy-cert-disk
        persistentVolumeClaim:
          claimName: caddy-cert-pvc
      - name: fhir-ci-build-disk
        persistentVolumeClaim:
          claimName: fhir-ci-build-pvc"
    export NODE_SELECTOR_CONFIG=""
elif [[ "$DEPLOYMENT_TYPE" == "kubeadm" ]]; then
    export IMAGE_PULL_POLICY="IfNotPresent"
    export VOLUMES_CONFIG="      - name: caddy-cert-disk
        persistentVolumeClaim:
          claimName: caddy-cert-pvc
      - name: fhir-ci-build-disk
        persistentVolumeClaim:
          claimName: fhir-ci-build-pvc"

    # Check for node selector configuration
    if [[ -f ../mount/kubeadm-node-selector.yaml ]]; then
        NODE_SELECTOR=$(grep "NODE_SELECTOR:" ../mount/kubeadm-node-selector.yaml | cut -d'"' -f2)
        if [[ -n "$NODE_SELECTOR" ]]; then
            export NODE_SELECTOR_CONFIG="      nodeSelector:
        ${NODE_SELECTOR}"
        else
            export NODE_SELECTOR_CONFIG=""
        fi
    else
        export NODE_SELECTOR_CONFIG=""
    fi
else
    export IMAGE_PULL_POLICY="Always"
    export VOLUMES_CONFIG="      - name: caddy-cert-disk
        gcePersistentDisk:
          fsType: ext4
          pdName: caddy-cert-disk
      - name: fhir-ci-build-disk
        gcePersistentDisk:
          fsType: ext4
          pdName: fhir-ci-build-disk"
    export NODE_SELECTOR_CONFIG=""
fi

envsubst < ci-build.deployment.template.yaml > ../mount/ci-build.deployment.generated.yaml

echo ""
echo "Setup complete for $DEPLOYMENT_TYPE deployment!"
echo ""

if [[ "$DEPLOYMENT_TYPE" == "local" || "$DEPLOYMENT_TYPE" == "minikube" || "$DEPLOYMENT_TYPE" == "kind" || "$DEPLOYMENT_TYPE" == "k3s" ]]; then
    echo "Next steps for $DEPLOYMENT_TYPE deployment:"
    echo "1. Build Docker images:"
    echo "   ./build-images.sh --type $DEPLOYMENT_TYPE"
    echo ""
    echo "2. Deploy the application:"
    echo "   kubectl apply -f ../mount/ci-build.deployment.generated.yaml"
    echo ""
    echo "3. Test with example job:"
    echo "   kubectl apply -f example-job-for-minikube.yaml"
elif [[ "$DEPLOYMENT_TYPE" == "kubeadm" ]]; then
    echo "Next steps for kubeadm deployment:"
    echo "1. Build or pull Docker images:"
    echo "   ./build-images.sh --type kubeadm"
    echo ""
    echo "2. Deploy the application:"
    echo "   kubectl apply -f ../mount/ci-build.deployment.generated.yaml"
    echo ""
    echo "3. Test with example job:"
    echo "   kubectl apply -f example-job-for-minikube.yaml"
    echo ""
    echo "4. Monitor deployment:"
    echo "   kubectl get pods -n $NAMESPACE"
else
    echo "Next steps for GCloud deployment:"
    echo "1. Build and push Docker images:"
    echo "   ./build-images.sh --type gcloud"
    echo ""
    echo "2. Deploy the application:"
    echo "   kubectl apply -f ../mount/ci-build.deployment.generated.yaml"
    echo ""
    echo "3. Deploy Cloud Function trigger:"
    echo "   cd ../triggers/ig-commit-trigger"
    echo "   gcloud functions deploy ig-commit-trigger --runtime nodejs22 --trigger-http"
fi