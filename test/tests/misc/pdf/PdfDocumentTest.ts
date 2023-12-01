import o from "@tutao/otest"
import { PdfDocument } from "../../../../src/misc/pdf/PdfDocument.js"

o.spec("PdfDocument", function () {
	o.beforeEach(function () {})

	o("test", function () {
		const document = new PdfDocument()

		document.changeFont(1, 12)
		document.placeText("Hello World", 0, 0)

		document.placeLine(0, 0, 100, 100)

		document.create()
	})
})
