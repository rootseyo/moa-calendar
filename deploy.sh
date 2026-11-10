#!/bin/bash
set -e

# ========================================================
# 🚀 Deployment script for DWM Calendar (dwm.brightnetworks.kr)
# Remote Host: pi-local-server
# Remote Dir: /home/sean/services/share-schedule
# PM2 App Name: dwm-calendar
# Port: 4020
# ========================================================

REMOTE_USER="${REMOTE_USER:-sean}"
REMOTE_HOST="${REMOTE_HOST:-pi-server}"
REMOTE_DIR="${REMOTE_DIR:-/home/sean/services/share-schedule}"
APP_NAME="${APP_NAME:-dwm-calendar}"
PORT="${PORT:-4020}"
REMOTE_APP_URL="${REMOTE_APP_URL:-https://dwm.brightnetworks.kr}"
REMOTE_DB_URL="${REMOTE_DATABASE_URL:-postgresql://schedule_user:CHANGE_ME_PASSWORD@127.0.0.1:5432/share_schedule_db}"

echo "🧪 1. Running local tests..."
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  echo "⏭️ Skipping tests as requested."
else
  node --test test/public-pages.test.mjs test/event-utils.test.mjs test/google-tokens.test.mjs test/holidays.test.mjs test/calendar-management.test.mjs test/calendar-display.test.mjs test/calendar-moves.test.mjs test/ical.test.mjs test/caldav.test.mjs test/caldav-sync.test.mjs test/icloud-ui.test.mjs test/calendar-migration.test.mjs test/settings-delete.test.mjs test/lunar.test.mjs test/push-notifications.test.mjs test/weather.test.mjs test/schedule-shares.test.mjs test/calendar-invites.test.mjs
fi

echo "🔄 2. Syncing files to ${REMOTE_HOST}:${REMOTE_DIR}..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "mkdir -p ${REMOTE_DIR}"

rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.DS_Store' \
  --exclude 'android' \
  --exclude 'docs' \
  ./ ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/

echo "🔒 3. Ensuring remote .env file..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "if [ ! -f ${REMOTE_DIR}/.env ]; then
  cat > ${REMOTE_DIR}/.env << ENVEOF
PORT=${PORT}
APP_URL=${REMOTE_APP_URL}
DATABASE_URL=${REMOTE_DB_URL}
DEMO_MODE=false
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
KAKAO_CLIENT_ID=
KAKAO_CLIENT_SECRET=
ENVEOF
  chmod 600 ${REMOTE_DIR}/.env
  echo 'Created default remote .env file.'
fi"

echo "⚙️ 4. Installing dependencies & running migrations on ${REMOTE_HOST}..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "bash -c '
  set -e
  export PATH=/home/sean/.npm-global/bin:\$PATH
  cd ${REMOTE_DIR}

  echo \"📥 Installing dependencies...\"
  npm install --omit=dev

  echo \"🔑 Ensuring VAPID keys...\"
  node scripts/ensure-vapid-keys.mjs

  echo \"🗄️ Applying database migrations...\"
  npm run db:migrate

  echo \"🚀 Reloading/Starting PM2 process [${APP_NAME}]...\"
  if pm2 describe ${APP_NAME} > /dev/null 2>&1; then
    pm2 reload ${APP_NAME}
  else
    pm2 start server.mjs --name \"${APP_NAME}\" --node-args=\"--env-file-if-exists=.env\"
  fi
  pm2 save

  echo \"🩺 Verifying health...\"
  sleep 2
  for attempt in 1 2 3 4 5; do
    if curl -fsS http://127.0.0.1:${PORT}/api/health > /dev/null; then
      echo \"✅ Service is live on port ${PORT}!\"
      exit 0
    fi
    sleep 1
  done
  echo \"❌ Health check failed.\"
  exit 1
'"

echo "✨ Deployment to ${REMOTE_HOST} completed successfully!"
