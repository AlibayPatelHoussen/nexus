#!/bin/bash
export $(grep -v '^#' /opt/nexus/backend/.env | xargs)
exec node /opt/nexus/backend/dist/index.js
