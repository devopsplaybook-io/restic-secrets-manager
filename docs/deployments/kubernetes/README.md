# Kubernetes deployment

Example manifests for deploying restic-secrets-manager.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: restic-secrets-manager
  labels:
    app: restic-secrets-manager
spec:
  replicas: 1
  selector:
    matchLabels:
      app: restic-secrets-manager
  template:
    metadata:
      labels:
        app: restic-secrets-manager
    spec:
      containers:
        - name: restic-secrets-manager
          image: didierhoarau/restic-secrets-manager:latest
          ports:
            - containerPort: 8080
          env:
            - name: JWT_KEY
              valueFrom:
                secretKeyRef:
                  name: restic-secrets-manager
                  key: JWT_KEY
          volumeMounts:
            - name: data
              mountPath: /data
          livenessProbe:
            httpGet:
              path: /api/status
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /api/status
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: restic-secrets-manager
```

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: restic-secrets-manager
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
```

```yaml
apiVersion: v1
kind: Service
metadata:
  name: restic-secrets-manager
spec:
  selector:
    app: restic-secrets-manager
  ports:
    - port: 80
      targetPort: 8080
```
