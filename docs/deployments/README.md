# Deployments

restic-secrets-manager can be deployed with Docker images.

Examples of deployments are provided for

- [docker-compose](docker-compose)
- [kubernetes](kubernetes)

The Kubernetes section also includes a combined deployment of restic-secrets-manager together with [kubernetes-secrets-cloud-sync](https://github.com/devopsplaybook-io/kubernetes-secrets-cloud-sync), to sync the managed secrets into Kubernetes namespaces:

- [kubernetes/restic-secrets-manager-with-cloud-sync](kubernetes/restic-secrets-manager-with-cloud-sync)
