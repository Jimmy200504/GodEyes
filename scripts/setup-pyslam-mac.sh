#!/usr/bin/env bash
# The old all-in-one installer is superseded; never invoke install_all.sh here.
set -e
exec bash "$(dirname "$0")/setup-pyslam-minimal-mac.sh" "$@"
