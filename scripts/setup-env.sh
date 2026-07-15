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

echo "==> [3/6] pnpm installieren (Arch: eigenes Paket, nicht via corepack)"
# Auf Arch ist corepack ein eigenes Paket und wird nicht mehr mit nodejs
# ausgeliefert - pnpm daher direkt per pacman installieren (robuster, kein
# zusaetzlicher Shim/Network-Schritt).
$SUDO pacman -S --noconfirm --needed pnpm

echo "==> [4/6] System-Bibliotheken fuer Playwright/Chromium"
# Playwright laedt ein eigenes chromium, braucht aber die Runtime-Libs.
$SUDO pacman -S --noconfirm --needed \
  nss atk at-spi2-core at-spi2-atk cups libcups libdrm libxkbcommon \
  libxcomposite libxdamage libxfixes libxrandr libxshmfence \
  pango cairo alsa-lib gtk3 libxcb libx11 mesa \
  noto-fonts ttf-dejavu

echo "==> [5/6] Projekt-Abhaengigkeiten via pnpm"
#KEIN 'pnpm import' aus package-lock.json: der Konvertierungsschritt
#stoest auf pnpms 'resolution-policy'-Pruefung (minimumReleaseAge) und
#bricht ab. pnpm install erzeugt stattdessen direkt eine frische
#pnpm-lock.yaml aus package.json (reproduzierbar, sofern die Lock eingecheckt
#wird). npm package-lock.json wird dabei ignoriert.
pnpm install
pnpm rebuild esbuild   # pnpm 11 blockiert Build-Skripte per Default - esbuild
                      # (vom Vite-Build benoetigt) explizit nachbauen
pnpm add -D @playwright/test

echo "==> [6/6] Playwright-Browser (chromium) + Build"
pnpm exec playwright install chromium
pnpm build

echo ""
echo "Fertig. E2E-Smoke-Test ausfuehren mit:  pnpm test:e2e"
echo "(startet einen Vite-Preview-Server auf :4173 und prueft dist/sqrt2.html)"
