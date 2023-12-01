import { GENERATION_NUMBER, PdfObject } from "./PdfObject.js"
import { NEW_LINE, PDF_HEADER, PDF_META_OBJECTS, PdfDictValue, PdfObjectRef, PdfStreamEncoding, WHITE_SPACE, ZERO_OBJECT_ENTRY } from "./PdfConstants.js"

import fs from "node:fs"
import { PdfStreamObject } from "./PdfStreamObject.js"
import pako from "pako"

export class PdfWriter {
	private readonly textEncoder: TextEncoder

	private byteLengthPosition = PDF_HEADER.byteLength
	private pdfObjectList: PdfObject[] = []
	private referenceTable: Map<string, PdfObject> = new Map<string, PdfObject>()

	constructor(textEncoder: TextEncoder) {
		this.textEncoder = textEncoder
	}

	/**
	 * Add all PDF boilerplate objects to this writer
	 */
	setupDefaultObjects() {
		for (const object of PDF_META_OBJECTS) {
			this.createObject(object.dictionary, object.refId)
		}
	}

	/**
	 * Create a new PDF object
	 * @param objectDictionary Map of the object dictionary
	 * @param refId ID by which other objects can reference this object
	 */
	createObject(objectDictionary: Map<string, PdfDictValue>, refId: string = ""): void {
		const obj = new PdfObject(this.pdfObjectList.length + 1, objectDictionary)
		if (refId.length > 0) {
			this.referenceTable.set(refId, obj)
		}
		this.pdfObjectList.push(obj)
	}

	/**
	 * Create a new PDF object with stream data
	 * @param objectDictionary Map of the object dictionary. Must not provide stream-specific data
	 * @param stream The stream of the object
	 * @param streamEncoding The encoding of the stream
	 * @param refId ID by which other objects can reference this object
	 */
	createStreamObject(objectDictionary: Map<string, PdfDictValue>, stream: Uint8Array, streamEncoding: PdfStreamEncoding, refId: string = ""): void {
		const obj = new PdfStreamObject(this.pdfObjectList.length + 1, objectDictionary, stream, streamEncoding)
		if (refId.length > 0) {
			this.referenceTable.set(refId, obj)
		}
		console.log(this.referenceTable)
		this.pdfObjectList.push(obj)
	}

	/**
	 * Get a PDF object added to this writer by its ID
	 * @param refId The id of the desired object
	 */
	getObjectByRefId(refId: string): PdfObject {
		const obj = this.referenceTable.get(refId)
		if (obj != null) {
			return obj
		} else {
			throw new Error(`Invalid ReferenceId: ${refId}. No object was found that has this refId. Reference can't be resolved, aborting...`)
		}
	}

	/**
	 * Write  the cross-reference table of the PDF which is a special object lookup table for PDF readers
	 */
	makeXRefTable() {
		let xref = `xref${NEW_LINE}0${WHITE_SPACE}${this.pdfObjectList.length + 1}${NEW_LINE}${ZERO_OBJECT_ENTRY}${WHITE_SPACE}${NEW_LINE}`
		for (const pdfObject of this.pdfObjectList) {
			if (pdfObject.getBytePosition() === -1) console.warn(`Found an object with invalid byte-position! ${pdfObject.getObjectNumber()}`)
			// Replace the "0000000000" value with the byte-position but keep all leading zeros
			xref += `${("0000000000" + pdfObject.getBytePosition()).slice(-10)} 00000 n ${NEW_LINE}`
		}
		return xref
	}

	/**
	 * Write the trailer of the PDF which is a special object pointing at the "Catalog object" and additional metadata
	 */
	makeTrailer() {
		let trailer = `trailer${NEW_LINE}<<${NEW_LINE}`
		trailer += `/Size${WHITE_SPACE}${this.pdfObjectList.length + 1}`
		trailer += `/Root${WHITE_SPACE}${this.pdfReferenceToString({ refId: "CATALOG" })}`
		trailer += `/ID${WHITE_SPACE}[(${Date.now()})(${Date.now()})]`
		trailer += `${NEW_LINE}startxref${NEW_LINE}${this.byteLengthPosition}${NEW_LINE}%%EOF`
		return trailer
	}

	/**
	 * Resolve all references to other objects in a PDF dictionary.
	 * This replaces every refId with the string "objNumber 0 R" which is PDF syntax for referencing other objects
	 * Returns the PDF dictionary as Map of <string, string> allowing it to be encoded
	 * @param objDictionary The dictionary t
	 */
	resolveReferences(objDictionary: Map<string, PdfDictValue>): Map<string, string> {
		const newMap = new Map<string, string>()
		for (const [key, value] of objDictionary) {
			newMap.set(key, this.resolveDictValue(value))
		}
		return newMap
	}

	/**
	 * Resolve a PdfDictValue into its string equivalent
	 * @param value Value to resolve
	 */
	resolveDictValue(value: PdfDictValue): string {
		if (typeof value !== "string") {
			if (value instanceof Map) {
				// Value is a nested directory, recursively resolve all references in the nested directory and convert to string
				return this.pdfDictionaryToString(value)
			} else if (Array.isArray(value)) {
				// Value is a list, iterate over all elements, resolve them if necessary and convert to string
				return this.pdfListToString(value)
			} else {
				// Value is a singular reference, resolve it into a string
				return this.pdfReferenceToString(value)
			}
		} else {
			// Value is a string, keep it
			return value
		}
	}

	pdfReferenceToString(objectReference: PdfObjectRef): string {
		const referencedObject = this.getObjectByRefId(objectReference.refId)
		return `${referencedObject.getObjectNumber()}${WHITE_SPACE}${GENERATION_NUMBER}${WHITE_SPACE}R`
	}

	pdfListToString(objectReferences: PdfDictValue[]): string {
		let referenceString = "[" + WHITE_SPACE
		for (const objRef of objectReferences) {
			referenceString += this.resolveDictValue(objRef) + WHITE_SPACE
		}
		referenceString += "]"
		return referenceString
	}

	pdfDictionaryToString(objectReferenceDict: Map<string, PdfDictValue>): string {
		let referenceString = "<<" + WHITE_SPACE
		for (const [key, value] of objectReferenceDict) {
			referenceString += `/${key}${WHITE_SPACE}${this.resolveDictValue(value)}${WHITE_SPACE}`
		}
		referenceString += ">>"
		return referenceString
	}

	/**
	 * Calculate the byte-position for a given object
	 * @param object The object that should have its byte-position should be calculated
	 * @param encodedObject The provided object in encoded format to allow calculation for the next object
	 */
	private calculateBytePositions(object: PdfObject, encodedObject: Uint8Array) {
		object.setBytePosition(this.byteLengthPosition)
		this.byteLengthPosition += encodedObject.byteLength
	}

	writePdf() {
		const fontRegular = fs.readFileSync("/home/jop/dev/repositories/pdf-test/SourceSans3-Regular.ttf")

		this.createStreamObject(
			new Map([["Length1", fontRegular.byteLength.toString()]]),
			pako.deflate(fontRegular),
			PdfStreamEncoding.FLATE,
			"FONT_REGULAR_FILE",
		)

		const encodedObjects = this.pdfObjectList.map((obj) => {
			obj.setDictionary(this.resolveReferences(obj.getDictionary()))

			const encodedObject = obj.encodeToUInt8Array(this.textEncoder)
			this.calculateBytePositions(obj, encodedObject)
			return encodedObject
		})
		// const blob = new Blob(encodedObjects, { type: "application/pdf" })
		//
		// var url = URL.createObjectURL(blob)
		// const previewEl: HTMLElement | null = document.getElementById("preview")
		//
		// if (previewEl != null) {
		// 	const a = previewEl as HTMLObjectElement
		// 	a.data = url
		// }

		fs.writeFileSync("/tmp/testt.pdf", PDF_HEADER, { flag: "a" })

		for (const pdfObj of encodedObjects) {
			fs.writeFileSync("/tmp/testt.pdf", pdfObj, { flag: "a" })
		}
		fs.writeFileSync("/tmp/testt.pdf", this.makeXRefTable(), { flag: "a" })
		fs.writeFileSync("/tmp/testt.pdf", this.makeTrailer(), { flag: "a" })
	}
}
