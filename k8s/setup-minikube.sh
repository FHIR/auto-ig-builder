#!/bin/bash

# minikube cluster setup and initialization script for FHIR IG Builder
# This script starts minikube and prepares it for the unified setup process

set -e

MEMORY="${MEMORY:-20000}"
NAMESPACE="${NAMESPACE:-fhir}"

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Start and prepare minikube cluster for FHIR IG Builder development.
After this script, use the unified setup process like KIND and kubeadm.

OPTIONS:
    -m, --memory MB         Memory allocation for minikube (default: 20000)
    -n, --namespace NS      Kubernetes namespace (default: fhir)
    -h, --help             Show this help message

ENVIRONMENT VARIABLES:
    MEMORY                 Same as --memory
    NAMESPACE              Same as --namespace

EXAMPLES:
    # Default minikube setup
    $0

    # Custom memory allocation
    $0 --memory 16000

    # Complete setup workflow:
    $0                                    # Start minikube
    ./setup.sh --type minikube           # Run unified setup
    ./build-images.sh --type minikube    # Build images
    kubectl apply -f ci-build.deployment.generated.yaml  # Deploy

PREREQUISITES:
    - minikube installed
    - Docker or another container runtime
    - kubectl installed
    - Sufficient system resources (20GB+ memory recommended)

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--memory)
            MEMORY="$2"
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

echo "Setting up FHIR IG Builder with minikube..."
echo "Memory: ${MEMORY}MB"
echo "Namespace: $NAMESPACE"
echo

# Check if minikube is installed
if ! command -v minikube >/dev/null 2>&1; then
    echo "Error: minikube is not installed."
    echo "Install minikube: https://minikube.sigs.k8s.io/docs/start/"
    exit 1
fi

# Check if kubectl is installed
if ! command -v kubectl >/dev/null 2>&1; then
    echo "Error: kubectl is not installed."
    echo "Install kubectl: https://kubernetes.io/docs/tasks/tools/"
    exit 1
fi

# Check if minikube is already running
if minikube status >/dev/null 2>&1; then
    echo "minikube is already running."
    read -p "Do you want to restart it with new configuration? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Stopping minikube..."
        minikube stop
        echo "Starting minikube with memory=${MEMORY}MB..."
        minikube start --memory="$MEMORY"
    else
        echo "Using existing minikube cluster."
    fi
else
    echo "Starting minikube with memory=${MEMORY}MB..."
    minikube start --memory="$MEMORY"
fi

# Set Docker environment to use minikube's Docker daemon
echo "Setting Docker environment..."
eval $(minikube docker-env)

# Verify cluster is ready
echo "Waiting for cluster to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=300s

echo ""
echo "✅ minikube cluster started successfully!"
echo ""
echo "The cluster is now ready for the unified setup process."
echo ""
echo "Next steps (follow the same process as KIND and kubeadm):"
echo "1. Run unified setup:"
echo "   ./setup.sh --type minikube --namespace $NAMESPACE"
echo ""
echo "2. Build Docker images:"
echo "   ./build-images.sh --type minikube"
echo ""
echo "3. Deploy the application:"
echo "   kubectl apply -f ci-build.deployment.generated.yaml"
echo ""
echo "4. Test with example job:"
echo "   kubectl apply -f example-job-for-minikube.yaml"
echo ""
echo "5. Monitor deployment:"
echo "   kubectl get pods -n $NAMESPACE"
echo ""
echo "6. Access services (if needed):"
echo "   kubectl port-forward -n $NAMESPACE svc/ci-build-service 8080:80"
echo ""
echo "Cleanup when done:"
echo "   minikube stop"
echo ""
echo "Note: This script has set your Docker environment to use minikube's daemon."
echo "To revert: eval \$(minikube docker-env -u)"
echo ""