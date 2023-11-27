import { Indexer } from "../api/worker/search/Indexer.js"
import { CredentialsAndDatabaseKey } from "../misc/credentials/CredentialsProvider.js"
import { NativePushServiceApp } from "../native/main/NativePushServiceApp.js"

export interface CredentialRemovalHandler {
	onCredentialsRemoved(credentialsAndDbKey: CredentialsAndDatabaseKey): Promise<void>
}

export class NoopCredentialRemovalHandler implements CredentialRemovalHandler {
	async onCredentialsRemoved(credentialsAndDbKey: CredentialsAndDatabaseKey): Promise<void> {}
}

export class AppsCredentialRemovalHandler implements CredentialRemovalHandler {
	constructor(private readonly indexer: Indexer, private readonly pushApp: NativePushServiceApp) {}

	async onCredentialsRemoved(credentialsAndDbKey: CredentialsAndDatabaseKey) {
		if (credentialsAndDbKey.databaseKey != null) {
			await this.indexer.deleteIndex(credentialsAndDbKey.credentials.userId)
			await this.pushApp.invalidateAlarmsForUser(credentialsAndDbKey.credentials.userId)
			await this.pushApp.removeUserFromNotifications(credentialsAndDbKey.credentials.userId)

			this.pushApp.getPushIdentifier()
		}
	}
}
