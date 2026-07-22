// mathMetrics.js — geometrische Konstanten, die MathJax' CHTML-Ausgabe fuer
// Brueche/Exponenten/Indizes tatsaechlich verwendet, EMPIRISCH vermessen
// (nicht aus der TeX-Spezifikation abgetippt - MathJax weicht in Details
// davon ab). Herkunft: `scripts/mathjax-metrics.mjs` (MathJax 3,
// `tex-mml-chtml.js`, Config `{ chtml: { displayAlign: 'left' } }` - exakt
// die Config, die dieses Projekt vor Commit b3adf99 fuer die Zahlentafel
// nutzte). Methodik + Rohmesswerte: docs/MATHJAX_METRICS.md.
//
// Zweck: `mathCanvasRenderer.js` baut damit Brueche/Exponenten NACH, OHNE
// MathJax zur Laufzeit zu laden (MathJax' pro-Frame `typesetPromise` war
// die Hauptursache des Flug-Stotterns, siehe Commit b3adf99 - MathJax bleibt
// ein reines OFFLINE-Analyse-Werkzeug, nie Teil des Laufzeit-Bundles).
//
// Alle Werte sind Verhaeltnisse zur "Grundschriftgroesse" (fontPx) - der
// Groesse, in der ein normales Zeichen an der jeweiligen Stelle gezeichnet
// wuerde (analog zu TeX' "textstyle"/Stufe 0).
//
// Stand der Messung: 2026-07-20, MathJax 3 (jsdelivr-CDN, `tex-mml-chtml.js`).
// Neu vermessen mit: `node scripts/mathjax-metrics.mjs --json <datei>`.
export const MATH_METRICS = {
	// Schriftgroesse von Zaehler/Nenner (Bruch) UND Exponent/Index
	// (hoch-/tiefgestellt) relativ zur Grundschrift. EIN Wert fuer beide -
	// empirisch identisch gemessen (0.7070 bzw. 0.7070, siehe Bericht),
	// entspricht TeX' "eine Scriptlevel-Stufe runter" (~1/√2).
	SCRIPT_SCALE: 0.707,
	// Bruchstrich-Dicke relativ zur Grundschrift.
	RULE_THICKNESS: 0.06,
	// Abstand Zaehler->Bruchstrich UND Bruchstrich->Nenner, relativ zur
	// Grundschrift (empirisch fast exakt gleich gross wie RULE_THICKNESS
	// selbst - siehe docs).
	RULE_GAP: 0.06,
	// Wie weit die Grundlinie des Exponenten UEBER der normalen Grundlinie
	// angehoben wird, relativ zur Grundschrift.
	SUP_SHIFT: 0.358,
	// Wie weit die Grundlinie des Index UNTER der normalen Grundlinie
	// abgesenkt wird, relativ zur Grundschrift.
	SUB_SHIFT: 0.128,
};
