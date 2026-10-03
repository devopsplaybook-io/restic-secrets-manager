# Deployments

restic-secrets-manager can be deployed with Docker images.

Examples of deployments are provided for

- [docker-compose](docker-compose)
- [kubernetes](kubernetes)

The Kubernetes section also includes a combined deployment of restic-secrets-manager together with [kubernetes-secrets-cloud-sync](https://github.com/devopsplaybook-io/kubernetes-secrets-cloud-sync), to sync the managed secrets into Kubernetes namespaces:

- [kubernetes/restic-secrets-manager-with-cloud-sync](kubernetes/restic-secrets-manager-with-cloud-sync)

## CORS

The web UI is served by the same container as the API, so no CORS
configuration is needed by default (the shipped `CORS_POLICY_ORIGIN`
default is empty, which disables CORS). Set `CORS_POLICY_ORIGIN` to an
explicit origin only when the API must be called from a different origin
(for example a separate web deployment); wildcard values are not
recommended for a secrets manager.

## Deployment notes

- **Single replica**: pull/push operations are serialized per project by an
  in-process lock, and the sync status cache is per-instance. Run a single
  replica per database (as the provided manifests do); scaling out would
  need a shared locking mechanism first.
- **Temp files**: restic works in a temporary directory on the container
  filesystem (`TMP_DIR`, default `/tmp`). It is ephemeral, which is
  acceptable for the default deployment; point `TMP_DIR` at a mounted
  volume when the temp space must be sized or shared independently.
- **Resource limits**: restic work is bounded — sync operations are
  serialized per project and the status cache caps concurrent restic
  checks — so the recommended 500m CPU / 500Mi memory limits
  accommodate typical usage.
- **Security context**: the provided manifests do not set a
  `securityContext`. On hardened clusters, run the container as non-root
  with dropped capabilities (for example `runAsNonRoot: true` and
  `capabilities: drop: ["ALL"]`).
