serviceaccount=igbuild
server=https://$(gcloud container clusters --zone us-east1-d describe fhir-k8s --format='value(endpoint)')
secretname=$(kubectl get serviceaccount $serviceaccount --namespace fhir --output jsonpath={.secrets[0].name})

ca=$(kubectl get secret/$secretname -o jsonpath='{.data.ca\.crt}')
token=$(kubectl get secret/$secretname -o jsonpath='{.data.token}' | base64 --decode)
namespace=$(kubectl get secret/$secretname -o jsonpath='{.data.namespace}' | base64 --decode)

echo "
apiVersion: v1
kind: Config
clusters:
- name: default-cluster
  cluster:
    certificate-authority-data: ${ca}
    server: ${server}
contexts:
- name: default-context
  context:
    cluster: default-cluster
    namespace: ${namespace}
    user: default-user
current-context: default-context
users:
- name: default-user
  user:
    token: ${token}
" > sa.kubeconfig
