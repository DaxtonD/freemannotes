// Turns finished scan pages into one PDF, on the device. pdf-lib is lazy-loaded (it's already here
// for "download with markup"), so opening the scanner doesn't pull it in until something is saved.

export type ScanPageImage = {
	/** JPEG bytes of the straightened, cleaned-up page. */
	blob: Blob;
	width: number;
	height: number;
};

// Scans are photographed at whatever resolution the camera gives; 200 dpi is a sensible print size
// for the page that comes out, and keeps an A4 sheet roughly A4 rather than the size of a wall.
const ASSUMED_DPI = 200;
const POINTS_PER_INCH = 72;
const MAX_PAGE_POINTS = 842; // A4's long edge.

export function scanPdfFileName(title: string): string {
	const trimmed = String(title || '').trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
	const base = trimmed || 'Scan';
	return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

/** Page size in PDF points for an image, kept in proportion and capped at A4's long edge. */
export function scanPageSize(width: number, height: number): { width: number; height: number } {
	const rawWidth = (width / ASSUMED_DPI) * POINTS_PER_INCH;
	const rawHeight = (height / ASSUMED_DPI) * POINTS_PER_INCH;
	const scale = Math.min(1, MAX_PAGE_POINTS / Math.max(rawWidth, rawHeight));
	return { width: Math.max(1, rawWidth * scale), height: Math.max(1, rawHeight * scale) };
}

export async function buildScanPdf(pages: readonly ScanPageImage[], title: string): Promise<File> {
	if (pages.length === 0) throw new Error('A scan needs at least one page');
	const lib = await import('pdf-lib');
	const doc = await lib.PDFDocument.create();
	doc.setTitle(String(title || '').trim() || 'Scan');
	doc.setCreationDate(new Date());
	for (const page of pages) {
		const bytes = new Uint8Array(await page.blob.arrayBuffer());
		const image = await doc.embedJpg(bytes);
		const size = scanPageSize(page.width, page.height);
		const pdfPage = doc.addPage([size.width, size.height]);
		pdfPage.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
	}
	const saved = await doc.save();
	const buffer = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;
	return new File([buffer], scanPdfFileName(title), { type: 'application/pdf' });
}
