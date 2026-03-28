#!/bin/bash

# k3s cluster setup and initialization script for FHIR IG Builder
# This script starts k3s and prepares it for the unified setup process

set -e

NAMESPACE="${NAMESPACE:-fhir}"
DATA_DIR="${DATA_DIR:-/var/lib/rancher/k3s/storage}"

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Start and prepare k3s cluster for FHIR IG Builder development.
After this script, use the unified setup process like minikube, KIND, and kubeadm.

OPTIONS:
    -n, --namespace NS      Kubernetes namespace (default: fhir)
    -d, --data-dir DIR      Data directory for local storage (default: /var/lib/rancher/k3s/storage)
    -h, --help             Show this help message

ENVIRONMENT VARIABLES:
    NAMESPACE              Same as --namespace
    DATA_DIR              Same as --data-dir

EXAMPLES:
    # Default k3s setup
    $0

    # Custom data directory
    $0 --data-dir /opt/k3s-data

    # Complete setup workflow:
    $0                                    # Start k3s
    ./setup.sh --type k3s               # Run unified setup
    ./build-images.sh --type k3s        # Build images
    kubectl apply -f ci-build.deployment.generated.yaml  # Deploy

PREREQUISITES:
    - k3s installed (https://k3s.io/)
    - sudo access (k3s typically runs as root)
    - kubectl configured to use k3s
    - Sufficient disk space for container images and data

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -d|--data-dir)
            DATA_DIR="$2"
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

echo "Setting up FHIR IG Builder with k3s..."
echo "Namespace: $NAMESPACE"
echo "Data Directory: $DATA_DIR"
echo

# Check if k3s is installed
if ! command -v k3s >/dev/null 2>&1; then
    echo "Error: k3s is not installed."
    echo "Install k3s: curl -sfL https://get.k3s.io | sh -"
    exit 1
fi

# Check if kubectl is available (k3s provides it)
if ! command -v kubectl >/dev/null 2>&1; then
    echo "Setting up kubectl access to k3s..."
    # k3s installs kubectl as k3s kubectl, so we need to ensure access
    if command -v k3s >/dev/null 2>&1; then
        echo "You can use: k3s kubectl [command]"
        echo "Or configure kubectl to use k3s config:"
        echo "export KUBECONFIG=/etc/rancher/k3s/k3s.yaml"
    else
        echo "Error: kubectl access not available."
        exit 1
    fi
fi

# Check if k3s is running
if sudo systemctl is-active --quiet k3s; then
    echo "k3s is already running."
    read -p "Do you want to restart it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Restarting k3s..."
        sudo systemctl restart k3s
    else
        echo "Using existing k3s cluster."
    fi
else
    echo "Starting k3s..."
    sudo systemctl start k3s
    sudo systemctl enable k3s
fi

# Create data directory if it doesn't exist
if [[ ! -d "$DATA_DIR" ]]; then
    echo "Creating data directory: $DATA_DIR"
    sudo mkdir -p "$DATA_DIR"
    sudo chmod 755 "$DATA_DIR"
fi

# Wait a moment for k3s to fully start
echo "Waiting for k3s to be ready..."
sleep 10

# Set up kubectl access if not already configured
if [[ -z "${KUBECONFIG}" && -f "/etc/rancher/k3s/k3s.yaml" ]]; then
    echo "Configuring kubectl access..."
    export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
    echo "export KUBECONFIG=/etc/rancher/k3s/k3s.yaml" >> ~/.bashrc
fi

# Verify cluster is ready (using k3s kubectl if regular kubectl fails)
echo "Verifying cluster access..."
if kubectl cluster-info >/dev/null 2>&1; then
    kubectl wait --for=condition=Ready nodes --all --timeout=300s
elif k3s kubectl cluster-info >/dev/null 2>&1; then
    k3s kubectl wait --for=condition=Ready nodes --all --timeout=300s
    echo "Note: Use 'k3s kubectl' for kubectl commands, or set KUBECONFIG=/etc/rancher/k3s/k3s.yaml"
else
    echo "Warning: Could not verify cluster readiness. You may need to configure kubectl access."
fi

echo ""
echo "✅ k3s cluster started successfully!"
echo ""
echo "The cluster is now ready for the unified setup process."
echo ""
echo "Configuration summary:"
echo "  - Namespace: $NAMESPACE"
echo "  - Data Directory: $DATA_DIR"
echo "  - Kubectl config: ${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
echo ""
echo "Next steps (follow the same process as minikube, KIND, and kubeadm):"
echo "1. Run unified setup:"
echo "   ./setup.sh --type k3s --namespace $NAMESPACE"
echo ""
echo "2. Build Docker images:"
echo "   ./build-images.sh --type k3s"
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
echo "   sudo systemctl stop k3s"
echo ""