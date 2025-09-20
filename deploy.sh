#!/usr/bin/env bash
# One-command helper for local deploy to Railway or Render CLI if available.
# Make executable: chmod +x deploy.sh
set -e

echo "BLACKGIFT AI — one-command deploy helper"

if command -v railway >/dev/null 2>&1; then
  echo "Detected Railway CLI -> running: railway up"
  railway up
  exit 0
fi

if command -v render >/dev/null 2>&1; then
  echo "Detected Render CLI -> running: render deploy"
  render deploy
  exit 0
fi

echo "Railway and Render CLIs not found. Installing Railway CLI globally..."
npm install -g @railway/cli

if command -v railway >/dev/null 2>&1; then
  echo "Running: railway up"
  railway up
  exit 0
else
  echo "Failed to install or run Railway CLI. Please install Railway CLI manually:"
  echo "  npm i -g @railway/cli"
  echo "Then run: railway up"
  exit 1
fi