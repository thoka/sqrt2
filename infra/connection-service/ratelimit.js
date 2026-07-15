// Brute-Force-Schutz (Spec §9): RAM-basierter Fixed-Window-Rate-Limiter
// sowie exponentielles Backoff bei falscher PIN. Keine externen Deps.

// Fixed-Window-Limiter: erlaubt max. `max` Treffer pro `windowMs` je Key.
// Key ist typ. die API-Key-Id oder eine IP. Ueberschreitung -> 429.
export class FixedWindowLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
    // Periodisches Aufraeumen verhinderter Speicher-Wachstum. `.unref()`
    // damit der Timer den Prozess nicht am Beenden hindert.
    this._timer = setInterval(() => this._sweep(), windowMs);
    this._timer.unref?.();
  }

  _sweep() {
    const now = Date.now();
    for (const [k, v] of this.hits) if (now - v.start >= this.windowMs) this.hits.delete(k);
  }

  // true => erlaubt. Bei Ueberschreitung false; Retry-After ueber retryAfterMs().
  check(key) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || now - e.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    if (e.count >= this.max) return false;
    e.count += 1;
    return true;
  }

  retryAfterMs(key) {
    const e = this.hits.get(key);
    if (!e) return 0;
    return Math.max(0, this.windowMs - (Date.now() - e.start));
  }

  reset(key) {
    this.hits.delete(key);
  }

  close() {
    clearInterval(this._timer);
  }
}

// Exponentielles PIN-Backoff je Token: nach `grace` Fehlversuchen waechst
// die Sperre als baseMs * 2^(fails-grace-1), gedeckelt auf maxMs.
// Ein erfolgreicher Join (registerSuccess) setzt den Zaehler zurueck.
export class PinBackoff {
  constructor({ baseMs = 1000, maxMs = 60000, grace = 8 } = {}) {
    this.baseMs = baseMs;
    this.maxMs = maxMs;
    this.grace = grace;
    this.state = new Map();
  }

  registerFailure(tokenId) {
    const now = Date.now();
    const s = this.state.get(tokenId) ?? { fails: 0, until: 0 };
    s.fails += 1;
    if (s.fails > this.grace) {
      const wait = Math.min(this.maxMs, this.baseMs * 2 ** (s.fails - this.grace - 1));
      s.until = now + wait;
    }
    this.state.set(tokenId, s);
    return Math.max(0, s.until - now);
  }

  registerSuccess(tokenId) {
    this.state.delete(tokenId);
  }

  lockedMs(tokenId) {
    const s = this.state.get(tokenId);
    if (!s) return 0;
    return Math.max(0, s.until - Date.now());
  }
}
