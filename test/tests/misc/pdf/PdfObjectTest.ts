import o from "@tutao/otest"
import { PdfObject } from "../../../../src/misc/pdf/PdfObject.js"
import { PdfDictValue, PdfStreamEncoding } from "../../../../src/misc/pdf/PdfConstants.js"
import { PdfStreamObject } from "../../../../src/misc/pdf/PdfStreamObject.js"

o.spec("PdfObject", function () {
	let encoder: TextEncoder

	const emptyObject = new PdfObject(3, new Map<string, PdfDictValue>())
	const someObject = new PdfObject(
		92,
		new Map<string, PdfDictValue>([
			["Key1", "Val1"],
			["Key2", "[ meow ]"],
		]),
	)
	const forbiddenObject = new PdfObject(
		2,
		new Map<string, PdfDictValue>([
			["Key1", "Val1"],
			["Key2", { refId: "UNRESOLVED" }],
		]),
	)
	const streamObject = new PdfStreamObject(
		45,
		new Map<string, PdfDictValue>([
			["Kiwi", "Valorant"],
			["Banana", "Apple"],
		]),
		new Uint8Array([34, 32, 30]),
		PdfStreamEncoding.DCT,
	)

	o.beforeEach(function () {
		encoder = new TextEncoder()
	})

	o("Encoding object head returns proper array", function () {
		o(emptyObject.encodeObjectHead(encoder)).deepEquals(encoder.encode("3 0 obj\n<<\n\n>>\n"))
		o(someObject.encodeObjectHead(encoder)).deepEquals(encoder.encode("92 0 obj\n<<\n/Key1 Val1/Key2 [ meow ]\n>>\n"))
		o(streamObject.encodeObjectHead(encoder)).deepEquals(
			encoder.encode("45 0 obj\n<<\n/Kiwi Valorant/Banana Apple/Filter /DCTDecode/Length 3\n>>\nstream\n"),
		)
		o(() => forbiddenObject.encodeObjectHead(encoder)).throws(Error)
	})

	o("Encoding object tail returns proper array", function () {
		o(emptyObject.encodeObjectTail(encoder)).deepEquals(encoder.encode("endobj\n"))
		o(someObject.encodeObjectTail(encoder)).deepEquals(encoder.encode("endobj\n"))
		o(streamObject.encodeObjectTail(encoder)).deepEquals(encoder.encode("\nendstream\nendobj\n"))
	})
})
