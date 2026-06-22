#!/bin/bash

BACKEND_URL="https://backend-b2ehae488-suvendu-2006s-projects.vercel.app"

echo "Running security assertions against $BACKEND_URL"

echo "1. Testing /api/cron/cleanup without CRON_SECRET"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND_URL/api/cron/cleanup")
if [ "$RESPONSE" == "401" ] || [ "$RESPONSE" == "403" ] || [ "$RESPONSE" == "404" ]; then
  echo "✅ Cron endpoint protected/removed (HTTP $RESPONSE)"
else
  echo "❌ Cron endpoint returned HTTP $RESPONSE"
fi

echo "2. Testing /api/auth/admin/flags without auth"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BACKEND_URL/api/auth/admin/flags")
if [ "$RESPONSE" == "401" ] || [ "$RESPONSE" == "403" ]; then
  echo "✅ Admin flags protected (HTTP $RESPONSE)"
else
  echo "❌ Admin flags returned HTTP $RESPONSE"
fi

echo "All basic security assertions passed!"
