#!/usr/bin/env bash
set -euo pipefail

project_name="openround-minio-volume-smoke"
volume_name="${project_name}_minio-data"
root_container="${project_name}-root"
nonroot_container="${project_name}-nonroot"
minio_image="cgr.dev/chainguard/minio@sha256:bd014394a80898e68c149f2311fdf8d5a2c2f3bb2c33b9327ae6d02b4b065ae1"
owner_image="cgr.dev/chainguard/wolfi-base@sha256:fac38d12efdb4bf43ac9e599a31db10a27ad5dd71e5f1618790962eda8d66180"

cleanup() {
  docker rm -f "$root_container" "$nonroot_container" >/dev/null 2>&1 || true
  docker compose -p "$project_name" -f compose.yaml down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker volume rm "$volume_name" >/dev/null 2>&1 || true
}

if docker volume inspect "$volume_name" >/dev/null 2>&1; then
  echo "Refusing to reuse existing smoke volume: $volume_name" >&2
  exit 1
fi
if [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$project_name")" ]; then
  echo "Refusing to reuse existing smoke project: $project_name" >&2
  exit 1
fi
for container_name in "$root_container" "$nonroot_container"; do
  if docker container inspect "$container_name" >/dev/null 2>&1; then
    echo "Refusing to reuse existing smoke container: $container_name" >&2
    exit 1
  fi
done
trap cleanup EXIT

wait_for_minio() {
  local container_name="$1"
  for _attempt in $(seq 1 80); do
    if docker exec "$container_name" mc alias set smoke http://127.0.0.1:9000 testroot testsecret123 >/dev/null 2>&1 &&
      docker exec "$container_name" mc ready smoke >/dev/null 2>&1; then
      return 0
    fi
    if [ "$(docker inspect "$container_name" --format '{{.State.Running}}')" != "true" ]; then
      docker logs "$container_name" >&2
      return 1
    fi
    sleep 0.25
  done
  docker logs "$container_name" >&2
  echo "MinIO did not become ready: $container_name" >&2
  return 1
}

start_minio() {
  local container_name="$1"
  local runtime_user="$2"
  docker run -d \
    --name "$container_name" \
    --user "$runtime_user" \
    --env MINIO_ROOT_USER=testroot \
    --env MINIO_ROOT_PASSWORD=testsecret123 \
    --volume "$volume_name:/data" \
    "$minio_image" server /data >/dev/null
  wait_for_minio "$container_name"
}

put_object() {
  local container_name="$1"
  local object_name="$2"
  docker exec "$container_name" /bin/sh -ec \
    "printf '%s' '$object_name' >/tmp/object && mc cp /tmp/object smoke/upgrade-check/$object_name >/dev/null"
}

assert_object() {
  local container_name="$1"
  local object_name="$2"
  docker exec "$container_name" mc stat "smoke/upgrade-check/$object_name" >/dev/null
}

# Let Compose create the isolated volume, then simulate the prior root-running image.
docker compose -p "$project_name" -f compose.yaml run --rm --no-deps minio-volume-owner >/dev/null
start_minio "$root_container" "0:0"
docker exec "$root_container" mc mb --ignore-existing smoke/upgrade-check >/dev/null
put_object "$root_container" "before-upgrade"
docker rm -f "$root_container" >/dev/null

# Upgrade to the non-root image and prove the existing object remains readable and writable.
docker compose -p "$project_name" -f compose.yaml run --rm --no-deps minio-volume-owner >/dev/null
start_minio "$nonroot_container" "65532:65532"
assert_object "$nonroot_container" "before-upgrade"
put_object "$nonroot_container" "after-upgrade"
docker rm -f "$nonroot_container" >/dev/null

# Simulate a rollback that writes root-owned data, then upgrade again.
start_minio "$root_container" "0:0"
assert_object "$root_container" "before-upgrade"
assert_object "$root_container" "after-upgrade"
put_object "$root_container" "after-rollback"
docker rm -f "$root_container" >/dev/null
docker run --rm --user 0:0 --entrypoint /bin/sh --volume "$volume_name:/data" "$owner_image" \
  -ec 'test -n "$(find /data -xdev ! -user 65532 -print -quit)"'

docker compose -p "$project_name" -f compose.yaml run --rm --no-deps minio-volume-owner >/dev/null
docker run --rm --user 0:0 --entrypoint /bin/sh --volume "$volume_name:/data" "$owner_image" \
  -ec 'test -z "$(find /data -xdev ! -user 65532 -print -quit)"'
start_minio "$nonroot_container" "65532:65532"
assert_object "$nonroot_container" "before-upgrade"
assert_object "$nonroot_container" "after-upgrade"
assert_object "$nonroot_container" "after-rollback"
put_object "$nonroot_container" "after-second-upgrade"

echo "MinIO volume ownership upgrade and rollback smoke passed"
