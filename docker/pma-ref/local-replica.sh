#!/bin/bash
# The reference phpMyAdmin of the dev replica (:3308) on :8083 without Docker (docker/pma-ref/local-instance.sh).
#   docker/pma-ref/local-replica.sh [checkout=/home/user/ref/pma] [instance=/home/user/ref/pma-replica] [port=8083]
exec "$(dirname "$0")/local-instance.sh" "${2:-/home/user/ref/pma-replica}" "${3:-8083}" 3308 replica "${1:-/home/user/ref/pma}"
