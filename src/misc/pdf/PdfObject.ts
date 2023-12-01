import { NEW_LINE, PdfDictValue, WHITE_SPACE } from "./PdfConstants.js"

export const GENERATION_NUMBER = "0"

/**
 * Class representing objects in PDF.
 * Holds data in form of an associative array which mirror the actual PDF object's "object dictionary"
 */
export class PdfObject {
	protected readonly objectNumber: number
	protected bytePosition: number = -1
	protected objectDictionary: Map<string, PdfDictValue> = new Map<string, PdfDictValue>()

	constructor(objectNumber: number, objectDictionary: Map<string, PdfDictValue>) {
		this.objectNumber = objectNumber
		this.objectDictionary = objectDictionary
	}

	public setDictionary(map: Map<string, string>) {
		this.objectDictionary = map
	}

	public getDictionary(): Map<string, PdfDictValue> {
		return this.objectDictionary
	}

	public getObjectNumber() {
		return this.objectNumber
	}

	public getBytePosition(): number {
		return this.bytePosition
	}

	public setBytePosition(bytePosition: number) {
		this.bytePosition = bytePosition
	}

	/**
	 * Encode the object into a Uint8Array to enable writing it into a buffer / file
	 * @param textEncoder
	 */
	public encodeToUInt8Array(textEncoder: TextEncoder): Uint8Array {
		return new Uint8Array([...this.encodeObjectHead(textEncoder), ...this.encodeObjectTail(textEncoder)])
	}

	/**
	 * Convert the object's head data into PDF syntax and encode it into Uint8Array
	 * @param textEncoder
	 */
	public encodeObjectHead(textEncoder: TextEncoder): Uint8Array {
		let head = `${this.objectNumber}${WHITE_SPACE}${GENERATION_NUMBER}${WHITE_SPACE}obj${NEW_LINE}<<${NEW_LINE}`
		for (const [key, val] of this.objectDictionary) {
			// TODO: error message
			if (typeof val !== "string")
				throw new Error(`Unresolved reference object: ${val.toString()}. Cannot encode an object that has unresolved references, aborting...`)
			head += `/${key}${WHITE_SPACE}${val}`
		}
		head += `${NEW_LINE}>>${NEW_LINE}`
		return textEncoder.encode(head)
	}

	/**
	 * Convert the object's tail data into PDF syntax and encode it into Uint8Array
	 * @param textEncoder
	 */
	public encodeObjectTail(textEncoder: TextEncoder): Uint8Array {
		return textEncoder.encode(`endobj${NEW_LINE}`)
	}
}
