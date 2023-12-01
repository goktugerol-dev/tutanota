import { hexToUint8Array } from "@tutao/tutanota-utils"

// Binary header specifying the PDF version (1.4 = "312e34") and the fact that binary data is present in the file
export const PDF_HEADER = hexToUint8Array("255044462d312e340a25e2e3cfd30a")
// Special PDF object with number 0. Only appears in xref table
export const ZERO_OBJECT_ENTRY = "0000000000 65535 f"

export enum PdfStreamEncoding {
	FLATE = "/FlateDecode",
	DCT = "/DCTDecode",
}

export interface PdfObjectRef {
	refId: string
}

export type PdfDictValue = string | PdfObjectRef | PdfDictValue[] | Map<string, PdfDictValue>

export const NEW_LINE = "\n"
export const WHITE_SPACE = " "

export const PDF_META_OBJECTS = Object.freeze([
	{
		// Catalog object. Acts as starting object / entry point
		refId: "CATALOG",
		dictionary: new Map<string, PdfDictValue>([
			["Type", "/Catalog"],
			["Pages", { refId: "PAGES" }],
			["PageLayout", "/SinglePage"],
			// ["Metadata", { refId: "METADATA" }],
			["MarkInfo", "<< /Marked true >>"],
			["OutputIntents", [{ refId: "OUTPUT_INTENT" }]],
			["StructTreeRoot", { refId: "STRUCT_TREE_ROOT" }],
		]),
	},
	{
		// Pages object. Root of the page tree, points to all pages in the document
		refId: "PAGES",
		dictionary: new Map<string, PdfDictValue>([
			["Type", "/Pages"],
			["Parent", { refId: "CATALOG" }],
			["Kids", []],
			["Count", ""],
		]),
	},
	{
		// Object specifying how the PDF should be rendered. Required for PDF/A
		refId: "OUTPUT_INTENT",
		dictionary: new Map<string, PdfDictValue>([
			["Type", "/OutputIntent"],
			["S", "/GTS_PDFA1"],
			["OutputConditionIdentifier", "(sRGB)"],
			["Info", "(sRGB)"],
			//		["DestOutputProfile", { refId: "DEST_OUTPUT_PROFILE" }],
		]),
	},
	{
		// Object specifying the structure of the PDF for accessibility. Required for PDF/A
		refId: "STRUCT_TREE_ROOT",
		dictionary: new Map<string, PdfDictValue>([
			["Type", "/StructTreeRoot"],
			["K", "[ null ]"],
		]),
	},

	// TODO: Not so meta now
	{
		// Resources object. Keeps references to all used resources, i.e. fonts and images.
		refId: "RESOURCES",
		dictionary: new Map<string, PdfDictValue>([
			["ProcSet", "[/PDF/Text]"],
			["XObject", "<< /Im1 11 0 R >>"],
			[
				"Font",
				new Map<string, PdfObjectRef>([
					["F1", { refId: "FONT_REGULAR" }],
					//	["F2", { refId: "FONT_BOLD" }],
				]),
			],
		]),
	},
	{
		// Regular font
		refId: "FONT_REGULAR",
		dictionary: new Map<string, PdfDictValue>([
			["Type", "/Font"],
			["Subtype", "/TrueType"],
			["FontDescriptor", { refId: "FONT_REGULAR_DESCRIPTOR" }],
			["Name", "/F1"],
			["BaseFont", "/SourceSans3-Regular"],
			["Encoding", "/WinAnsiEncoding"],
			["FirstChar", "32"],
			["LastChar", "125"],
			[
				"Widths",
				"[ 200 289 426 497 497 824 609 249 303 303 418 497 249 311 249 350 497 497 497 497 497 497 497 497 497 497 249 249 497 497 497 425 847 544 588 571 615 527 494 617 652 263 480 579 486 727 647 664 566 664 569 534 536 645 515 786 513 476 539 303 350 303 497 500 542 504 553 456 555 496 292 504 544 246 247 495 255 829 547 542 555 555 347 419 338 544 467 719 446 467 425 303 241 303 ]",
			],
		]),
	},
	{
		refId: "FONT_REGULAR_DESCRIPTOR",
		dictionary: new Map<string, PdfDictValue>([
			["Type", "/FontDescriptor"],
			["FontName", "/SourceSans3-Regular"],
			["FontFile3", { refId: "FONT_REGULAR_FILE" }],
			["Subtype", "/TrueType"],
			["Flags", "64"],
		]),
	},
	// TODO: Refular file here

	{
		// Bold font
		refId: "FONT_BOLD",
		dictionary: new Map<string, PdfDictValue>([
			["Type", "/Font"],
			["Subtype", "/TrueType"],
			["FontDescriptor", "15 0 R"],
			["Name", "/F2"],
			["BaseFont", "/SourceSans3-Bold"],
			["Encoding", "/WinAnsiEncoding"],
			["FirstChar", "32"],
			["LastChar", "125"],
			[
				"Widths",
				"[ 200 340 537 528 528 857 667 300 344 344 457 528 300 332 300 339 528 528 528 528 528 528 528 528 528 528 300 300 528 528 528 463 902 573 605 582 635 548 524 638 674 301 509 614 518 762 665 684 596 684 613 556 556 665 556 813 567 525 541 344 339 344 528 500 555 527 573 467 573 518 341 534 571 276 278 548 286 857 572 555 573 573 398 443 383 568 523 776 514 521 460 344 268 344 ]",
			],
		]),
	},
	{
		refId: "FONT_BOLD_DESCRIPTOR",
		dictionary: new Map<string, PdfDictValue>([
			["Type", "/FontDescriptor"],
			["FontName", "/SourceSans3-Bold"],
			//	["FontFile3", { refId: "FONT_BOLD_FILE" }],
			["Subtype", "/TrueType"],
			["Flags", "64"],
		]),
	},

	// TODO Bold file here
])
