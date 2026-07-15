// Lokaler Anzeige-Zustand (TOOLING_SPEC.md Phase 4c) - welches
// Rest-Widget gerade aktiv ist ("bars" = <RestCounterBars>,
// "grid" = <RestCounterGrid>). Bewusst KEIN synchronisierter Store:
// die Widget-Auswahl ist reine Lokal-Prireferenz des jeweiligen
// Fensters, NICHT Teil des geteilten Zustands (nur configStore/
// playbackStore werden laut Spec §3.1 über BroadcastChannel
// synchronisiert). Daher hier ein eigenständiger writable, unabhängig
// von src/lib/stores.js (dorthin gehört er nicht).
import { writable } from 'svelte/store';

export const displayStore = writable({
	restWidget: 'bars', // 'bars' | 'grid'
});
