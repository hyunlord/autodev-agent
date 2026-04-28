#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}AutoDev Agent Setup${NC}"
echo "===================="
echo ""

# Step 1: Node.js 버전 체크
echo "Checking Node.js version..."
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' || echo "0")
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 20 ]; then
  echo -e "${RED}Error: Node.js 20+ required. Current: v$NODE_VERSION${NC}"
  echo "Install Node 20+ from https://nodejs.org or use nvm:"
  echo "  nvm install 20 && nvm use 20"
  exit 1
fi
echo -e "${GREEN}✓ Node.js v$NODE_VERSION${NC}"

# Step 2: pnpm 체크
echo ""
echo "Checking pnpm..."
if ! command -v pnpm &> /dev/null; then
  echo -e "${YELLOW}pnpm not found. Installing...${NC}"
  npm install -g pnpm@9
fi
PNPM_VERSION=$(pnpm -v)
echo -e "${GREEN}✓ pnpm v$PNPM_VERSION${NC}"

# Step 3: 의존성 설치
echo ""
echo "Installing dependencies..."
pnpm install --frozen-lockfile
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Step 4: .env 처리
echo ""
if [ -f ".env" ]; then
  echo -e "${GREEN}✓ .env already exists${NC}"
else
  cp .env.example .env
  echo -e "${YELLOW}Created .env from .env.example${NC}"
  echo ""
  echo "Please enter your ANTHROPIC_API_KEY:"
  echo "(Get one at https://console.anthropic.com/)"
  echo ""
  read -r -p "API Key (press Enter to skip and edit .env later): " API_KEY

  if [ -n "$API_KEY" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$API_KEY|" .env
    else
      sed -i "s|ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$API_KEY|" .env
    fi
    echo -e "${GREEN}✓ ANTHROPIC_API_KEY set in .env${NC}"
  else
    echo -e "${YELLOW}Skipped. Edit .env and set ANTHROPIC_API_KEY before running pnpm dev${NC}"
  fi
fi

# Step 5: DB 초기화
echo ""
echo "Initializing database..."
pnpm db:push
echo -e "${GREEN}✓ Database ready${NC}"

# Step 6: 완료
echo ""
echo -e "${GREEN}===================="
echo -e "✓ Setup complete!"
echo -e "====================${NC}"
echo ""
echo "Run the dev server:"
echo "  pnpm dev"
echo ""
echo "Then open http://localhost:3000"
