import JSZip from "jszip"
import { readFile } from "node:fs/promises"

const FILENAME = "export.zip"

processFile(FILENAME)

async function processFile(filePath: string) {
	const zipData = await readFile(filePath)
	const zippedData = await JSZip.loadAsync(zipData)

	const byClass = new Map<string, { count: number; messages: Set<string> }>()

	for (const file of Object.values(zippedData.files)) {
		console.log(file.name)
		const emlContent = await file.async("text")
		const emlParts = emlContent.split("--------------79Bu5A16qPEYcVIZL@tutanota")
		// console.log(emlContent)
		const htmlPart = emlParts[1]
		// console.log("html part", htmlPart)
		const [_, base64] = htmlPart.split("\r\n\r\n")
		// console.log(base64)
		const html = Buffer.from(base64, "base64").toString("utf-8")
		const htmlLines = html.split("<br>")
		const errorMessageIndex = htmlLines.findIndex((line) => line.startsWith(" Error message:"))
		const errorClass = htmlLines[errorMessageIndex - 1].trim()
		const errorMessage = htmlLines[errorMessageIndex].substring(" Error message:".length).trim()
		// console.log("Error class:", errorClass, "Error message:", errorMessage)
		let entry = byClass.get(errorClass)
		if (!entry) {
			entry = { count: 0, messages: new Set<string>() }
			byClass.set(errorClass, entry)
		}
		entry.count++
		entry.messages.add(errorMessage)
	}

	for (const [errorClass, errorEntry] of byClass.entries()) {
		console.log(errorClass, errorEntry.count)
	}
}
