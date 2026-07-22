// mathJaxSvgImage.js — laedt einen SVG-String (von MathJax gerendert ODER
// aus dem persistenten Cache, siehe mathJaxImageCache.js) als
// HTMLImageElement. BEWUSST von mathJaxRenderer.js (das komplette,
// mehrere-hundert-KB-schwere MathJax-Modul) getrennt: dieses Modul hat
// KEINE MathJax-Abhaengigkeit und wird daher IMMER statisch importiert
// (mathJaxLabelCache.js), waehrend mathJaxRenderer.js nur bei einem echten
// Cache-Miss dynamisch nachgeladen wird - siehe mathJaxLabelCache.js.
export async function svgStringToImage(svgString) {
	const widthMatch = svgString.match(/width="([\d.]+)ex"/);
	const heightMatch = svgString.match(/height="([\d.]+)ex"/);
	const widthEx = widthMatch ? parseFloat(widthMatch[1]) : 0;
	const heightEx = heightMatch ? parseFloat(heightMatch[1]) : 0;
	const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;

	const img = new Image();
	await new Promise((resolve, reject) => {
		img.onload = resolve;
		img.onerror = () => reject(new Error('Bild-Laden aus SVG-String fehlgeschlagen'));
		img.src = dataUrl;
	});
	return { img, widthEx, heightEx };
}
