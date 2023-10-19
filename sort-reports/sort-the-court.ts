import JSZip from "jszip"
import { readFile } from "node:fs/promises"

const FILENAME = "export.zip"

processFile(FILENAME)

async function processFile(filePath: string) {
	const zipData = await readFile(filePath)
	const zippedData = await JSZip.loadAsync(zipData)
	for (const file of Object.values(zippedData.files)) {
		console.log(file.name)
		const emlContent = await file.async("text")
		const emlParts = emlContent.split("--------------79Bu5A16qPEYcVIZL@tutanota")
		console.log(emlContent)
		const htmlPart = emlParts[2]
		// console.log("html part", htmlPart)
		const [_, base64] = htmlPart.split("\r\n\r\n")
		// console.log(base64)
		console.log(Buffer.from(base64, "base64").toString("utf-8"))
	}
}
