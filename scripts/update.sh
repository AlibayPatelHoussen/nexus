#!/bin/bash
# Nexus — update = full deploy (pull, build backend AND frontend, migrations,
# restart, and check that the new backend is really the one running)
exec bash "$(dirname "$0")/deploy.sh" "$@"
