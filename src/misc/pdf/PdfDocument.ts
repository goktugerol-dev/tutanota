import { PdfDictValue, PdfStreamEncoding, WHITE_SPACE } from "./PdfConstants.js"
import { PdfWriter } from "./PdfWriter.js"
import pako from "pako"

export enum PDF_FONTS {
	REGULAR = 1,
	BOLD = 2,
}

export enum PDF_IMAGES {
	TUTAO_LOGO = 1,
}

export class PdfDocument {
	private readonly textEncoder: TextEncoder
	private readonly pdfWriter: PdfWriter

	private pageCount: number = 0
	private textStream: string = ""
	private graphicsStream: string = ""

	constructor() {
		this.textEncoder = new TextEncoder()
		this.pdfWriter = new PdfWriter(this.textEncoder)
		this.pdfWriter.setupDefaultObjects()
		this.addPage()
	}

	/**
	 * Create the document
	 */
	create() {
		this.renderText()
		this.renderGraphics()
		this.pdfWriter.writePdf()
	}

	/**
	 * Closes the current textStream and writes it into an object
	 */
	private renderText() {
		const encodedTextStream = pako.deflate(`BT /F1 24 Tf 5 TL ` + this.textStream + ` ET`)
		this.pdfWriter.createStreamObject(new Map(), encodedTextStream, PdfStreamEncoding.FLATE, `TEXT_${this.pageCount}`)
		this.textStream = ""
	}

	/**
	 * Closes the current graphicsStream and writes it into an object
	 */
	private renderGraphics() {
		const encodedGraphicsStream = pako.deflate(`q ` + this.graphicsStream + ` Q`)
		this.pdfWriter.createStreamObject(new Map(), encodedGraphicsStream, PdfStreamEncoding.FLATE, `GRAPHICS_${this.pageCount}`)
		this.graphicsStream = ""
	}

	/**
	 * Append a new page to the PDF document
	 */
	addPage() {
		// When adding a new page, all content streams must be rendered on the previous page.
		if (this.pageCount > 0) {
			this.renderText()
			this.renderGraphics()
		}
		this.pageCount++

		// Create new page object
		const pageRefId = `PAGE_${this.pageCount}`
		this.pdfWriter.createObject(
			new Map<string, PdfDictValue>([
				["Type", "/Page"],
				["Parent", { refId: "PAGES" }],
				["MediaBox", `[ 0 0 ${toPDFUnit(210)} ${toPDFUnit(297)}]`],
				["Resources", { refId: "RESOURCES" }],
				["Contents", [{ refId: `TEXT_${this.pageCount}` }, { refId: `GRAPHICS_${this.pageCount}` }]],
			]),
			pageRefId,
		)

		// Add reference to the new page in the page-tree
		const pageTreeDictionary = this.pdfWriter.getObjectByRefId("PAGES").getDictionary()
		const pageTreeKids = pageTreeDictionary.get("Kids")
		if (pageTreeKids && Array.isArray(pageTreeKids)) {
			pageTreeKids.push({ refId: pageRefId })
			pageTreeDictionary.set("Kids", pageTreeKids)
		}
		pageTreeDictionary.set("Count", `${this.pageCount}`)
	}

	/**
	 * Place a text string at the given coordinates in millimeters
	 * The coordinate field is in the first quadrant, i.e. the point of origin is bottom-left
	 * @param text The text to place
	 * @param x x millimeter coordinate
	 * @param y y millimeter coordinate
	 */
	placeText(text: string, x: number, y: number) {
		this.textStream += `1${WHITE_SPACE}0${WHITE_SPACE}0${WHITE_SPACE}1${WHITE_SPACE}${toPDFUnit(x)}${WHITE_SPACE}${toPDFUnit(y)}  Tm <${buf2hex(
			this.textEncoder.encode(text),
		)}> Tj`
	}

	placeImage(image: PDF_IMAGES, x: number, y: number, width: number, height: number) {
		this.graphicsStream += `${toPDFUnit(width)} 0 0 ${toPDFUnit(height)} ${toPDFUnit(x)}, ${toPDFUnit(y)} cm /Im${image} Do`
	}

	placeLine(fromX: number, fromY: number, toX: number, toY: number) {
		this.graphicsStream += `${toPDFUnit(fromX)} ${toPDFUnit(fromY)} m ${toPDFUnit(toX)} ${toPDFUnit(toY)} l s`
	}

	changeFont(font: PDF_FONTS, points: number) {
		this.textStream += `/F${font} ${points} Tf ${points} TL `
	}
}

function mmToInch(mm: number) {
	return mm * 0.039370079
}

function toPDFUnit(mm: number) {
	return mmToInch(mm) * 72
}

function buf2hex(buffer: Uint8Array) {
	return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("")
}
