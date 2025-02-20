import type { DeferredObject, Require } from "@tutao/tutanota-utils"
import { assertNotNull, clone, defer, downcast, filterInt, getFromMap, LazyLoaded } from "@tutao/tutanota-utils"
import { CalendarMethod, FeatureType, GroupType, OperationType } from "../../api/common/TutanotaConstants"
import type { EntityUpdateData } from "../../api/main/EventController"
import { EventController, isUpdateForTypeRef } from "../../api/main/EventController"
import type { AlarmInfo, Group, GroupInfo, User, UserAlarmInfo } from "../../api/entities/sys/TypeRefs.js"
import {
	createDateWrapper,
	createMembershipRemoveData,
	GroupInfoTypeRef,
	GroupMembership,
	GroupTypeRef,
	UserAlarmInfoTypeRef,
} from "../../api/entities/sys/TypeRefs.js"
import {
	CalendarEvent,
	CalendarEventTypeRef,
	CalendarEventUpdate,
	CalendarEventUpdateTypeRef,
	CalendarGroupRoot,
	CalendarGroupRootTypeRef,
	createGroupSettings,
	FileTypeRef,
} from "../../api/entities/tutanota/TypeRefs.js"
import { isApp, isDesktop } from "../../api/common/Env"
import type { LoginController } from "../../api/main/LoginController"
import { LockedError, NotAuthorizedError, NotFoundError, PreconditionFailedError } from "../../api/common/error/RestError"
import type { ParsedCalendarData } from "../export/CalendarImporter"
import { ParserError } from "../../misc/parsing/ParserCombinator"
import { ProgressTracker } from "../../api/main/ProgressTracker"
import type { IProgressMonitor } from "../../api/common/utils/ProgressMonitor"
import { EntityClient } from "../../api/common/EntityClient"
import type { MailModel } from "../../mail/model/MailModel"
import { elementIdPart, getElementId, isSameId, listIdPart, removeTechnicalFields } from "../../api/common/utils/EntityUtils"
import type { AlarmScheduler } from "../date/AlarmScheduler"
import type { Notifications } from "../../gui/Notifications"
import m from "mithril"
import type { CalendarEventInstance, CalendarEventProgenitor, CalendarFacade } from "../../api/worker/facades/lazy/CalendarFacade.js"
import { CachingMode, CalendarEventAlteredInstance, CalendarEventUidIndexEntry } from "../../api/worker/facades/lazy/CalendarFacade.js"
import { IServiceExecutor } from "../../api/common/ServiceRequest"
import { MembershipService } from "../../api/entities/sys/Services"
import { FileController } from "../../file/FileController"
import { findAttendeeInAddresses } from "../../api/common/utils/CommonCalendarUtils.js"
import { TutanotaError } from "../../api/common/error/TutanotaError.js"
import { SessionKeyNotFoundError } from "../../api/common/error/SessionKeyNotFoundError.js"

const TAG = "[CalendarModel]"
export type CalendarInfo = {
	groupRoot: CalendarGroupRoot
	// We use LazyLoaded so that we don't get races for loading these events which is
	// 1. Good because loading them twice is not optimal
	// 2. Event identity is required by some functions (e.g. when determining week events)
	longEvents: LazyLoaded<Array<CalendarEvent>>
	groupInfo: GroupInfo
	group: Group
	shared: boolean
}

export class CalendarModel {
	/**
	 * Map from calendar event element id to the deferred object with a promise of getting CREATE event for this calendar event. We need to do that because
	 * entity updates for CalendarEvent and UserAlarmInfo come in different batches and we need to wait for the event when we want to process new alarm.
	 *
	 * We use the counter to remove the pending request from map when all alarms are processed. We want to do that in case the event gets updated and we need
	 * to wait for the new version of the event.
	 */
	private pendingAlarmRequests: Map<string, { pendingAlarmCounter: number; deferred: DeferredObject<void> }> = new Map()
	private readonly userAlarmToAlarmInfo: Map<string, string> = new Map()
	private readonly fileIdToSkippedCalendarEventUpdates: Map<Id, CalendarEventUpdate> = new Map()

	constructor(
		private readonly notifications: Notifications,
		private readonly alarmScheduler: () => Promise<AlarmScheduler>,
		eventController: EventController,
		private readonly serviceExecutor: IServiceExecutor,
		private readonly logins: LoginController,
		private readonly progressTracker: ProgressTracker,
		private readonly entityClient: EntityClient,
		private readonly mailModel: MailModel,
		private readonly calendarFacade: CalendarFacade,
		private readonly fileController: FileController,
		private readonly zone: string,
	) {
		if (isApp()) return
		eventController.addEntityListener((updates) => this.entityEventsReceived(updates))
	}

	async createEvent(event: CalendarEvent, alarmInfos: ReadonlyArray<AlarmInfo>, zone: string, groupRoot: CalendarGroupRoot): Promise<void> {
		await this.doCreate(event, zone, groupRoot, alarmInfos)
	}

	/** Update existing event when time did not change */
	async updateEvent(
		newEvent: CalendarEvent,
		newAlarms: ReadonlyArray<AlarmInfo>,
		zone: string,
		groupRoot: CalendarGroupRoot,
		existingEvent: CalendarEvent,
	): Promise<CalendarEvent> {
		if (existingEvent._id == null) {
			throw new Error("Invalid existing event for update: no id")
		}

		if (existingEvent.uid != null && newEvent.uid !== existingEvent.uid) {
			throw new Error("Invalid existing event for update: mismatched uids.")
		}

		// in cases where start time or calendar changed, we need to change the event id and so need to delete/recreate.
		// it's also possible that the event has to be moved from the long event list to the short event list or vice versa.
		if (
			existingEvent._ownerGroup !== groupRoot._id ||
			newEvent.startTime.getTime() !== existingEvent.startTime.getTime() ||
			(await didLongStateChange(newEvent, existingEvent, zone))
		) {
			// We should reload the instance here because session key and permissions are updated when we recreate event.
			await this.doCreate(newEvent, zone, groupRoot, newAlarms, existingEvent)
			return await this.entityClient.load<CalendarEvent>(CalendarEventTypeRef, newEvent._id)
		} else {
			newEvent._ownerGroup = groupRoot._id
			// We can't load updated event here because cache is not updated yet. We also shouldn't need to load it, we have the latest
			// version
			await this.calendarFacade.updateCalendarEvent(newEvent, newAlarms, existingEvent)
			return newEvent
		}
	}

	/** Load map from group/groupRoot ID to the calendar info */
	async loadCalendarInfos(progressMonitor: IProgressMonitor): Promise<ReadonlyMap<Id, CalendarInfo>> {
		const user = this.logins.getUserController().user

		const calendarMemberships = user.memberships.filter((m) => m.groupType === GroupType.Calendar)
		const notFoundMemberships: GroupMembership[] = []
		const groupInstances: Array<[CalendarGroupRoot, GroupInfo, Group]> = []
		for (const membership of calendarMemberships) {
			try {
				const result = await Promise.all([
					this.entityClient.load(CalendarGroupRootTypeRef, membership.group),
					this.entityClient.load(GroupInfoTypeRef, membership.groupInfo),
					this.entityClient.load(GroupTypeRef, membership.group),
				])
				groupInstances.push(result)
			} catch (e) {
				if (e instanceof NotFoundError) {
					notFoundMemberships.push(membership)
				} else {
					throw e
				}
			}
			progressMonitor.workDone(3)
		}

		const calendarInfos: Map<Id, CalendarInfo> = new Map()
		for (const [groupRoot, groupInfo, group] of groupInstances) {
			calendarInfos.set(groupRoot._id, {
				groupRoot,
				groupInfo,
				longEvents: new LazyLoaded(() => this.entityClient.loadAll(CalendarEventTypeRef, groupRoot.longEvents), []),
				group: group,
				shared: !isSameId(group.user, user._id),
			})
		}

		// cleanup inconsistent memberships
		for (const mship of notFoundMemberships) {
			// noinspection ES6MissingAwait
			this.serviceExecutor.delete(MembershipService, createMembershipRemoveData({ user: user._id, group: mship.group }))
		}
		return calendarInfos
	}

	async loadOrCreateCalendarInfo(progressMonitor: IProgressMonitor): Promise<ReadonlyMap<Id, CalendarInfo>> {
		const { findPrivateCalendar } = await import("../date/CalendarUtils")
		const calendarInfo = await this.loadCalendarInfos(progressMonitor)

		if (!this.logins.isInternalUserLoggedIn() || findPrivateCalendar(calendarInfo)) {
			return calendarInfo
		} else {
			await this.createCalendar("", null)
			return await this.loadCalendarInfos(progressMonitor)
		}
	}

	async createCalendar(name: string, color: string | null): Promise<void> {
		// when a calendar group is added, a group membership is added to the user. we might miss this websocket event
		// during startup if the websocket is not connected fast enough. Therefore, we explicitly update the user
		// this should be removed once we handle missed events during startup
		const { user, group } = await this.calendarFacade.addCalendar(name)
		this.logins.getUserController().user = user

		if (color != null) {
			const { userSettingsGroupRoot } = this.logins.getUserController()

			const newGroupSettings = Object.assign(createGroupSettings(), {
				group: group._id,
				color: color,
			})
			userSettingsGroupRoot.groupSettings.push(newGroupSettings)
			await this.entityClient.update(userSettingsGroupRoot)
		}
	}

	private async doCreate(
		event: CalendarEvent,
		zone: string,
		groupRoot: CalendarGroupRoot,
		alarmInfos: ReadonlyArray<AlarmInfo>,
		existingEvent?: CalendarEvent,
	): Promise<void> {
		// If the event was copied it might still carry some fields for re-encryption. We can't reuse them.
		removeTechnicalFields(event)
		const { assignEventId } = await import("../date/CalendarUtils")
		// if values of the existing events have changed that influence the alarm time then delete the old event and create a new
		// one.
		assignEventId(event, zone, groupRoot)
		// Reset ownerEncSessionKey because it cannot be set for new entity, it will be assigned by the CryptoFacade
		event._ownerEncSessionKey = null
		if (event.repeatRule != null) {
			event.repeatRule.excludedDates = event.repeatRule.excludedDates.map(({ date }) => createDateWrapper({ date }))
		}
		// Reset permissions because server will assign them
		downcast(event)._permissions = null
		event._ownerGroup = groupRoot._id
		return await this.calendarFacade.saveCalendarEvent(event, alarmInfos, existingEvent ?? null)
	}

	async deleteEvent(event: CalendarEvent): Promise<void> {
		return await this.entityClient.erase(event)
	}

	/**
	 * get the "primary" event of a series - the one that contains the repeat rule and is not a repeated or a rescheduled instance.
	 *
	 * note about recurrenceId in event series https://stackoverflow.com/questions/11456406/recurrence-id-in-icalendar-rfc-5545
	 */
	async resolveCalendarEventProgenitor({ uid }: Pick<CalendarEvent, "uid">): Promise<CalendarEvent | null> {
		return (await this.getEventsByUid(assertNotNull(uid, "could not resolve progenitor: no uid")))?.progenitor ?? null
	}

	private async loadAndProcessCalendarUpdates(): Promise<void> {
		const { mailboxGroupRoot } = await this.mailModel.getUserMailboxDetails()
		const { calendarEventUpdates } = mailboxGroupRoot
		if (calendarEventUpdates == null) return

		const invites = await this.entityClient.loadAll(CalendarEventUpdateTypeRef, calendarEventUpdates.list)
		for (const invite of invites) {
			await this.handleCalendarEventUpdate(invite)
		}
	}

	private async getCalendarDataForUpdate(fileId: IdTuple): Promise<ParsedCalendarData | null> {
		try {
			// We are not supposed to load files without the key provider, but we hope that the key
			// was already resolved and the entity updated.
			const file = await this.entityClient.load(FileTypeRef, fileId)
			const dataFile = await this.fileController.getAsDataFile(file)
			const { parseCalendarFile } = await import("../export/CalendarImporter")
			return await parseCalendarFile(dataFile)
		} catch (e) {
			if (e instanceof SessionKeyNotFoundError) {
				// owner enc session key not updated yet - see NoOwnerEncSessionKeyForCalendarEventError's comment
				throw new NoOwnerEncSessionKeyForCalendarEventError("no owner enc session key found on the calendar data's file")
			}
			if (e instanceof ParserError || e instanceof NotFoundError) {
				console.warn(TAG, "could not get calendar update data", e)
				return null
			}
			throw e
		}
	}

	private async handleCalendarEventUpdate(update: CalendarEventUpdate): Promise<void> {
		// we want to delete the CalendarEventUpdate after we are done, even, in some cases, if something went wrong.
		try {
			const parsedCalendarData = await this.getCalendarDataForUpdate(update.file)
			if (parsedCalendarData != null) {
				await this.processCalendarData(update.sender, parsedCalendarData)
			}
		} catch (e) {
			if (e instanceof NotAuthorizedError) {
				// we might be authorized in the near future if some permission is delayed, unlikely to be permanent.
				console.warn(TAG, "could not process calendar update: not authorized", e)
				return
			} else if (e instanceof PreconditionFailedError) {
				// unclear where precon would be thrown, probably in the blob store?
				console.warn(TAG, "could not process calendar update: precondition failed", e)
				return
			} else if (e instanceof LockedError) {
				// we can try again after the lock is released
				console.warn(TAG, "could not process calendar update: locked", e)
				return
			} else if (e instanceof NotFoundError) {
				// either the updated event(s) or the file data could not be found,
				// so we should try to delete since the update itself is obsolete.
				console.warn(TAG, "could not process calendar update: not found", e)
			} else if (e instanceof NoOwnerEncSessionKeyForCalendarEventError) {
				// we will get an update with the mail and sk soon, then we'll be able to finish this.
				// we will re-enter this function and erase it then.
				this.fileIdToSkippedCalendarEventUpdates.set(elementIdPart(update.file), update)
				console.warn(TAG, `could not process calendar update: ${e.message}`, e)
				return
			} else {
				// unknown error that may lead to permanently stuck update if not cleared
				// this includes CryptoErrors due to #5753 that we want to still monitor
				// but now they only occur once
				console.warn(TAG, "could not process calendar update:", e)
				await this.eraseUpdate(update)
				throw e
			}
		}

		await this.eraseUpdate(update)
	}

	/**
	 * try to delete a calendar update from the server, ignoring errors
	 * @param update the update to erase
	 * @private
	 */
	private async eraseUpdate(update: CalendarEventUpdate): Promise<void> {
		try {
			await this.entityClient.erase(update)
		} catch (e) {
			console.log(TAG, "failed to delete update:", e.name)
		}
	}

	/** whether the operation could be performed or not */
	async deleteEventsByUid(uid: string): Promise<void> {
		const entry = await this.calendarFacade.getEventsByUid(uid)
		if (entry == null) {
			console.log("could not find an uid index entry to delete event")
			return
		}
		// not doing this in parallel because we would get locked errors
		for (const e of entry.alteredInstances) {
			await this.deleteEvent(e)
		}
		if (entry.progenitor) {
			await this.deleteEvent(entry.progenitor)
		}
	}

	/** process a calendar update retrieved from the server automatically. will not apply updates to event series that do not
	 *  exist on the server yet (that's being done by calling processCalendarEventMessage manually)
	 * public for testing */
	async processCalendarData(sender: string, calendarData: ParsedCalendarData): Promise<void> {
		if (calendarData.contents.length === 0) {
			console.log(TAG, `Calendar update with no events, ignoring`)
			return
		}

		if (calendarData.contents[0].event.uid == null) {
			console.log(TAG, "invalid event update without UID, ignoring.")
			return
		}

		// we can have multiple cases here:
		// 1. calendarData has one event and it's the progenitor
		// 2. calendarData has one event and it's an altered occurrence
		// 3. it's both (thunderbird sends ical files with multiple events)

		// Load the events bypassing the cache because we might have already processed some updates and they might have changed the events we are about to load.
		// We want to operate on the latest events only, otherwise we might lose some data.
		const dbEvents = await this.calendarFacade.getEventsByUid(calendarData.contents[0].event.uid, CachingMode.Bypass)

		if (dbEvents == null) {
			// if we ever want to display event invites in the calendar before accepting them,
			// we probably need to do something else here.
			console.log(TAG, "received event update for event that has not been saved to the server, ignoring.")
			return
		}
		const method = calendarData.method
		for (const content of calendarData.contents) {
			const updateAlarms = content.alarms
			const updateEvent = content.event
			// this automatically applies REQUESTs for creating parts of the existing event series that do not exist yet
			// like accepting another altered instance invite or accepting the progenitor after accepting only an altered instance.
			await this.processCalendarEventMessage(sender, method, updateEvent, updateAlarms, dbEvents)
		}
	}

	/**
	 * Processing calendar update - bring events in calendar up-to-date with ical data sent via email.
	 * calendar data are currently processed for
	 * - REQUEST: here we have two cases:
	 *     - there is an existing event: we apply the update to that event and do the necessary changes to the other parts of the series that may already exist
	 *     - there is no existing event: create the event as received, and do the necessary changes to the other parts of the series that may already exist
	 * - REPLY: update attendee status,
	 * - CANCEL: we delete existing event instance
	 *
	 * @param sender
	 * @param method
	 * @param updateEvent the actual instance that needs to be updated
	 * @param updateAlarms
	 * @param target either the existing event to update or the calendar group Id to create the event in in case of a new event.
	 */
	async processCalendarEventMessage(
		sender: string,
		method: string,
		updateEvent: Require<"uid", CalendarEvent>,
		updateAlarms: Array<AlarmInfo>,
		target: CalendarEventUidIndexEntry,
	): Promise<void> {
		const updateEventTime = updateEvent.recurrenceId?.getTime()
		const targetDbEvent = updateEventTime == null ? target.progenitor : target.alteredInstances.find((e) => e.recurrenceId.getTime() === updateEventTime)
		if (targetDbEvent == null) {
			if (method === CalendarMethod.REQUEST) {
				// we got a REQUEST for which we do not have a saved version of the particular instance (progenitor or altered)
				// it may be
				// - a single-instance update that created this altered instance
				// - the user got the progenitor invite for a series. it's possible that there's
				//   already altered instances of this series on the server.
				return await this.processCalendarAccept(target, updateEvent, updateAlarms)
			} else if (target.progenitor?.repeatRule != null && updateEvent.recurrenceId != null && method === CalendarMethod.CANCEL) {
				// some calendaring apps send a cancellation for an altered instance with a RECURRENCE-ID when
				// users delete a single instance from a series even though that instance was never published as altered.
				// we can just add the exclusion to the progenitor. this would be another argument for marking
				// altered-instance-exclusions in some way distinct from "normal" exclusions
				target.alteredInstances.push(updateEvent as CalendarEventAlteredInstance)
				// this will now modify the progenitor to have the required exclusions
				return await this.processCalendarUpdate(target, target.progenitor, target.progenitor)
			} else {
				console.log(TAG, `got something that's not a REQUEST for nonexistent server event on uid:`, method)
				return
			}
		}

		const sentByOrganizer: boolean = targetDbEvent.organizer != null && targetDbEvent.organizer.address === sender
		if (method === CalendarMethod.REPLY) {
			return this.processCalendarReply(sender, targetDbEvent, updateEvent)
		} else if (sentByOrganizer && method === CalendarMethod.REQUEST) {
			return await this.processCalendarUpdate(target, targetDbEvent, updateEvent)
		} else if (sentByOrganizer && method === CalendarMethod.CANCEL) {
			return await this.processCalendarCancellation(targetDbEvent)
		} else {
			console.log(TAG, `${method} update sent not by organizer, ignoring.`)
		}
	}

	/** process either a request for an existing progenitor or an existing altered instance.
	 * @param dbTarget the uid entry containing the other events that are known to us that belong to this event series.
	 * @param dbEvent the version of updateEvent stored on the server. must be identical to dbTarget.progenitor or one of dbTarget.alteredInstances
	 * @param updateEvent the event that contains the new version of dbEvent. */
	private async processCalendarUpdate(dbTarget: CalendarEventUidIndexEntry, dbEvent: CalendarEventInstance, updateEvent: CalendarEvent): Promise<void> {
		console.log(TAG, "processing request for existing event instance")
		const { repeatRuleWithExcludedAlteredInstances } = await import("../date/eventeditor/CalendarEventWhenModel.js")
		// some providers do not increment the sequence for all edit operations (like google when changing the summary)
		// we'd rather apply the same update too often than miss some, and this enables us to update our own status easily
		// without having to increment the sequence.
		if (filterInt(dbEvent.sequence) > filterInt(updateEvent.sequence)) {
			console.log(TAG, "got update for outdated event version, ignoring.")
			return
		}
		if (updateEvent.recurrenceId == null && updateEvent.repeatRule != null) {
			// the update is for a repeating progenitor. we need to exclude all known altered instances from its repeat rule.
			updateEvent.repeatRule = repeatRuleWithExcludedAlteredInstances(
				updateEvent,
				dbTarget.alteredInstances.map((r) => r.recurrenceId),
				this.zone,
			)
		}
		// If the update is for the altered occurrence, we do not need to update the progenitor, it already has the exclusion.
		// If we get into this function we already have the altered occurrence in db.

		// write the progenitor back to the uid index entry so that the subsequent updates from the same file get the updated instance
		dbTarget.progenitor = (await this.updateEventWithExternal(dbEvent, updateEvent)) as CalendarEventProgenitor
	}

	/**
	 * do not call this for anything but a REQUEST
	 * @param dbTarget the progenitor that must have a repeat rule and an exclusion for this event to be accepted, the known altered instances and the ownergroup.
	 * @param updateEvent the event to create
	 * @param alarms alarms to set up for this user/event
	 */
	private async processCalendarAccept(
		dbTarget: CalendarEventUidIndexEntry,
		updateEvent: Require<"uid", CalendarEvent>,
		alarms: Array<AlarmInfo>,
	): Promise<void> {
		console.log(TAG, "processing new instance request")
		const { repeatRuleWithExcludedAlteredInstances } = await import("../date/eventeditor/CalendarEventWhenModel.js")
		if (updateEvent.recurrenceId != null && dbTarget.progenitor != null && dbTarget.progenitor.repeatRule != null) {
			// request for a new altered instance. we'll try adding the exclusion for this instance to the progenitor if possible
			// since not all calendar apps add altered instances to the list of exclusions.
			const updatedProgenitor = clone(dbTarget.progenitor)
			updatedProgenitor.repeatRule = repeatRuleWithExcludedAlteredInstances(updatedProgenitor, [updateEvent.recurrenceId], this.zone)
			dbTarget.progenitor = (await this.doUpdateEvent(dbTarget.progenitor, updatedProgenitor)) as CalendarEventProgenitor
		} else if (updateEvent.recurrenceId == null && updateEvent.repeatRule != null && dbTarget.alteredInstances.length > 0) {
			// request to add the progenitor to the calendar. we have to exclude all altered instances that are known to us from it.
			updateEvent.repeatRule = repeatRuleWithExcludedAlteredInstances(
				updateEvent,
				dbTarget.alteredInstances.map((r) => r.recurrenceId),
				this.zone,
			)
		}
		let calendarGroupRoot
		try {
			calendarGroupRoot = await this.entityClient.load(CalendarGroupRootTypeRef, dbTarget.ownerGroup)
		} catch (e) {
			if (!(e instanceof NotFoundError) && !(e instanceof NotAuthorizedError)) throw e
			console.log(TAG, "tried to create new progenitor or got new altered instance for progenitor in nonexistent/inaccessible calendar, ignoring")
			return
		}
		return await this.doCreate(updateEvent, "", calendarGroupRoot, alarms)
	}

	/** Someone replied whether they attend an event or not. this MUST be applied to all instances in our
	 * model since we keep attendee lists in sync for now. */
	private async processCalendarReply(sender: string, dbEvent: CalendarEvent, updateEvent: CalendarEvent): Promise<void> {
		console.log("processing calendar reply")
		// first check if the sender of the email is in the attendee list
		const replyAttendee = findAttendeeInAddresses(updateEvent.attendees, [sender])

		if (replyAttendee == null) {
			console.log(TAG, "Sender is not among attendees, ignoring", replyAttendee)
			return
		}

		const newEvent = clone(dbEvent)
		// check if the attendee is still in the attendee list of the latest event
		const dbAttendee = findAttendeeInAddresses(newEvent.attendees, [replyAttendee.address.address])

		if (dbAttendee == null) {
			console.log(TAG, "attendee was not found", dbEvent._id, replyAttendee)
			return
		}

		dbAttendee.status = replyAttendee.status
		await this.doUpdateEvent(dbEvent, newEvent)
	}

	/** handle an event cancellation - either the whole series (progenitor got cancelled)
	 * or the altered occurrence. */
	private async processCalendarCancellation(dbEvent: CalendarEventInstance): Promise<void> {
		console.log(TAG, "processing cancellation")
		// not having UID is technically an error, but we'll do our best (the event came from the server after all)
		if (dbEvent.recurrenceId == null && dbEvent.uid != null) {
			return await this.deleteEventsByUid(dbEvent.uid)
		} else {
			// either this has a recurrenceId and we only delete that instance
			// or we don't have a uid to get all instances.
			return await this.entityClient.erase(dbEvent)
		}
	}

	/**
	 * Update {@param dbEvent} stored on the server with {@param icsEvent} from the ics file.
	 */
	async updateEventWithExternal(dbEvent: CalendarEvent, icsEvent: CalendarEvent): Promise<CalendarEvent> {
		const newEvent = clone(dbEvent)
		newEvent.startTime = icsEvent.startTime
		newEvent.endTime = icsEvent.endTime
		newEvent.attendees = icsEvent.attendees
		newEvent.summary = icsEvent.summary
		newEvent.sequence = icsEvent.sequence
		newEvent.location = icsEvent.location
		newEvent.description = icsEvent.description
		newEvent.organizer = icsEvent.organizer
		newEvent.repeatRule = icsEvent.repeatRule
		newEvent.recurrenceId = icsEvent.recurrenceId
		return await this.doUpdateEvent(dbEvent, newEvent)
	}

	async doUpdateEvent(dbEvent: CalendarEvent, newEvent: CalendarEvent): Promise<CalendarEvent> {
		const [alarms, groupRoot] = await Promise.all([
			this.loadAlarms(dbEvent.alarmInfos, this.logins.getUserController().user),
			this.entityClient.load<CalendarGroupRoot>(CalendarGroupRootTypeRef, assertNotNull(dbEvent._ownerGroup)),
		])
		const alarmInfos = alarms.map((a) => a.alarmInfo)
		return await this.updateEvent(newEvent, alarmInfos, "", groupRoot, dbEvent)
	}

	async init(): Promise<void> {
		await this.scheduleAlarmsLocally()
		await this.loadAndProcessCalendarUpdates()
	}

	async scheduleAlarmsLocally(): Promise<void> {
		if (!this.localAlarmsEnabled()) return
		const eventsWithInfos = await this.calendarFacade.loadAlarmEvents()
		const scheduler: AlarmScheduler = await this.alarmScheduler()
		for (let { event, userAlarmInfos } of eventsWithInfos) {
			for (let userAlarmInfo of userAlarmInfos) {
				this.scheduleUserAlarmInfo(event, userAlarmInfo, scheduler)
			}
		}
	}

	async loadAlarms(alarmInfos: Array<IdTuple>, user: User): Promise<Array<UserAlarmInfo>> {
		const { alarmInfoList } = user

		if (alarmInfoList == null) {
			return []
		}

		const ids = alarmInfos.filter((alarmInfoId) => isSameId(listIdPart(alarmInfoId), alarmInfoList.alarms))

		if (ids.length === 0) {
			return []
		}

		return this.entityClient.loadMultiple(UserAlarmInfoTypeRef, listIdPart(ids[0]), ids.map(elementIdPart))
	}

	async deleteCalendar(calendar: CalendarInfo): Promise<void> {
		await this.calendarFacade.deleteCalendar(calendar.groupRoot._id)
	}

	async getEventsByUid(uid: string): Promise<CalendarEventUidIndexEntry | null> {
		return this.calendarFacade.getEventsByUid(uid)
	}

	private async entityEventsReceived(updates: ReadonlyArray<EntityUpdateData>): Promise<void> {
		// We iterate over the alarms twice: once to collect them and to set the counter correctly and the second time to actually process them.
		const alarmEventsToProcess: UserAlarmInfo[] = []
		for (const entityEventData of updates) {
			if (isUpdateForTypeRef(UserAlarmInfoTypeRef, entityEventData)) {
				if (entityEventData.operation === OperationType.CREATE) {
					// Updates for UserAlarmInfo and CalendarEvent come in a
					// separate batches and there's a race between loading of the
					// UserAlarmInfo and creation of the event.
					// We try to load UserAlarmInfo. Then we wait until the
					// CalendarEvent is there (which might already be true)
					// and load it.
					// All alarms for the same event come in the same batch so
					try {
						const userAlarmInfo = await this.entityClient.load(UserAlarmInfoTypeRef, [entityEventData.instanceListId, entityEventData.instanceId])
						alarmEventsToProcess.push(userAlarmInfo)
						const deferredEvent = this.getPendingAlarmRequest(userAlarmInfo.alarmInfo.calendarRef.elementId)
						deferredEvent.pendingAlarmCounter++
					} catch (e) {
						if (e instanceof NotFoundError) {
							console.log(TAG, e, "Event or alarm were not found: ", entityEventData, e)
						} else {
							throw e
						}
					}
				} else if (entityEventData.operation === OperationType.DELETE) {
					await this.cancelUserAlarmInfo(entityEventData.instanceId)
				}
			} else if (
				isUpdateForTypeRef(CalendarEventTypeRef, entityEventData) &&
				(entityEventData.operation === OperationType.CREATE || entityEventData.operation === OperationType.UPDATE)
			) {
				const deferredEvent = this.getPendingAlarmRequest(entityEventData.instanceId)
				deferredEvent.deferred.resolve(undefined)
			} else if (isUpdateForTypeRef(CalendarEventUpdateTypeRef, entityEventData) && entityEventData.operation === OperationType.CREATE) {
				try {
					const invite = await this.entityClient.load(CalendarEventUpdateTypeRef, [entityEventData.instanceListId, entityEventData.instanceId])
					await this.handleCalendarEventUpdate(invite)
				} catch (e) {
					if (e instanceof NotFoundError) {
						console.log(TAG, "invite not found", [entityEventData.instanceListId, entityEventData.instanceId], e)
					} else {
						throw e
					}
				}
			} else if (isUpdateForTypeRef(FileTypeRef, entityEventData)) {
				// with a file update, the owner enc session key should be present now so we can try to process any skipped calendar event updates
				// (see NoOwnerEncSessionKeyForCalendarEventError's comment)
				const skippedCalendarEventUpdate = this.fileIdToSkippedCalendarEventUpdates.get(entityEventData.instanceId)
				if (skippedCalendarEventUpdate) {
					try {
						await this.handleCalendarEventUpdate(skippedCalendarEventUpdate)
					} catch (e) {
						if (e instanceof NotFoundError) {
							console.log(TAG, "invite not found", [entityEventData.instanceListId, entityEventData.instanceId], e)
						} else {
							throw e
						}
					} finally {
						this.fileIdToSkippedCalendarEventUpdates.delete(entityEventData.instanceId)
					}
				}
			}
		}

		for (const userAlarmInfo of alarmEventsToProcess) {
			const { listId, elementId } = userAlarmInfo.alarmInfo.calendarRef
			const deferredEvent = this.getPendingAlarmRequest(elementId)
			// Don't wait for the deferred event promise because it can lead to a deadlock.
			// Since issue #2264 we process event batches sequentially and the
			// deferred event can never be resolved until the calendar event update is received.
			deferredEvent.deferred.promise = deferredEvent.deferred.promise.then(async () => {
				deferredEvent.pendingAlarmCounter--
				if (deferredEvent.pendingAlarmCounter === 0) {
					this.pendingAlarmRequests.delete(elementId)
				}
				const calendarEvent = await this.entityClient.load(CalendarEventTypeRef, [listId, elementId])
				const scheduler = await this.alarmScheduler()
				try {
					this.scheduleUserAlarmInfo(calendarEvent, userAlarmInfo, scheduler)
				} catch (e) {
					if (e instanceof NotFoundError) {
						console.log(TAG, "event not found", [listId, elementId])
					} else {
						throw e
					}
				}
			})
		}
	}

	private getPendingAlarmRequest(elementId: string) {
		return getFromMap(this.pendingAlarmRequests, elementId, () => ({ pendingAlarmCounter: 0, deferred: defer() }))
	}

	private localAlarmsEnabled(): boolean {
		return !isApp() && !isDesktop() && this.logins.isInternalUserLoggedIn() && !this.logins.isEnabled(FeatureType.DisableCalendar)
	}

	private scheduleUserAlarmInfo(event: CalendarEvent, userAlarmInfo: UserAlarmInfo, scheduler: AlarmScheduler): void {
		this.userAlarmToAlarmInfo.set(getElementId(userAlarmInfo), userAlarmInfo.alarmInfo.alarmIdentifier)

		scheduler.scheduleAlarm(event, userAlarmInfo.alarmInfo, event.repeatRule, (title, body) => {
			this.notifications.showNotification(
				title,
				{
					body,
				},
				() => m.route.set("/calendar"),
			)
		})
	}

	private async cancelUserAlarmInfo(userAlarmInfoId: Id): Promise<any> {
		const identifier = this.userAlarmToAlarmInfo.get(userAlarmInfoId)

		if (identifier) {
			const alarmScheduler = await this.alarmScheduler()
			alarmScheduler.cancelAlarm(identifier)
		}
	}

	// VisibleForTesting
	getFileIdToSkippedCalendarEventUpdates(): Map<Id, CalendarEventUpdate> {
		return this.fileIdToSkippedCalendarEventUpdates
	}
}

/** return false when the given events (representing the new and old version of the same event) are both long events
 * or both short events, true otherwise */
async function didLongStateChange(newEvent: CalendarEvent, existingEvent: CalendarEvent, zone: string): Promise<boolean> {
	const { isLongEvent } = await import("../date/CalendarUtils.js")
	return isLongEvent(newEvent, zone) !== isLongEvent(existingEvent, zone)
}

/**
 * This is used due us receiving calendar events before updateOwnerEncSessionKey gets triggered, and thus we can't load calendar data attachments. This is
 * required due to our permission system and the fact that bucket keys are not immediately accessible from File, only Mail.
 *
 * This is a limitation that should be addressed in the future.
 */
class NoOwnerEncSessionKeyForCalendarEventError extends TutanotaError {
	constructor(message: string) {
		super("NoOwnerEncSessionKeyForCalendarEventError", message)
	}
}
