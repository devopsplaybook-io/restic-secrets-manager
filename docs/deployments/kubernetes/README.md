# Deploying restic-secrets-manager with Kubernetes

In the [`restic-secrets-manager`](./restic-secrets-manager) directory, you will find an example of deployment using YAML files (with Kustomize):

- [`kustomization.yaml`](./restic-secrets-manager/kustomization.yaml) — entry point; sets the namespace and the Docker image (`devopsplaybookio/restic-secrets-manager`)
- [`base/namespace.yaml`](./restic-secrets-manager/base/namespace.yaml) — dedicated namespace
- [`base/pvc.yaml`](./restic-secrets-manager/base/pvc.yaml) — persistent volume for `/data` (SQLite database)
- [`base/deployment.yaml`](./restic-secrets-manager/base/deployment.yaml) — application deployment (web UI and API served on port `8080`)
- [`base/service.yaml`](./restic-secrets-manager/base/service.yaml) — ClusterIP service
- [`base/secret.yaml`](./restic-secrets-manager/base/secret.yaml) — `JWT_KEY` secret (replace the placeholder value before deploying)

To launch the application in Kubernetes:

```bash
git clone https://github.com/devopsplaybook-io/restic-secrets-manager
cd restic-secrets-manager/docs/deployments/kubernetes/restic-secrets-manager
kubectl kustomize . | kubectl apply -f -
```

> **Warning:** Before deploying, replace the `CHANGE_ME` value of `JWT_KEY` in [`base/secret.yaml`](./restic-secrets-manager/base/secret.yaml) with a strong random key (e.g. `openssl rand -base64 48`).

On first start, the application detects that no user exists and walks you through the creation of the initial administrator account. The service is exposed as a `ClusterIP` inside the cluster; to access the web UI externally, use an Ingress or a NodePort service.

To sync the managed secrets into Kubernetes namespaces, see the combined deployment with [kubernetes-secrets-cloud-sync](./restic-secrets-manager-with-cloud-sync).
