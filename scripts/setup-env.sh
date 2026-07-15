#!/usr/bin/env bash
#
# setup-env.sh - richtet die Coding-Instanz (arch/cachedos, rolling release)
# fuer dieses Projekt ein. Setzt alles auf, was TOOLING_ENV_SPEC.md (§3)
# wuenscht: Node + pnpm (via mise, deklarativ gepinnt), Chromium-Systemlibs
# + Playwright-Browser, Projekt via pnpm. Idempotent.
#
# Toolchain-Pinning laeuft ueber mise + direnv (siehe mise.toml / .envrc):
# beim Betreten des Repos aktiviert direnv automatisch die gepinnten
# node/pnpm-Versionen - kein manuelles corepack/Global-Install mehr.
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

echo "==> [2/6] Basis-Dev-Tools"
# node/npm kommen via mise (siehe mise.toml), hier nur die Build-Basis.
$SUDO pacman -S --noconfirm --needed base-devel git

echo "==> [3/6] mise + direnv installieren, Tools pinnen"
$SUDO pacman -S --noconfirm --needed mise direnv
mise install                                   # node + pnpm aus mise.toml
eval "$(mise activate bash)"                   # gepinntes node/pnpm ins PATH
# Falls mise keinen pnpm-Backend hat: pnpm via mise-npm nachinstallieren.
if ! command -v pnpm >/dev/null 2>&1; then
  npm i -g pnpm@11
fi

echo "==> [4/6] System-Bibliotheken fuer Playwright/Chromium"
# Playwright laedt ein eigenes chromium, braucht aber die Runtime-Libs.
$SUDO pacman -S --noconfirm --needed \
  nss atk at-spi2-core at-spi2-atk cups libcups libdrm libxkbcommon \
  libxcomposite libxdamage libxfixes libxrandr libxshmfence \
  pango cairo alsa-lib gtk3 libxcb libx11 mesa \
  noto-fonts ttf-dejavu

echo "==> [5/6] Projekt-Abhaengigkeiten via pnpm"
# KEIN 'pnpm import' aus package-lock.json (stoest auf pnpms
# resolution-policy-Pruefung). pnpm install erzeugt eine frische
# pnpm-lock.yaml aus package.json.
# pnpm install kann mit ERR_PNPM_IGNORED_BUILDS exit!=0 enden, wenn Build-
# Skripte blockiert sind. Das ist hier bekannt (esbuild, s. pnpm-workspace.yaml
# onlyBuiltDependencies) und wird gezielt per 'pnpm rebuild esbuild' nachgeholt.
# Daher Install nicht hart abbrechen lassen (set -e).
pnpm install || echo "pnpm install: ignorierte Build-Skripte (bekannt) - werden via rebuild nachgebaut"
pnpm rebuild esbuild   # erzwingt esbuild-Postinstall trotz 'Already up to date'
                      # (vom Vite-Build benoetigt)
pnpm add -D @playwright/test

echo "==> [6/6] Playwright-Browser (chromium) + Build"
pnpm exec playwright install chromium
pnpm build

echo ""
echo "Fertig. E2E-Smoke-Test ausfuehren mit:  pnpm test:e2e"
echo "(startet einen Vite-Preview-Server auf :4173 und prueft dist/sqrt2.html)"
