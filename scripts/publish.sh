#!/bin/bash
set -e

echo "=== AutoDev Agent — npm publish ==="

# 1. Build check
echo "Step 1: Build check"
pnpm build

# 2. Verify
echo "Step 2: Verify"
pnpm verify

# 3. Version
VERSION=$(node -p "require('./package.json').version")
echo "Step 3: Publishing version $VERSION"

# 4. Dry run
echo "Step 4: Dry run"
npm publish --dry-run

# 5. Confirm
read -p "Publish v$VERSION? (y/N) " confirm
if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
  npm publish
  echo "✅ Published autodev-agent@$VERSION"
else
  echo "Cancelled."
fi
