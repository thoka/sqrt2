// Zustands-Stores (TOOLING_SPEC.md Phase 2). Drei Schichten nach
// Änderungsfrequenz/Reichweite getrennt (siehe Spec Abschnitt 3.1):
// configStore/playbackStore sind die künftig fensterübergreifend
// synchronisierten Stores (BroadcastChannel-Adapter folgt in Phase 5,
// hier bewusst noch nicht angebunden); compiledStore ist rein lokal
// abgeleitet, NIE über einen Transport übertragen (siehe Spec: das Neu-
// Berechnen aus dem kleinen configStore ist schnell/deterministisch,
// die Übertragung der riesigen bank_pieces-Ergebnisse wäre es nicht).
//
// configStore/playbackStore liegen in configStore.js (eigenes Modul), um
// einen zirkulären Import mit compileOrchestrator.js zu vermeiden: dieser
// importiert configStore, während stores.js den Orchestrator re-exportiert.
export { configStore, playbackStore } from './configStore.js';

// compiledStore + compileStatusStore kommen aus dem Orchestrator
// (ASYNC-COMPILE-PLAN): asynchron, cancelbar via Worker-terminate, damit
// tiefe Kompilierung den Main-Thread nicht blockiert. Der Store-Name und
// die Form bleiben für alle Konsumenten (App/ControlPanel/TargetBankCanvas/
// RestCounter*/PlaybackBar) unverändert - nur die Befüllung ist jetzt
// asynchron.
export { compiledStore, compileStatusStore, runCompile } from './compileOrchestrator.js';
