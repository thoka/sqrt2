#!/usr/bin/env bash
#
# setup-env.sh - richtet die Coding-Instanz (arch/cachedos, rolling release)
# fuer dieses Projekt ein. Setzt alles auf, was TOOLING_ENV_SPEC.md (§3)
# wuenscht: Node + pnpm, Chromium-Systemlibs + Playwright-Browser, Projekt
# via pnpm. Idempotent - kann wiederholt ausgefuehrt werden.
#
# Aufruf (auf der neuen Instanz, als root oder mit sudo):
#   ./scripts/setup-env.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

echo "==> [1/6] System aktualisieren (rolling release)"
$SUDO pacman -Syu --noconfirm

echo "==> [2/6] Basis-Dev-Tools + Node.js + npm"
$SUDO pacman -S --noconfirm --needed base-devel git nodejs npm

echo "==> [3/6] pnpm via corepack aktivieren"
$SUDO corepack enable
$SUDO corepack prepare pnpm@latest --activate

echo "==> [4/6] System-Bibliotheken fuer Playwright/Chromium"
# Playwright laedt ein eigenes chromium, braucht aber die Runtime-Libs.
$SUDO pacman -S --noconfirm --needed \
  nss at-spi2-core at-spi2-atk cups libcups libdrm libxkbcommon \
  libxcomposite libxdamage libxfixes libxrandr libxshmfence \
  libgbm pango cairo alsa-lib gtk3 libxcb libx11 mesa \
  noto-fonts ttf-dejavu

echo "==> [5/6] Projekt-Abhaengigkeiten via pnpm"
if [ -f package-lock.json ] && [ ! -f pnpm-lock.yaml ]; then
  echo "    (konvertiere npm-lock -> pnpm-lock)"
  pnpm import
fi
pnpm install
pnpm add -D @playwright/test

echo "==> [6/6] Playwright-Browser (chromium) + Build"
pnpm exec playwright install chromium
pnpm build

echo ""
echo "Fertig. E2E-Smoke-Test ausfuehren mit:  pnpm test:e2e"
echo "(startet einen Vite-Preview-Server auf :4173 und prueft dist/sqrt2.html)"
