#!/usr/bin/env node
// ESLint + Prettier NUR auf die gestagten Dateien (lint-staged) statt auf
// den ganzen Baum (vormals `pnpm check`) - mehrere parallele Worker/Sessions
// im selben Arbeitsverzeichnis sollen sich nicht gegenseitig blockieren, nur
// weil irgendwo unstaged/WIP-Code eines ANDEREN Workers gerade nicht
// formatiert ist. svelte-check und knip brauchen zwingend den ganzen
// Projekt-Kontext (Typprüfung über Dateigrenzen, Ungenutzt-Erkennung über den
// ganzen Graph) - für die gibt es keinen sinnvollen "nur diese Datei"-Modus,
// die bleiben bewusst NUR im CI-Gate (`pnpm check` in .github/workflows),
// nicht mehr im lokalen Pre-Commit-Hook.
import { execFileSync } from 'node:child_process';
import 'lint-staged';

execFileSync('pnpm', ['exec', 'lint-staged'], { stdio: 'inherit' });
