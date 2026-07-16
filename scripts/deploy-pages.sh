#!/usr/bin/env sh
# Deploy der statischen Seite zu GitHub Pages, ohne GitHub Actions.
#
# Baut die App lokal (GITHUB_PAGES=true -> base '/sqrt2/') und publiziert
# den Inhalt von dist/ als Root des gh-pages-Branches. Pages ist auf
# Branch-Deploy (legacy) konfiguriert, da pnpm 11.13 im CI bei esbuild
# Build-Scripts mit ERR_PNPM_IGNORED_BUILDS abbrickt.
#
# Nutzung: scripts/deploy-pages.sh
set -e

cd "$(dirname "$0")/.."

# pnpm 11.13 blockiert esbuild-Postinstall -> install exitet 1. Daher
# installieren, esbuild gezielt rebuiden, dann bauen (ohne packageManager-
# Feld, sonst ruft Vite selbst pnpm install auf und scheitert).
echo "==> pnpm install"
pnpm install --frozen-lockfile >/dev/null 2>&1 || true
pnpm rebuild esbuild >/dev/null 2>&1

echo "==> build (GITHUB_PAGES=true)"
# packageManager-Feld temporaer entfernen, sonst triggert Vite einen
# eigenen (fehlschlagenden) pnpm-install-Lauf.
mv package.json package.json.bak
sed -i.bak '/"packageManager": "pnpm@11.13.0",/d' package.json
GITHUB_PAGES=true pnpm build
mv package.json.bak package.json
rm -f package.json.bak

echo "==> gh-pages Branch aufbauen"
git checkout --orphan gh-pages
git rm -rf . --cached --quiet 2>/dev/null || true
# Alle getrackten + ungetrackten Repo-Dateien aus dem Worktree entfernen,
# dist/ aber bewusst behalten.
find . -maxdepth 1 -not -name '.' -not -name '.git' -not -name 'dist' \
  -exec rm -rf {} +
cp -r dist/. .
rm -rf dist
touch .nojekyll

git add -A
git commit -m "GitHub Pages: Build-Artefakte (Root)"
git push -u origin gh-pages --force

git checkout master
echo "==> fertig: https://thoka.github.io/sqrt2/"
