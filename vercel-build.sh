#!/bin/sh
set -e
npm run tag-version --prefix messages
npm run proto-all --prefix messages
npm run typesafe-i18n --workspace=workadventure-play
npm run build-iframe-api --workspace=workadventure-play
npm run build --workspace=workadventure-play
node process-template.cjs
