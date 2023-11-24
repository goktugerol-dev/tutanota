import { User } from "../../api/entities/sys/TypeRefs.js"
import { Dialog } from "../../gui/base/Dialog.js"
import { locator } from "../../api/main/MainLocator.js"
import { showProgressDialog } from "../../gui/dialogs/ProgressDialog.js"
import { lang } from "../../misc/LanguageViewModel.js"
import m from "mithril"
import { NotAuthenticatedError } from "../../api/common/error/RestError.js"
import { PasswordForm, PasswordModel } from "../PasswordForm.js"
import { ofClass } from "@tutao/tutanota-utils"
import { asKdfType } from "../../api/common/TutanotaConstants.js"
import { CancelledError } from "../../api/common/error/CancelledError.js"
import { CredentialAuthenticationError } from "../../api/common/error/CredentialAuthenticationError.js"

/**
 *The admin does not have to enter the old password in addition to the new password (twice). The password strength is not enforced.
 */
export async function showChangeUserPasswordAsAdminDialog(user: User) {
	const model = new PasswordModel(locator.usageTestController, locator.logins, { checkOldPassword: false, enforceStrength: false, hideConfirmation: true })

	const changeUserPasswordAsAdminOkAction = async (dialog: Dialog) => {
		const kdfType = await locator.kdfPicker.pickKdfType(asKdfType(user.kdfVersion))
		showProgressDialog("pleaseWait_msg", locator.userManagementFacade.changeUserPassword(user, model.getNewPassword(), kdfType)).then(
			() => {
				Dialog.message("pwChangeValid_msg")
				dialog.close()
			},
			(e) => {
				console.error(e)
				Dialog.message("passwordResetFailed_msg")
			},
		)
	}

	Dialog.showActionDialog({
		title: lang.get("changePassword_label"),
		child: () => m(PasswordForm, { model }),
		validator: () => model.getErrorMessageId(),
		okAction: changeUserPasswordAsAdminOkAction,
	})
}

async function storeNewPassword(encryptedPassword: string) {
	try {
		const storedCredentials = await locator.credentialsProvider.getCredentialsByUserId(locator.logins.getUserController().userId)
		if (storedCredentials != null) {
			storedCredentials.credentials.encryptedPassword = encryptedPassword
			await locator.credentialsProvider.store(storedCredentials)
		}
	} catch (e) {
		if (e instanceof CancelledError || e instanceof CredentialAuthenticationError) {
			// FIXME
			const retry = await Dialog.confirm(() => "Could not store new password, try again?")
			if (retry) storeNewPassword(encryptedPassword)
		}
	}
}

/**
 * The user must enter the old password in addition to the new password (twice). The password strength is enforced.
 */
export async function showChangeOwnPasswordDialog(allowCancel: boolean = true) {
	const model = new PasswordModel(locator.usageTestController, locator.logins, { checkOldPassword: true, enforceStrength: true })

	const changeOwnPasswordOkAction = async (dialog: Dialog) => {
		const error = model.getErrorMessageId()

		if (error) {
			Dialog.message(error)
		} else {
			const currentKdfType = asKdfType(locator.logins.getUserController().user.kdfVersion)
			const newKdfType = await locator.kdfPicker.pickKdfType(currentKdfType)
			showProgressDialog("pleaseWait_msg", locator.loginFacade.changePassword(model.getOldPassword(), model.getNewPassword(), currentKdfType, newKdfType))
				.then(async ({ encryptedPassword }) => {
					storeNewPassword(encryptedPassword)

					Dialog.message("pwChangeValid_msg")
					dialog.close()
				})
				.catch(
					ofClass(NotAuthenticatedError, (e) => {
						Dialog.message("oldPasswordInvalid_msg")
					}),
				)
				.catch((e) => {
					Dialog.message("passwordResetFailed_msg")
				})
		}
	}

	Dialog.showActionDialog({
		title: lang.get("changePassword_label"),
		child: () => m(PasswordForm, { model }),
		validator: () => model.getErrorMessageId(),
		okAction: changeOwnPasswordOkAction,
		allowCancel: allowCancel,
	})
}
