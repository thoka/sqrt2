// Exponat-Server (Option "ein Server"): ein einziger Node-Prozess, der
// - die gebauten sqrt2-Statics aus dist/ ausliefert UND
// - den Connection-Relay (createRelay) embedded mitfuehrt (unter /api + /ws).
// Ergebnis: EIN Origin, KEIN CORS, KEIN zweiter Prozess, KEIN Proxy-
// Gefrickel. Das Handy laedt die Oberflaeche und joint den Relay ueber
// dieselbe URL (z.B. http://<host>:5173 oder <host>.<tailnet>.ts.net).
//
//   node server/index.js
//   DATA_DIR=./data API_KEYS=mein-key PORT=5173 node server/index.js
//
// Statics: erwartet ein zuvor gebautes dist/ (pnpm build). Fuer reines
// Entwickeln reicht Vite + Proxy (siehe vite.config.js); dieser Server ist
// die schlanke Produktionsform.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay } from './relay/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 5173);

// Statics aus dist/ servieren (mpa: nur reale Dateien, sonst 404 - keine
// SPA-Fallback, damit unknown Pfade nicht still auf index.html umleiten).
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
};

function serveStatic(req, res) {
	const url = new URL(req.url, 'http://localhost');
	let pathname = decodeURIComponent(url.pathname);
	if (pathname.endsWith('/')) pathname += 'index.html';
	// gegen Path-Traversal absichern
	const filePath = path.normalize(path.join(DIST, pathname));
	if (!filePath.startsWith(DIST)) {
		res.writeHead(403);
		return res.end('forbidden');
	}
	fs.readFile(filePath, (err, data) => {
		if (err) {
			res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
			return res.end('not found');
		}
		const ext = path.extname(filePath).toLowerCase();
		res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
		res.end(data);
	});
}

// Relay embedded einhaengen (unter demselben Port/Origin).
const relay = createRelay();

const server = http.createServer((req, res) => {
	const p = new URL(req.url, 'http://localhost').pathname;
	if (p === '/health' || p.startsWith('/api') || p.startsWith('/admin')) {
		return relay.requestHandler(req, res);
	}
	// Status-Page des Relays nur unter '/' wenn keine Statics da sind;
	// sonst Statics bevorzugen.
	if (p === '/' && !fs.existsSync(path.join(DIST, 'index.html'))) {
		return relay.requestHandler(req, res);
	}
	serveStatic(req, res);
});

relay.attachWs(server);

server.listen(PORT, () => {
	console.log('========================================================');
	console.log(' sqrt2 Exponat-Server gestartet');
	console.log(
		` STATICS: ${fs.existsSync(path.join(DIST, 'index.html')) ? DIST : '(dist/ fehlt - zuerst pnpm build)'}`,
	);
	console.log(` ADMIN_KEY (Relay, in ${process.env.DATA_DIR ?? './data'}/admin_key):`);
	console.log(`   ${relay.ADMIN_KEY}`);
	console.log(` http://localhost:${PORT}  (/health, /api/token, /ws)`);
	console.log('========================================================');
});
