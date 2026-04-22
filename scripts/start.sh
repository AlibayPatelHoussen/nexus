#!/bin/bash
set -a
source /opt/nexus/backend/.env
set +a
exec node /opt/nexus/backend/dist/index.js
