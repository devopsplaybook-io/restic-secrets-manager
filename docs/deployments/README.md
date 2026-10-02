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
