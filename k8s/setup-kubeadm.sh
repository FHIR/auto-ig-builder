#!/bin/bash

# kubeadm cluster preparation script for FHIR IG Builder
# This script prepares an existing kubeadm cluster for the unified setup process

set -e

NAMESPACE="${NAMESPACE:-fhir}"
STORAGE_CLASS="${STORAGE_CLASS:-}"
NODE_SELECTOR="${NODE_SELECTOR:-}"
DATA_DIR="${DATA_DIR:-/opt/fhir-data}"

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Prepare existing kubeadm cluster for FHIR IG Builder deployment.
After this script, use the unified setup process like minikube and KIND.

OPTIONS:
    -n, --namespace NS       Kubernetes namespace (default: fhir)
    -s, --storage-class SC   Storage class for PVCs (default: auto-detect)
    -d, --data-dir DIR       Host data directory (default: /opt/fhir-data)
    -l, --node-selector SEL  Node selector for workloads (optional)
    -h, --help              Show this help message

ENVIRONMENT VARIABLES:
    NAMESPACE               Same as --namespace
    STORAGE_CLASS           Same as --storage-class
    DATA_DIR               Same as --data-dir
    NODE_SELECTOR          Same as --node-selector

EXAMPLES:
    # Basic cluster preparation
    $0

    # Preparation with specific storage class
    $0 --storage-class local-path

    # Complete setup workflow:
    $0                                    # Prepare cluster
    ./setup.sh --type kubeadm --namespace ${NAMESPACE}  # Run unified setup
    ./build-images.sh --type kubeadm     # Build/pull images
    kubectl apply -f ci-build.deployment.generated.yaml  # Deploy

PREREQUISITES:
    - Functioning kubeadm cluster with kubectl access
    - Sufficient resources (20GB+ memory, 100GB+ storage)
    - Container runtime (Docker, containerd, or CRI-O)
    - Optional: Local container registry or pull access to gcr.io

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -s|--storage-class)
            STORAGE_CLASS="$2"
            shift 2
            ;;
        -d|--data-dir)
            DATA_DIR="$2"
            shift 2
            ;;
        -l|--node-selector)
            NODE_SELECTOR="$2"
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

echo "Setting up FHIR IG Builder on kubeadm cluster..."
echo "Namespace: $NAMESPACE"
echo "Data Directory: $DATA_DIR"
if [[ -n "$STORAGE_CLASS" ]]; then
    echo "Storage Class: $STORAGE_CLASS"
else
    echo "Storage Class: Auto-detect"
fi
if [[ -n "$NODE_SELECTOR" ]]; then
    echo "Node Selector: $NODE_SELECTOR"
fi
echo

# Check if kubectl is installed and cluster is accessible
if ! command -v kubectl >/dev/null 2>&1; then
    echo "Error: kubectl is not installed."
    echo "Install kubectl: https://kubernetes.io/docs/tasks/tools/"
    exit 1
fi

# Test cluster access
echo "Testing cluster access..."
if ! kubectl cluster-info >/dev/null 2>&1; then
    echo "Error: Cannot access Kubernetes cluster."
    echo "Ensure kubectl is configured and cluster is running."
    exit 1
fi

# Check cluster resources
echo "Checking cluster resources..."
NODES=$(kubectl get nodes --no-headers | wc -l)
READY_NODES=$(kubectl get nodes --no-headers | grep -c Ready || true)
echo "Cluster has $NODES nodes ($READY_NODES ready)"

if [[ $READY_NODES -eq 0 ]]; then
    echo "Error: No ready nodes found in cluster."
    exit 1
fi

# Detect storage class if not specified
if [[ -z "$STORAGE_CLASS" ]]; then
    echo "Auto-detecting storage class..."

    # Try to find a default storage class
    STORAGE_CLASS=$(kubectl get storageclass -o jsonpath='{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}' 2>/dev/null || true)

    if [[ -z "$STORAGE_CLASS" ]]; then
        # Fall back to first available storage class
        STORAGE_CLASS=$(kubectl get storageclass -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
    fi

    if [[ -z "$STORAGE_CLASS" ]]; then
        echo "Warning: No storage class found. You may need to install a storage provisioner."
        echo "Common options:"
        echo "  - local-path-provisioner: kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/master/deploy/local-path-storage.yaml"
        echo "  - OpenEBS: kubectl apply -f https://openebs.github.io/charts/openebs-operator.yaml"
        echo "  - Longhorn: kubectl apply -f https://raw.githubusercontent.com/longhorn/longhorn/master/deploy/longhorn.yaml"
        read -p "Continue without storage class? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        echo "Using storage class: $STORAGE_CLASS"
    fi
fi

# Create data directories on all nodes (if using local storage)
if [[ "$STORAGE_CLASS" == *"local"* ]] || [[ -z "$STORAGE_CLASS" ]]; then
    echo "Creating data directories on cluster nodes..."

    # Get list of node names
    NODES_LIST=$(kubectl get nodes -o jsonpath='{.items[*].metadata.name}')

    for node in $NODES_LIST; do
        echo "Setting up data directory on node: $node"

        # Try to create directory via kubectl exec (for nodes that allow it)
        if kubectl get pods -A --field-selector spec.nodeName="$node" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null | grep -q .; then
            # Use a pod on the node to create directories
            kubectl run fhir-setup-$RANDOM --rm -i --restart=Never \
                --overrides='{"spec":{"nodeName":"'$node'","hostPID":true,"hostNetwork":true,"containers":[{"name":"setup","image":"alpine","command":["nsenter","--target","1","--mount","--","sh","-c","mkdir -p '$DATA_DIR' && chmod 755 '$DATA_DIR' && echo \"Directory created on '$node'\""],"securityContext":{"privileged":true}}]}}' \
                --image=alpine -- echo "Setup complete" 2>/dev/null || true
        else
            echo "Warning: Could not automatically create $DATA_DIR on node $node"
            echo "You may need to manually run: sudo mkdir -p $DATA_DIR && sudo chmod 755 $DATA_DIR"
        fi
    done
fi

# Create kubeadm-specific persistent volumes configuration
echo "Creating kubeadm persistent volumes configuration..."
cat > ../mount/kubeadm-persistent-volumes.yaml << EOF
# kubeadm-specific persistent volume configuration
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: fhir-ci-build-pvc
  namespace: ${NAMESPACE}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
$(if [[ -n "$STORAGE_CLASS" ]]; then echo "  storageClassName: $STORAGE_CLASS"; fi)
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: caddy-cert-pvc
  namespace: ${NAMESPACE}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
$(if [[ -n "$STORAGE_CLASS" ]]; then echo "  storageClassName: $STORAGE_CLASS"; fi)
EOF

# Create node selector configuration if specified
if [[ -n "$NODE_SELECTOR" ]]; then
    echo "Creating node selector configuration..."
    cat > ../mount/kubeadm-node-selector.yaml << EOF
# Node selector configuration for kubeadm deployment
NODE_SELECTOR: "$NODE_SELECTOR"
EOF
fi

echo ""
echo "✅ kubeadm cluster '$(kubectl config current-context)' prepared successfully!"
echo ""
echo "The cluster is now ready for the unified setup process."
echo ""
echo "Configuration summary:"
echo "  - Namespace: $NAMESPACE"
echo "  - Data Directory: $DATA_DIR"
if [[ -n "$STORAGE_CLASS" ]]; then
    echo "  - Storage Class: $STORAGE_CLASS"
fi
if [[ -n "$NODE_SELECTOR" ]]; then
    echo "  - Node Selector: $NODE_SELECTOR"
fi
echo ""
echo "Generated files:"
echo "  - ../mount/kubeadm-persistent-volumes.yaml"
if [[ -n "$NODE_SELECTOR" ]]; then
    echo "  - ../mount/kubeadm-node-selector.yaml"
fi
echo ""
echo "Next steps (follow the same process as minikube and KIND):"
echo "1. Run unified setup:"
echo "   ./setup.sh --type kubeadm --namespace $NAMESPACE"
echo ""
echo "2. Build Docker images:"
echo "   ./build-images.sh --type kubeadm"
echo ""
echo "3. Deploy the application:"
echo "   kubectl apply -f ../mount/ci-build.deployment.generated.yaml  # Deploy"
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
echo "   kubectl delete namespace $NAMESPACE"
echo ""