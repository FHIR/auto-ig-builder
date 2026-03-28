#!/bin/bash

# KIND cluster creation and initialization script for FHIR IG Builder
# This script creates a KIND cluster and prepares it for the unified setup process

set -e

CLUSTER_NAME="${KIND_CLUSTER_NAME:-fhir-ig-builder}"
NAMESPACE="${NAMESPACE:-fhir}"

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Create and initialize KIND cluster for FHIR IG Builder development.
After this script, use the unified setup process like minikube.

OPTIONS:
    -c, --cluster NAME      KIND cluster name (default: fhir-ig-builder)
    -n, --namespace NS      Kubernetes namespace (default: fhir)
    -h, --help             Show this help message

ENVIRONMENT VARIABLES:
    KIND_CLUSTER_NAME      Same as --cluster
    NAMESPACE             Same as --namespace

EXAMPLES:
    # Default cluster creation
    $0

    # Custom cluster name
    $0 --cluster my-fhir-cluster

    # Complete setup workflow:
    $0                                    # Create cluster
    ./setup.sh --type local              # Run unified setup
    ./build-images.sh --type local --push false  # Build images
    kubectl apply -f ci-build.deployment.generated.yaml  # Deploy

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -c|--cluster)
            CLUSTER_NAME="$2"
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

echo "Setting up FHIR IG Builder with KIND..."
echo "Cluster Name: $CLUSTER_NAME"
echo "Namespace: $NAMESPACE"
echo

# Check if kind is installed
if ! command -v kind >/dev/null 2>&1; then
    echo "Error: kind is not installed."
    echo "Install kind: https://kind.sigs.k8s.io/docs/user/quick-start/#installation"
    exit 1
fi

# Check if kubectl is installed
if ! command -v kubectl >/dev/null 2>&1; then
    echo "Error: kubectl is not installed."
    echo "Install kubectl: https://kubernetes.io/docs/tasks/tools/"
    exit 1
fi

# Create host directory for data persistence
echo "Creating host directories for persistent volumes..."
sudo mkdir -p /tmp/fhir-data
sudo chmod 777 /tmp/fhir-data

# Check if cluster already exists
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
    echo "KIND cluster '${CLUSTER_NAME}' already exists."
    read -p "Do you want to delete and recreate it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Deleting existing cluster..."
        kind delete cluster --name "${CLUSTER_NAME}"
    else
        echo "Using existing cluster. Make sure it has the correct configuration."
    fi
fi

# Create KIND cluster if it doesn't exist
if ! kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
    echo "Creating KIND cluster '${CLUSTER_NAME}'..."
    KIND_CLUSTER_NAME="${CLUSTER_NAME}" kind create cluster --config=kind-config.yaml
fi

# Set kubectl context
echo "Setting kubectl context..."
kubectl config use-context "kind-${CLUSTER_NAME}"

# Verify cluster is ready
echo "Waiting for cluster to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=300s

echo ""
echo "✅ KIND cluster '${CLUSTER_NAME}' created successfully!"
echo ""
echo "The cluster is now ready for the unified setup process."
echo ""
echo "Next steps (follow the same process as minikube):"
echo "1. Run unified setup:"
echo "   ./setup.sh --type local --namespace ${NAMESPACE}"
echo ""
echo "2. Build Docker images:"
echo "   ./build-images.sh --type local --push false"
echo ""
echo "3. Deploy the application:"
echo "   kubectl apply -f ci-build.deployment.generated.yaml"
echo ""
echo "4. Test with example job:"
echo "   kubectl apply -f example-job-for-minikube.yaml"
echo ""
echo "5. Access services (if needed):"
echo "   kubectl port-forward -n ${NAMESPACE} svc/ci-build-service 8080:80"
echo ""
echo "6. Clean up when done:"
echo "   kind delete cluster --name ${CLUSTER_NAME}"
echo ""