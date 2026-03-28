#!/bin/bash

# Unified image building script for both local and GCloud deployments

set -e

# Configuration
DEPLOYMENT_TYPE="${DEPLOYMENT_TYPE:-gcloud}"
REGISTRY_PREFIX="${REGISTRY_PREFIX:-gcr.io/fhir-org-starter-project}"
PUSH_IMAGES="${PUSH_IMAGES:-true}"

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Build Docker images for FHIR IG Builder deployment.

OPTIONS:
    -t, --type TYPE         Deployment type: 'local', 'minikube', 'kind', 'k3s', 'kubeadm', or 'gcloud' (default: gcloud)
    -r, --registry PREFIX   Registry prefix (default: gcr.io/fhir-org-starter-project for gcloud, localhost:5000 for local)
    -p, --push BOOL         Push images to registry: 'true' or 'false' (default: true)
    -h, --help             Show this help message

ENVIRONMENT VARIABLES:
    DEPLOYMENT_TYPE         Same as --type
    REGISTRY_PREFIX         Same as --registry
    PUSH_IMAGES            Same as --push

EXAMPLES:
    # Build and push for GCloud (default)
    $0

    # Build and push with explicit registry
    $0 --type gcloud --registry gcr.io/fhir-org-starter-project

    # Build for local deployment (no push)
    $0 --type local --registry localhost:5000 --push false

    # Build for kubeadm deployment
    $0 --type kubeadm --registry localhost:5000 --push false

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
        -p|--push)
            PUSH_IMAGES="$2"
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

# Set push defaults based on deployment type
if [[ ("$DEPLOYMENT_TYPE" == "local" || "$DEPLOYMENT_TYPE" == "minikube" || "$DEPLOYMENT_TYPE" == "kind" || "$DEPLOYMENT_TYPE" == "k3s" || "$DEPLOYMENT_TYPE" == "kubeadm") && "$PUSH_IMAGES" == "true" ]]; then
    echo "Note: Setting PUSH_IMAGES=false for $DEPLOYMENT_TYPE deployment (no local registry assumed)"
    PUSH_IMAGES="false"
fi

# For local builds without registry, don't push and use simple tags
if [[ ("$DEPLOYMENT_TYPE" == "local" || "$DEPLOYMENT_TYPE" == "minikube" || "$DEPLOYMENT_TYPE" == "kind" || "$DEPLOYMENT_TYPE" == "k3s" || "$DEPLOYMENT_TYPE" == "kubeadm") && "$REGISTRY_PREFIX" == "localhost:5000" && "$PUSH_IMAGES" == "false" ]]; then
    REGISTRY_PREFIX=""
    TAG_SUFFIX=":latest"
else
    TAG_SUFFIX=":latest"
fi

echo "Building Docker images..."
echo "Deployment Type: $DEPLOYMENT_TYPE"
echo "Registry: $REGISTRY_PREFIX"
echo "Push Images: $PUSH_IMAGES"
echo

# Function to build and optionally push an image
build_image() {
    local image_dir="$1"
    local image_name="$2"
    local dockerfile="${3:-Dockerfile}"
    local target="${4:-}"

    echo "Building $image_name..."
    cd "../images/$image_dir"

    # Build command
    local build_cmd="docker build"
    if [[ -n "$target" ]]; then
        build_cmd="$build_cmd --target $target"
    fi

    # Set tag based on registry prefix
    local full_tag
    if [[ -n "$REGISTRY_PREFIX" ]]; then
        full_tag="$REGISTRY_PREFIX/$image_name$TAG_SUFFIX"
    else
        full_tag="$image_name$TAG_SUFFIX"
    fi

    build_cmd="$build_cmd -t $full_tag ."

    echo "Running: $build_cmd"
    eval "$build_cmd"

    # Push if required and registry is specified
    if [[ "$PUSH_IMAGES" == "true" && -n "$REGISTRY_PREFIX" ]]; then
        echo "Pushing $full_tag..."
        if [[ "$DEPLOYMENT_TYPE" == "gcloud" ]]; then
            gcloud docker -- push "$full_tag"
        else
            docker push "$full_tag"
        fi
    fi

    cd - > /dev/null
    echo
}

# Build images
echo "Starting image builds..."
echo

# Build ig-publisher (CI target)
build_image "ig-publisher" "ig-publisher" "Dockerfile" "ci"

# Build ci-build
build_image "ci-build" "ci-build"

# Build caddy-ratelimit
build_image "caddy-ratelimit" "caddy-ratelimit"

echo "All images built successfully!"

if [[ ("$DEPLOYMENT_TYPE" == "local" || "$DEPLOYMENT_TYPE" == "minikube" || "$DEPLOYMENT_TYPE" == "kind" || "$DEPLOYMENT_TYPE" == "k3s" || "$DEPLOYMENT_TYPE" == "kubeadm") && "$PUSH_IMAGES" == "false" ]]; then
    echo ""
    echo "Images are available locally with tags:"
    echo "  - ig-publisher:latest"
    echo "  - ci-build:latest"
    echo "  - caddy-ratelimit:latest"
    echo ""

    # Check if we're using kind and offer to load images
    if command -v kind >/dev/null 2>&1; then
        # Get the cluster name - default to fhir-ig-builder or detect running cluster
        CLUSTER_NAME="${KIND_CLUSTER_NAME:-fhir-ig-builder}"
        if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
            echo "Detected KIND cluster '${CLUSTER_NAME}'. Loading images..."
            kind load docker-image ig-publisher:latest --name "${CLUSTER_NAME}"
            kind load docker-image ci-build:latest --name "${CLUSTER_NAME}"
            kind load docker-image caddy-ratelimit:latest --name "${CLUSTER_NAME}"
            echo "Images loaded into KIND cluster."
            echo ""
        fi
    fi

    # Automatically regenerate deployment configuration to match built images
    echo "Updating deployment configuration to match built image tags..."
    ORIGINAL_REGISTRY_PREFIX="$REGISTRY_PREFIX"

    # Get the namespace from existing config or use fhir as default
    NAMESPACE=$(kubectl config view --minify --output 'jsonpath={..namespace}' 2>/dev/null || echo "fhir")
    if [[ -z "$NAMESPACE" ]]; then
        NAMESPACE="fhir"
    fi

    # Regenerate setup with empty registry to match local image tags
    if ./setup.sh --type "$DEPLOYMENT_TYPE" --registry "" --namespace "$NAMESPACE" >/dev/null 2>&1; then
        echo "✅ Deployment configuration updated successfully"
        echo ""
        echo "To deploy, run:"
        echo "  kubectl apply -f ../mount/ci-build.deployment.generated.yaml"
    else
        echo "⚠️  Failed to auto-update deployment configuration"
        echo ""
        echo "To deploy, manually run:"
        echo "  ./setup.sh --type $DEPLOYMENT_TYPE --registry \"\" --namespace $NAMESPACE"
        echo "  kubectl apply -f ../mount/ci-build.deployment.generated.yaml"
    fi
else
    echo ""
    echo "To deploy, run:"
    echo "  kubectl apply -f ../mount/ci-build.deployment.generated.yaml"
fi