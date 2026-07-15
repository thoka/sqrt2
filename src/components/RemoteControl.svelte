<script>
  // RemoteControl (TOOLING_SPEC.md Phase 5) - zweiter Vite-Entry für ein
  // separates Fenster/Gerät: nur Steuerung (ControlPanel + PlaybackBar),
  // KEIN Canvas und KEIN Rest-Widget. Liest/schreibt ausschließlich
  // configStore/playbackStore, die über initSync() mit dem Haupttool
  // (sqrt2.html) via BroadcastChannel synchronisiert sind - die Komponente
  // selbst merkt davon nichts (der Transport ist gekapselt in syncedStore).
  import ControlPanel from './ControlPanel.svelte';
  import PlaybackBar from './PlaybackBar.svelte';
  import { initSync } from '../lib/syncedStore.js';

  initSync();
</script>

<main class="remote">
  <h1>Fernsteuerung</h1>
  <p class="hint">Steuert das Haupttool (&sqrt;2-Flächenmodell) auf einem anderen Bildschirm. Änderungen hier werden live übernommen.</p>
  <div id="controlPanelMount"><ControlPanel /></div>
  <div id="playbackBarMount"><PlaybackBar /></div>
</main>

<style>
  .remote {
    font-family: system-ui, sans-serif;
    background: #0f172a;
    color: #cbd5e1;
    min-height: 100vh;
    margin: 0;
    padding: 1rem 1.25rem;
    box-sizing: border-box;
  }
  h1 { color: #3b82f6; font-size: 1.4rem; margin: 0 0 0.25rem; }
  .hint { font-size: 0.85rem; color: #94a3b8; margin: 0 0 1rem; max-width: 40ch; }
  :global(.control-group) {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 6px 0;
    font-size: 0.9rem;
  }
  :global(.control-row) { display: flex; gap: 1rem; flex-wrap: wrap; }
  :global(hr) { border: 1px solid #334155; margin: 10px 0; }
</style>
