// Clamp der Frame-Zeitdifferenz im Animations-Loop.
//
// Ein einzelner langer Frame (GC-Pause, Compile-Fertigstellung, Tab-Throttle
// im Hintergrund) darf KEINEN sichtbaren Zeitsprung der Simulation erzeugen.
// Ohne Clamp wuerde ein solcher Frame u_time auf einen Schlag um Sekunden
// vorschieben (Symptom: "Zeit macht ab und zu einen Sprung nach vorne").
//
// Invariante: ein nicht-positiver oder uebermaessig grosser dt wird auf
// `maxDt` begrenzt - so wird hoechstens ein kleiner Ruckler sichtbar, kein
// Sprung.
export function clampDt(dt, maxDt) {
	if (!(dt > 0) || dt > maxDt) return maxDt;
	return dt;
}
