import { Indexer } from "../api/worker/search/Indexer.js"
import { CredentialsAndDatabaseKey } from "../misc/credentials/CredentialsProvider.js"
import { NativePushServiceApp } from "../native/main/NativePushServiceApp.js"
import { NativePushFacade } from "../native/common/generatedipc/NativePushFacade.js"

export class CredentialRemovalHandler {
	constructor(private readonly indexer: Indexer, private readonly pushApp: NativePushServiceApp) {}

	async onCredentialsRemoved(credentialsAndDbKey: CredentialsAndDatabaseKey) {
		if (credentialsAndDbKey.databaseKey != null) {
			await this.indexer.deleteIndex(credentialsAndDbKey.credentials.userId)
			await this.pushApp.invalidateAlarmsForUser(credentialsAndDbKey.credentials.userId)
			await this.pushApp.removeUserFromNotifications(credentialsAndDbKey.credentials.userId)
		}
	}
}
