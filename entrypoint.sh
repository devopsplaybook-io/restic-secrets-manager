#!/bin/sh

if [ "${APPLICATION_TITLE}" == "" ]; then
  APPLICATION_TITLE="Restic Secrets Manager"
fi

for file in $(grep -rl "APPLICATION_TITLE" /opt/app/restic-secrets-manager/web); do
  sed -i "s|APPLICATION_TITLE|$APPLICATION_TITLE|g" "$file"
done

node dist/App.js
