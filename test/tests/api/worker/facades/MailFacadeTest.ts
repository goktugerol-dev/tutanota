import o from "@tutao/otest"
import { MailFacade, phishingMarkerValue, validateMimeTypesForAttachments } from "../../../../../src/api/worker/facades/lazy/MailFacade.js"
import { createMail, createMailAddress, createReportedMailFieldMarker } from "../../../../../src/api/entities/tutanota/TypeRefs.js"
import { MailAuthenticationStatus, ReportedMailFieldType } from "../../../../../src/api/common/TutanotaConstants.js"
import { object } from "testdouble"
import { CryptoFacade } from "../../../../../src/api/worker/crypto/CryptoFacade.js"
import { IServiceExecutor } from "../../../../../src/api/common/ServiceRequest.js"
import { EntityClient } from "../../../../../src/api/common/EntityClient.js"
import { BlobFacade } from "../../../../../src/api/worker/facades/lazy/BlobFacade.js"
import { UserFacade } from "../../../../../src/api/worker/facades/UserFacade"
import { NativeFileApp } from "../../../../../src/native/common/FileApp.js"
import { LoginFacade } from "../../../../../src/api/worker/facades/LoginFacade.js"
import { DataFile } from "../../../../../src/api/common/DataFile.js"
import { downcast } from "@tutao/tutanota-utils"
import { ProgrammingError } from "../../../../../src/api/common/error/ProgrammingError.js"

o.spec("MailFacade test", function () {
	let facade: MailFacade
	let userFacade: UserFacade
	let cryptoFacade: CryptoFacade
	let serviceExecutor: IServiceExecutor
	let entity: EntityClient
	let blobFacade: BlobFacade
	let fileApp: NativeFileApp
	let loginFacade: LoginFacade

	o.beforeEach(function () {
		userFacade = object()
		blobFacade = object()
		entity = object()
		cryptoFacade = object()
		serviceExecutor = object()
		fileApp = object()
		loginFacade = object()
		facade = new MailFacade(userFacade, entity, cryptoFacade, serviceExecutor, blobFacade, fileApp, loginFacade)
	})

	o.spec("checkMailForPhishing", function () {
		o("not phishing if no markers", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(false)
		})

		o("not phishing if no matching markers", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test 2"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.FROM_DOMAIN, "example2.com"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(false)
		})

		o("not phishing if only from domain matches", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test 2"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.FROM_DOMAIN, "example.com"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(false)
		})

		o("not phishing if only subject matches", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.FROM_DOMAIN, "example2.com"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(false)
		})

		o("is phishing if subject and sender domain matches", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.FROM_DOMAIN, "example.com"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(true)
		})

		o("is phishing if subject with whitespaces and sender domain matches", async function () {
			const mail = createMail({
				subject: "\tTest spaces \n",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Testspaces"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.FROM_DOMAIN, "example.com"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(true)
		})

		o("is not phishing if subject and sender domain matches but not authenticated", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.SOFT_FAIL,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.FROM_DOMAIN, "example.com"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(false)
		})

		o("is phishing if subject and sender address matches", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.FROM_ADDRESS, "test@example.com"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(true)
		})

		o("is not phishing if subject and sender address matches but not authenticated", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.SOFT_FAIL,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.FROM_ADDRESS, "test@example.com"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(false)
		})

		o("is phishing if subject and non auth sender domain matches", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.SOFT_FAIL,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.FROM_DOMAIN_NON_AUTH, "example.com"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(true)
		})

		o("is phishing if subject and non auth sender address matches", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.SOFT_FAIL,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.FROM_ADDRESS_NON_AUTH, "test@example.com"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(true)
		})

		o("is phishing if subject and link matches", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.LINK, "https://example.com"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(true)
		})

		o("is not phishing if just two links match", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.LINK, "https://example.com"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.LINK, "https://example2.com"),
				}),
			])

			o(
				await facade.checkMailForPhishing(mail, [
					{ href: "https://example.com", innerHTML: "link1" },
					{ href: "https://example2.com", innerHTML: "link2" },
				]),
			).equals(false)
		})

		o("is phishing if subject and link domain matches", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.LINK_DOMAIN, "example.com"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "link" }])).equals(true)
		})

		o("does not throw on invalid link", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test"),
				}),
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.LINK_DOMAIN, "example.com"),
				}),
			])

			o(
				await facade.checkMailForPhishing(mail, [
					{ href: "/example1", innerHTML: "link1" },
					{ href: "example2", innerHTML: "link2" },
					{ href: "http:/", innerHTML: "link3" },
				]),
			).equals(false)
		})

		o("is phishing if subject and suspicious link", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "https://evil-domain.com" }])).equals(true)
		})

		o("link is not suspicious if on the same domain", async function () {
			const mail = createMail({
				subject: "Test",
				authStatus: MailAuthenticationStatus.AUTHENTICATED,
				sender: createMailAddress({
					name: "a",
					address: "test@example.com",
				}),
			})
			facade.phishingMarkersUpdateReceived([
				createReportedMailFieldMarker({
					marker: phishingMarkerValue(ReportedMailFieldType.SUBJECT, "Test"),
				}),
			])

			o(await facade.checkMailForPhishing(mail, [{ href: "https://example.com", innerHTML: "https://example.com/test" }])).equals(false)
		})
	})

	o.spec("verifyMimeTypesForAttachments", () => {
		function attach(mimeType, name): DataFile {
			return downcast({
				mimeType,
				name,
				_type: "DataFile",
			})
		}

		o("valid mimetypes", () => {
			validateMimeTypesForAttachments([attach("application/json", "something.json")])
			validateMimeTypesForAttachments([attach("audio/ogg; codec=opus", "something.opus")])
			validateMimeTypesForAttachments([attach('video/webm; codecs="vp8, opus"', "something.webm")])
			validateMimeTypesForAttachments([attach("something/orrather", "something.somethingorrather")])
			validateMimeTypesForAttachments([attach("thisisvalid/technically+this_is-ok_even-if-YOU-dont-like-it", "something.valid")])
			validateMimeTypesForAttachments([attach("anotherthing/youcando;ishave=multiple;parameters=in;a=mimetype", "something.technicallyvalidaswell")])
		})

		o("invalid mimetypes", () => {
			o(() => {
				validateMimeTypesForAttachments([attach("applicationjson", "something.json")])
			}).throws(ProgrammingError)
			o(() => {
				validateMimeTypesForAttachments([attach("application/json", "something.json"), attach("applicationjson", "something.json")])
			}).throws(ProgrammingError)
			o(() => {
				validateMimeTypesForAttachments([attach("applicationjson", "something.json"), attach("application/json", "something.json")])
			}).throws(ProgrammingError)
			o(() => {
				validateMimeTypesForAttachments([attach("", "bad.json")])
			}).throws(ProgrammingError)
			o(() => {
				validateMimeTypesForAttachments([attach("a/b/c", "no.json")])
			}).throws(ProgrammingError)
			o(() => {
				validateMimeTypesForAttachments([attach("a/b?c", "please stop.json")])
			}).throws(ProgrammingError)
			o(() => {
				validateMimeTypesForAttachments([attach('video/webm; codecs="vp8, opus oh no i forgot the quote; oops=mybad', "why.webm")])
			}).throws(ProgrammingError)
			o(() => {
				validateMimeTypesForAttachments([attach("video/webm; parameterwithoutavalue", "bad.webm")])
			}).throws(ProgrammingError)
		})
	})
})
