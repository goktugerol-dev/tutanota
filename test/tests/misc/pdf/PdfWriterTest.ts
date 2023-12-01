import o from "@tutao/otest"
import { PdfWriter } from "../../../../src/misc/pdf/PdfWriter.js"
import { PDF_META_OBJECTS, PdfDictValue } from "../../../../src/misc/pdf/PdfConstants.js"
import { mapToObject } from "@tutao/tutanota-test-utils"

o.spec("PdfWriter", function () {
	o.beforeEach(function () {})

	o("Parse object reference to reference string", function () {
		const writer = new PdfWriter(new TextEncoder())
		writer.createObject(PDF_META_OBJECTS[0].dictionary, PDF_META_OBJECTS[0].refId)
		writer.createObject(new Map(), "PAGES")
		writer.createObject(new Map(), "PAGE1")

		o(writer.pdfReferenceToString({ refId: "CATALOG" })).equals("1 0 R")
		o(writer.pdfReferenceToString({ refId: "PAGES" })).equals("2 0 R")
		o(writer.pdfReferenceToString({ refId: "PAGE1" })).equals("3 0 R")
		o(writer.pdfListToString([{ refId: "PAGE1" }, { refId: "CATALOG" }])).equals("[ 3 0 R 1 0 R ]")
		o(writer.pdfListToString([{ refId: "CATALOG" }, { refId: "PAGES" }])).equals("[ 1 0 R 2 0 R ]")
	})

	o("Resolve deeply nested object references correctly", function () {
		const writer = new PdfWriter(new TextEncoder())
		writer.createObject(new Map(), "ListRef")
		writer.createObject(new Map(), "RefVal")
		writer.createObject(new Map(), "NestedRefVal")
		writer.createObject(new Map(), "DeviousRefVal")

		const nestedMap = new Map<string, PdfDictValue>([
			["Foo", "Bar"],
			["List", ["One", "Two", { refId: "ListRef" }]],
			["Ref", { refId: "RefVal" }],
			[
				"Map",
				new Map<string, PdfDictValue>([
					["NestedFoo", "NestedBar"],
					["NestedRef", { refId: "NestedRefVal" }],
				]),
			],
			["SuperEvilListWithANestedDictionary", [new Map<string, PdfDictValue>([["DeviousRef", { refId: "DeviousRefVal" }]])]],
		])

		o(mapToObject(writer.resolveReferences(nestedMap))).deepEquals(
			mapToObject(
				new Map<string, string>([
					["Foo", "Bar"],
					["List", "[ One Two 1 0 R ]"],
					["Ref", "2 0 R"],
					["Map", "<< /NestedFoo NestedBar /NestedRef 3 0 R >>"],
					["SuperEvilListWithANestedDictionary", "[ << /DeviousRef 4 0 R >> ]"],
				]),
			),
		)
	})
})
