# Deploying restic-secrets-manager together with kubernetes-secrets-cloud-sync

[restic-secrets-manager](https://github.com/devopsplaybook-io/restic-secrets-manager) and [kubernetes-secrets-cloud-sync](https://github.com/devopsplaybook-io/kubernetes-secrets-cloud-sync) are two complementary tools:

- **restic-secrets-manager** is a web UI to author and manage application secrets as flat key/value pairs. Secrets are stored per project in [restic](https://restic.net) repositories on an S3-compatible backend: pushing a project writes each secret as a JSON file under the `secrets/` folder of the repository and creates a new snapshot.
- **kubernetes-secrets-cloud-sync** is a Kubernetes controller that restores the **latest snapshot** of a restic repository, reads the JSON files in it, and materializes each file as a namespaced Kubernetes Secret (named `cloudsync-<secret-name>` by default) in every namespace annotated for it.

Deployed together, secrets are authored in the web UI, pushed to the restic repository, and automatically synced into Kubernetes namespaces — no secrets are stored in Git or typed by hand into `kubectl`.

In the [`restic-secrets-manager-with-cloud-sync`](.) directory you will find a combined Kustomize deployment with:

- [`kustomization.yaml`](./kustomization.yaml) — includes the base [restic-secrets-manager](../restic-secrets-manager) deployment and the cloud-sync resources below
- [`cloud-sync-rbac.yaml`](./cloud-sync-rbac.yaml) — ServiceAccount, ClusterRole and ClusterRoleBinding required by kubernetes-secrets-cloud-sync
- [`cloud-sync-secret.yaml`](./cloud-sync-secret.yaml) — restic repository settings and S3 credentials for the sync (placeholder values)
- [`cloud-sync-cronjob.yaml`](./cloud-sync-cronjob.yaml) — CronJob running one sync every 6 hours

## Prerequisites

The two tools must point at the **same restic repository**. One restic-secrets-manager project corresponds to one repository (`s3:https://<endpoint>/<bucket>/<prefix>`), and one kubernetes-secrets-cloud-sync instance syncs exactly one repository.

Map the settings of the restic-secrets-manager project to the cloud-sync environment variables:

| restic-secrets-manager project setting | cloud-sync environment variable            | Example (generic)                            |
| -------------------------------------- | ------------------------------------------ | -------------------------------------------- |
| S3 endpoint + bucket + prefix          | `RESTIC_REPOSITORY`                        | `s3:https://s3.example.com/my-bucket/my-project` |
| Repository password                    | `RESTIC_PASSWORD`                          | `CHANGE_ME`                                  |
| S3 access key                          | `AWS_ACCESS_KEY_ID`                        | `CHANGE_ME`                                  |
| S3 secret key                          | `AWS_SECRET_ACCESS_KEY`                    | `CHANGE_ME`                                  |
| (push layout — always `secrets`)       | `RESTIC_PATH` (must be `secrets`)          | `secrets`                                    |

> **Important:** restic-secrets-manager pushes secrets as `secrets/<secret-name>.json` inside the snapshot, while kubernetes-secrets-cloud-sync reads `<secret-name>.json` from the snapshot root or from the folder set by `RESTIC_PATH`. **`RESTIC_PATH` must be set to `secrets`** for the two tools to work together — the provided [`cloud-sync-secret.yaml`](./cloud-sync-secret.yaml) already sets it.

If your S3 backend needs non-default options (e.g. bucket lookup style or region), pass them to cloud-sync via `RESTIC_OPTIONS` (restic CLI `-o` flags); the same options can be configured on the restic-secrets-manager project.

## Deploy

```bash
git clone https://github.com/devopsplaybook-io/restic-secrets-manager
cd restic-secrets-manager/docs/deployments/kubernetes/restic-secrets-manager-with-cloud-sync
kubectl kustomize . | kubectl apply -f -
```

> **Warning:** Before deploying, replace the placeholder values in [`base/secret.yaml`](../restic-secrets-manager/base/secret.yaml) (the `JWT_KEY` of restic-secrets-manager) and in [`cloud-sync-secret.yaml`](./cloud-sync-secret.yaml) (repository URL, password and S3 credentials).

## Usage

1. Open the restic-secrets-manager web UI, sign in as the initial administrator (created on first start), and create a project with the restic repository settings you mapped above.
2. Create secrets in the project and **push** them: each secret becomes a `secrets/<secret-name>.json` file in a new repository snapshot.
3. Annotate the namespaces that should receive the secrets:

   ```yaml
   apiVersion: v1
   kind: Namespace
   metadata:
     name: my-app
     annotations:
       secrets.cloudsync.devopsplaybook.io/restic: "my-app-config"
   ```

4. At the next sync (or immediately via `POST /api/sync` on the cloud-sync API when running as a long-lived Deployment), a Kubernetes Secret named `cloudsync-my-app-config` is created in the `my-app` namespace, with each JSON key as a separate Secret entry.

## Conflict safety

The two tools never contend on the repository:

- restic-secrets-manager rejects a push (HTTP 409) when the repository holds a snapshot newer than the last synchronized one — pull first, then push.
- kubernetes-secrets-cloud-sync is read-only toward the repository: it only restores the latest snapshot.

## Scaling out

One kubernetes-secrets-cloud-sync instance syncs exactly **one** restic repository. To sync secrets from several restic-secrets-manager projects, deploy one cloud-sync CronJob (or Deployment) per project repository, each with its own `RESTIC_REPOSITORY` settings. The annotation prefix can stay the same across instances; each instance materializes the secrets of its own repository.
