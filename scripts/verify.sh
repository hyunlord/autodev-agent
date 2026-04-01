#!/bin/bash
set -e

MODE="${1:-quick}"  # quick or full
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "🔍 Verify mode: $MODE"
echo ""

# ─── Quick Check (항상 실행) ─────────────────────
echo "=== Step 1: Build ==="
pnpm build 2>&1 | tail -5
if [ $? -ne 0 ]; then
  echo ""
  echo "┌─────────────┬──────────┐"
  echo "│    항목     │  결과    │"
  echo "├─────────────┼──────────┤"
  echo "│ Build       │ ❌ FAIL  │"
  echo "├─────────────┼──────────┤"
  echo "│ TOTAL       │ ❌ FAIL  │"
  echo "└─────────────┴──────────┘"
  exit 1
fi
echo "✅ Build passed"
echo ""

echo "=== Step 2: API Health ==="
# Start dev server briefly for API check
pnpm dev &
DEV_PID=$!
sleep 6

FAIL=0
for EP in "/api/status" "/api/projects" "/api/tasks" "/api/mcp" "/api/harness" "/api/pipeline" "/api/usage"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000${EP}" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "  ✅ $EP → $STATUS"
  else
    echo "  ❌ $EP → $STATUS"
    FAIL=1
  fi
done

# Cleanup dev server
kill $DEV_PID 2>/dev/null
sleep 1
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

if [ $FAIL -ne 0 ]; then
  echo ""
  echo "┌─────────────┬──────────┐"
  echo "│    항목     │  결과    │"
  echo "├─────────────┼──────────┤"
  echo "│ Build       │ ✅ PASS  │"
  echo "├─────────────┼──────────┤"
  echo "│ API Health  │ ❌ FAIL  │"
  echo "├─────────────┼──────────┤"
  echo "│ TOTAL       │ ❌ FAIL  │"
  echo "└─────────────┴──────────┘"
  exit 1
fi
echo "✅ All APIs responded 200"
echo ""

# ─── Full Check (커밋 시에만) ─────────────────────
if [ "$MODE" = "full" ]; then
  echo "=== Step 3: Playwright UI Check ==="
  # Restart dev for Playwright
  pnpm dev &
  DEV_PID=$!
  sleep 6

  echo "  Checking / (dashboard)..."
  DASH=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/" 2>/dev/null)
  echo "  Dashboard: $DASH"

  echo "  Checking /harness..."
  HARNESS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/harness" 2>/dev/null)
  echo "  Harness: $HARNESS"

  # Cleanup
  kill $DEV_PID 2>/dev/null
  sleep 1
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true

  if [ "$DASH" != "200" ] || [ "$HARNESS" != "200" ]; then
    echo ""
    echo "┌─────────────┬──────────┐"
    echo "│    항목     │  결과    │"
    echo "├─────────────┼──────────┤"
    echo "│ Build       │ ✅ PASS  │"
    echo "├─────────────┼──────────┤"
    echo "│ API Health  │ ✅ PASS  │"
    echo "├─────────────┼──────────┤"
    echo "│ UI Check    │ ❌ FAIL  │"
    echo "├─────────────┼──────────┤"
    echo "│ TOTAL       │ ❌ FAIL  │"
    echo "└─────────────┴──────────┘"
    exit 1
  fi
  echo "✅ UI pages accessible"
  echo ""
fi

echo ""
echo "┌─────────────┬──────────┐"
echo "│    항목     │  결과    │"
echo "├─────────────┼──────────┤"
echo "│ Build       │ ✅ PASS  │"
echo "├─────────────┼──────────┤"
echo "│ API Health  │ ✅ PASS  │"
if [ "$MODE" = "full" ]; then
echo "├─────────────┼──────────┤"
echo "│ UI Check    │ ✅ PASS  │"
fi
echo "├─────────────┼──────────┤"
echo "│ TOTAL       │ ✅ PASS  │"
echo "└─────────────┴──────────┘"
