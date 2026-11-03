# Deploying restic-secrets-manager with Kubernetes

In the [`restic-secrets-manager`](./restic-secrets-manager) directory, you will find an example of deployment using YAML files (with Kustomize):

- [`kustomization.yaml`](./restic-secrets-manager/kustomization.yaml) — entry point; sets the namespace and the Docker image (`devopsplaybookio/restic-secrets-manager`)
- [`base/namespace.yaml`](./restic-secrets-manager/base/namespace.yaml) — dedicated namespace
- [`base/pvc.yaml`](./restic-secrets-manager/base/pvc.yaml) — persistent volume for `/data` (SQLite database)
- [`base/deployment.yaml`](./restic-secrets-manager/base/deployment.yaml) — application deployment (web UI and API served on port `8080`)
- [`base/service.yaml`](./restic-secrets-manager/base/service.yaml) — ClusterIP service
- [`base/secret.yaml`](./restic-secrets-manager/base/secret.yaml) — optional `JWT_KEY` secret (empty by default; leave empty to let the application generate and store the key in the database)
- [`overlays/ingress`](./restic-secrets-manager/overlays/ingress) — opt-in overlay that adds an example Ingress and sets `TRUST_PROXY=true` (see below)

To launch the application in Kubernetes:

```bash
git clone https://github.com/devopsplaybook-io/restic-secrets-manager
cd restic-secrets-manager/docs/deployments/kubernetes/restic-secrets-manager
kubectl kustomize . | kubectl apply -f -
```

> **Note:** `JWT_KEY` is empty in [`base/secret.yaml`](./restic-secrets-manager/base/secret.yaml), so the signing key is generated once and kept in the database. Set a strong random key (e.g. `openssl rand -base64 48`) to manage it yourself; changing it invalidates all issued sessions.

On first start, the application detects that no user exists and walks you through the creation of the initial administrator account. The service is exposed as a `ClusterIP` inside the cluster; to access the web UI externally, use an Ingress (see below) or a NodePort service.

To sync the managed secrets into Kubernetes namespaces, see the combined deployment with [kubernetes-secrets-cloud-sync](./restic-secrets-manager-with-cloud-sync).

## Hardening

The base deployment runs the container as non-root (uid/gid `10001`) with a
read-only root filesystem, all capabilities dropped, `allowPrivilegeEscalation:
false` and `seccompProfile: RuntimeDefault`. `TMP_DIR` and the disposable
restic cache (`RESTIC_CACHE_DIR`) live on a memory-backed `emptyDir` mounted
at `/tmp`, so plaintext secret working directories never reach the node's
writable layer. The `256Mi` `sizeLimit` counts against the container memory
limit (`500Mi`): raise both when a repository cache needs more room.

The `/data` PVC is made writable by uid/gid `10001` through
`fsGroup: 10001` (`fsGroupChangePolicy: OnRootMismatch`). Storage classes or
static volumes that do not support `fsGroup` (hostPath, some NFS/CSI setups)
must be pre-owned before the first start:

```bash
sudo chown -R 10001:10001 <volume-mount-path>
```

## Exposing the service through an Ingress

The base service keeps `TRUST_PROXY=false`, because a `ClusterIP` is not
itself behind a trusted proxy. To expose the application through an ingress
controller, apply the opt-in overlay instead of the base kustomization:

```bash
git clone https://github.com/devopsplaybook-io/restic-secrets-manager
cd restic-secrets-manager/docs/deployments/kubernetes/restic-secrets-manager/overlays/ingress
# Set your host in ingress.yaml, then:
kubectl kustomize . | kubectl apply -f -
```

The overlay adds an example Ingress and sets `TRUST_PROXY=true` so rate
limiting and audit logs see the real client IP.

> **Important:** apply this overlay only when the ingress controller is the
> only path to the application **and** it overwrites client-supplied
> `X-Forwarded-For` (for example NGINX configured with `use-forwarded-headers`
> and trusted proxy CIDRs). Never enable `TRUST_PROXY` on a NodePort or a
> directly exposed service: clients could then spoof their IP address and
> bypass the login rate limiting.
