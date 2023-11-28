import { Indexer } from "../api/worker/search/Indexer.js"

export class CredentialRemovalHandler {
	constructor(private readonly indexer: Indexer) {}

	async onCredentialsRemoved(userId: Id) {
		// FIXME only do it for persistent credentials
		await this.indexer.deleteIndex(userId)
	}
}
