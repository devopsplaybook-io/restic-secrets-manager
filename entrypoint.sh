#!/bin/sh

# exec: node becomes PID 1 so SIGTERM from docker stop / Kubernetes reaches
# the graceful shutdown handler instead of being consumed by the shell.
exec node dist/App.js
