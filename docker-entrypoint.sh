#!/bin/sh
set -eu

storage_root="${STORAGE_ROOT:-/app/storage}"
mkdir -p "$storage_root/uploads" "$storage_root/exports" "$storage_root/projects" "$storage_root/campaigns"
chown -R node:node "$storage_root"

exec gosu node "$@"
