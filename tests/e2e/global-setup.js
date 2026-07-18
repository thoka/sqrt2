import { spawn } from 'node:child_process';

// WSL2 (mirrored networking, z.B. für Tailscale) liefert für Verbindungen zu
// geschlossenen Loopback-Ports kein RST/ECONNREFUSED, sondern hängt auf
// SYN-SENT. Playwrights eingebauter webServer-Check (isURLAvailable in
// playwright-core) setzt dafür keinen socketTimeout und hängt daher in
// dieser Umgebung für immer, noch bevor der Server-Prozess gestartet wird
// (siehe docs/E2E-PLAYWRIGHT-SPEC.md). Deshalb starten + pollen wir den
// Preview-Server hier selbst mit einem Fetch, der per AbortSignal.timeout
// zuverlässig abbricht statt auf den TCP-Fehler zu warten.
const URL = 'http://localhost:4173/';
const POLL_TIMEOUT_MS = 1000;
const MAX_ATTEMPTS = 30;

async function isServerUp() {
	try {
		await fetch(URL, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });
		return true;
	} catch {
		return false;
	}
}

export default async function globalSetup() {
	const server = spawn(
		'node',
		['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'],
		{ stdio: 'ignore' },
	);

	let exitError = null;
	server.on('exit', (code) => {
		if (code !== null && code !== 0)
			exitError = new Error(`webServer-Prozess beendet mit Code ${code}`);
	});

	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		if (exitError) throw exitError;
		if (await isServerUp()) {
			return () => server.kill();
		}
	}

	server.kill();
	throw new Error(
		`webServer unter ${URL} nicht erreichbar nach ${MAX_ATTEMPTS * POLL_TIMEOUT_MS}ms`,
	);
}
