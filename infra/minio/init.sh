#!/bin/sh
set -eu

mc alias set local http://object-storage:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing local/qarau-private
mc anonymous set none local/qarau-private

mc admin user add local "$QARAU_API_S3_ACCESS_KEY" "$QARAU_API_S3_SECRET_KEY" 2>/dev/null || true
mc admin user add local "$QARAU_WORKER_S3_ACCESS_KEY" "$QARAU_WORKER_S3_SECRET_KEY" 2>/dev/null || true
mc admin user add local "$QARAU_CHAIN_S3_ACCESS_KEY" "$QARAU_CHAIN_S3_SECRET_KEY" 2>/dev/null || true

mc admin policy create local qarau-api-artifacts /api-policy.json 2>/dev/null || true
mc admin policy attach local qarau-api-artifacts --user "$QARAU_API_S3_ACCESS_KEY"
mc admin policy attach local readwrite --user "$QARAU_WORKER_S3_ACCESS_KEY"
mc admin policy attach local readonly --user "$QARAU_CHAIN_S3_ACCESS_KEY"
