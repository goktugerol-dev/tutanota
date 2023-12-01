import { GENERATION_NUMBER, PdfObject } from "./PdfObject.js"
import { NEW_LINE, PdfDictValue, PdfStreamEncoding, WHITE_SPACE } from "./PdfConstants.js"

/**
 * PDF object with an additional stream.
 * The stream requires different encoding syntax
 */
export class PdfStreamObject extends PdfObject {
	private readonly stream: Uint8Array

	constructor(objectNumber: number, objectDictionary: Map<string, PdfDictValue>, stream: Uint8Array, streamEncoding: PdfStreamEncoding) {
		super(objectNumber, objectDictionary)
		this.stream = stream
		this.objectDictionary.set("Filter", streamEncoding)
		this.objectDictionary.set("Length", stream.byteLength.toString())
	}

	public encodeToUInt8Array(textEncoder: TextEncoder): Uint8Array {
		if (this.bytePosition === -1) console.warn("Encoded a PDF object without knowing its byte-position!")
		return new Uint8Array([...this.encodeObjectHead(textEncoder), ...this.stream, ...this.encodeObjectTail(textEncoder)])
	}

	public encodeObjectHead(textEncoder: TextEncoder): Uint8Array {
		let head = `${this.objectNumber}${WHITE_SPACE}${GENERATION_NUMBER}${WHITE_SPACE}obj${NEW_LINE}<<${NEW_LINE}`
		for (const [key, val] of this.objectDictionary) {
			head += `/${key}${WHITE_SPACE}${val}`
		}
		head += `${NEW_LINE}>>${NEW_LINE}stream${NEW_LINE}`

		console.log(head)
		return textEncoder.encode(head)
	}

	public encodeObjectTail(textEncoder: TextEncoder): Uint8Array {
		return textEncoder.encode(`${NEW_LINE}endstream${NEW_LINE}endobj${NEW_LINE}`)
	}
}
