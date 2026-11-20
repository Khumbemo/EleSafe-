package org.hatialert.client

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// JSON shapes of hatialert-py's api.py. Unknown keys are ignored, so the server
// can add fields without breaking older apps.

@Serializable
data class User(
    val id: Long,
    val name: String,
    val phone: String,
    val village: String,
    val role: String,
    @SerialName("radius_km") val radiusKm: Double = 5.0,
    @SerialName("phone_verified") val phoneVerified: Boolean = false,
    @SerialName("must_change_pin") val mustChangePin: Boolean = false,
    @SerialName("sms_alerts") val smsAlerts: Boolean = false,
) {
    val roleEnum get() = org.hatialert.core.Role.fromKey(role)
    val isStaff get() = roleEnum?.isStaff == true
}

@Serializable
data class Session(val token: String, val user: User)

@Serializable
data class Village(
    val id: Long = 0,
    val name: String,
    val lat: Double,
    val lng: Double,
    val verified: Boolean = false,
    val source: String = "",
)

@Serializable
data class Attachment(
    val id: Long,
    val kind: String,
    val mime: String,
    val size: Long,
    @SerialName("created_at") val createdAt: Long,
)

@Serializable
data class Reporter(
    val name: String,
    val phone: String,
    @SerialName("phone_verified") val phoneVerified: Boolean = false,
)

@Serializable
data class IncidentEvent(
    val status: String,
    @SerialName("status_label") val statusLabel: String,
    val note: String = "",
    val at: Long,
    val by: String? = null,
    @SerialName("by_role") val byRole: String? = null,
)

@Serializable
data class Incident(
    val id: Long,
    val ref: String,
    val type: String,
    @SerialName("type_label") val typeLabel: String,
    val severity: String,
    @SerialName("severity_label") val severityLabel: String,
    val status: String,
    @SerialName("status_label") val statusLabel: String,
    val open: Boolean,
    @SerialName("herd_size") val herdSize: Int = 0,
    val casualties: Int = 0,
    @SerialName("crop_acres") val cropAcres: Double = 0.0,
    @SerialName("property_inr") val propertyInr: Long = 0,
    val heading: String = "",
    val village: String,
    val lat: Double,
    val lng: Double,
    val place: String = "",
    val description: String = "",
    @SerialName("created_at") val createdAt: Long,
    @SerialName("updated_at") val updatedAt: Long,
    val sample: Boolean = false,
    val mine: Boolean = false,
    val attachments: List<Attachment> = emptyList(),
    @SerialName("attachments_hidden") val attachmentsHidden: Int = 0,
    /** Only for the reporter and forest staff. */
    val reporter: Reporter? = null,
    // Detail view only:
    val events: List<IncidentEvent>? = null,
    @SerialName("can_attach") val canAttach: Boolean? = null,
    /** Statuses this viewer may move the case to. */
    val next: List<String>? = null,
    // Overview ("nearby") only: distance and direction from the viewer's village.
    val km: Double? = null,
    val dir: String? = null,
)

@Serializable
data class Alert(
    val id: Long,
    val level: String,
    @SerialName("level_label") val levelLabel: String,
    val message: String,
    val villages: List<String>,
    @SerialName("incident_id") val incidentId: Long? = null,
    val by: String? = null,
    @SerialName("sent_at") val sentAt: Long,
    val sample: Boolean = false,
    @SerialName("affects_me") val affectsMe: Boolean = false,
    val active: Boolean = false,
    /** Only in the answer to sending an alert: how many texts it made and how they go out. */
    val sms: AlertSms? = null,
)

/** Texts made for a new alert. [mode] is `auto`, `debug` or `manual` (staff send them by hand). */
@Serializable
data class AlertSms(val recipients: Int = 0, val mode: String = "manual")

@Serializable
data class Overview(
    val village: Village,
    @SerialName("radius_km") val radiusKm: Double,
    /** Open incidents within the alert radius, nearest first. */
    val nearby: List<Incident>,
    val warning: Alert? = null,
    @SerialName("open_total") val openTotal: Int = 0,
    @SerialName("reported_24h") val reported24h: Int = 0,
    @SerialName("awaiting_check") val awaitingCheck: Int = 0,
    @SerialName("has_sample") val hasSample: Boolean = false,
)

@Serializable
data class NearbyVillage(val name: String, val km: Double, val dir: String)

@Serializable
data class KeyLabel(val key: String, val label: String)

@Serializable
data class TypeInfo(val key: String, val label: String, val local: String = "")

@Serializable
data class StatusInfo(val key: String, val label: String, val open: Boolean)

@Serializable
data class ContactInfo(val name: String, val phone: String, val role: String, val placeholder: Boolean = false)

@Serializable
data class DemoAccount(val name: String, val phone: String, val pin: String, val role: String, val village: String)

@Serializable
data class Meta(
    val villages: List<Village>,
    val types: List<TypeInfo>,
    val severities: List<KeyLabel>,
    val statuses: List<StatusInfo>,
    val transitions: Map<String, List<String>> = emptyMap(),
    @SerialName("transition_roles") val transitionRoles: Map<String, List<String>> = emptyMap(),
    @SerialName("alert_levels") val alertLevels: List<KeyLabel> = emptyList(),
    val directions: List<String> = emptyList(),
    val limits: JsonObject = JsonObject(emptyMap()),
    val media: JsonObject = JsonObject(emptyMap()),
    val contacts: List<ContactInfo> = emptyList(),
    val safety: JsonElement? = null,
    val compensation: JsonElement? = null,
    @SerialName("sms_enabled") val smsEnabled: Boolean = false,
    @SerialName("demo_accounts") val demoAccounts: List<DemoAccount> = emptyList(),
)

/** A photo or voice note to upload; [data] is base64 (a `data:` URL prefix is allowed). */
@Serializable
data class NewAttachment(val kind: String, val data: String)

/**
 * A new report (POST /api/incidents). Give either [lat]/[lng] (GPS) or a
 * distance and direction from [village] ([offsetKm], [offsetDir]). [clientId]
 * makes a resend after a dropped connection return the first copy instead of a
 * duplicate (8 to 64 of A-Z a-z 0-9 _ -).
 */
@Serializable
data class NewIncident(
    val type: String,
    val village: String,
    @SerialName("herd_size") val herdSize: Int = 1,
    val casualties: Int = 0,
    @SerialName("crop_acres") val cropAcres: Double = 0.0,
    @SerialName("property_inr") val propertyInr: Long = 0,
    val heading: String = "",
    val lat: Double? = null,
    val lng: Double? = null,
    @SerialName("offset_km") val offsetKm: Double? = null,
    @SerialName("offset_dir") val offsetDir: String? = null,
    val place: String = "",
    val description: String = "",
    @SerialName("client_id") val clientId: String? = null,
    val attachments: List<NewAttachment>? = null,
)

@Serializable
internal data class StatusUpdate(val status: String? = null, val note: String = "")

@Serializable
internal data class Login(val phone: String, val pin: String)

@Serializable
internal data class OtpRequest(val phone: String, val purpose: String)

@Serializable
internal data class PinResetRequest(val phone: String, val code: String, val pin: String)

@Serializable
internal data class PinChange(@SerialName("old_pin") val oldPin: String, val pin: String)

@Serializable
internal data class MarkMessages(val ids: List<Long>, val status: String)

@Serializable
internal data class VillageCsv(val csv: String)

@Serializable
internal data class Registration(val name: String, val phone: String, val village: String, val pin: String, val code: String? = null)

@Serializable
data class NewAlert(
    val level: String,
    val message: String,
    val villages: List<String>,
    @SerialName("incident_id") val incidentId: Long? = null,
)

@Serializable
data class ProfileUpdate(
    val name: String? = null,
    val village: String? = null,
    @SerialName("radius_km") val radiusKm: Double? = null,
    @SerialName("sms_alerts") val smsAlerts: Boolean? = null,
)

/** Answer to asking for a one-time code (the same whether or not the number is known). */
@Serializable
data class OtpSent(val sent: Boolean = true, val message: String = "")

/** A stored photo or voice note; [data] is base64. */
@Serializable
data class AttachmentData(val id: Long, val kind: String, val mime: String, val size: Long = 0, val data: String)

// --- officer: statistics ---------------------------------------------------------

@Serializable
data class CountRow(val key: String = "", val label: String = "", val name: String = "", val count: Int = 0) {
    /** What to show: the label for types and severities, the name for villages. */
    val title get() = label.ifEmpty { name }
}

@Serializable
data class DayCount(val date: String, val count: Int)

@Serializable
data class Stats(
    val days: Int,
    val total: Int = 0,
    val open: Int = 0,
    val resolved: Int = 0,
    @SerialName("false_reports") val falseReports: Int = 0,
    @SerialName("median_response_h") val medianResponseH: Double? = null,
    @SerialName("responded_count") val respondedCount: Int = 0,
    @SerialName("by_type") val byType: List<CountRow> = emptyList(),
    @SerialName("by_severity") val bySeverity: List<CountRow> = emptyList(),
    @SerialName("by_village") val byVillage: List<CountRow> = emptyList(),
    val series: List<DayCount> = emptyList(),
    @SerialName("crop_acres") val cropAcres: Double = 0.0,
    @SerialName("property_inr") val propertyInr: Long = 0,
    val casualties: Int = 0,
)

// --- officer: people ---------------------------------------------------------------

@Serializable
data class AdminUser(
    val id: Long,
    val name: String,
    val phone: String,
    val village: String,
    val role: String,
    @SerialName("radius_km") val radiusKm: Double = 5.0,
    @SerialName("phone_verified") val phoneVerified: Boolean = false,
    @SerialName("must_change_pin") val mustChangePin: Boolean = false,
    @SerialName("sms_alerts") val smsAlerts: Boolean = false,
    val active: Boolean = true,
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("last_seen") val lastSeen: Long? = null,
    @SerialName("failed_24h") val failed24h: Int = 0,
    val sample: Boolean = false,
)

/** PATCH /api/users/{id}: only the fields given are changed. */
@Serializable
data class UserPatch(val role: String? = null, val active: Boolean? = null, val village: String? = null)

/** A temporary PIN made by an officer; shown once, the person must choose a new one on sign-in. */
@Serializable
data class PinReset(@SerialName("temp_pin") val tempPin: String, val user: AdminUser)

// --- officer: villages -------------------------------------------------------------

@Serializable
data class AdminVillage(
    val id: Long,
    val name: String,
    val lat: Double,
    val lng: Double,
    val verified: Boolean = false,
    val source: String = "",
    val active: Boolean = true,
    val people: Int = 0,
    val incidents: Int = 0,
)

@Serializable
data class NewVillage(val name: String, val lat: Double, val lng: Double, val source: String = "", val verified: Boolean = false)

/** PATCH /api/villages/{id}: only the fields given are changed. */
@Serializable
data class VillagePatch(
    val lat: Double? = null,
    val lng: Double? = null,
    val source: String? = null,
    val verified: Boolean? = null,
    val active: Boolean? = null,
)

@Serializable
data class VillageImport(
    val added: Int = 0,
    val updated: Int = 0,
    val skipped: Int = 0,
    @SerialName("skipped_lines") val skippedLines: List<Int> = emptyList(),
)

// --- officer: text messages and system -------------------------------------------------

@Serializable
data class OutboxRecipient(
    val id: Long,
    val name: String? = null,
    val village: String? = null,
    val phone: String,
    val status: String,
    val error: String? = null,
)

@Serializable
data class OutboxBatch(
    @SerialName("alert_id") val alertId: Long,
    val level: String,
    @SerialName("level_label") val levelLabel: String = "",
    val villages: List<String> = emptyList(),
    @SerialName("sent_at") val sentAt: Long = 0,
    val text: String = "",
    /** status -> number of texts (`queued`, `sent`, `failed`, `manual`). */
    val counts: Map<String, Int> = emptyMap(),
    val recipients: List<OutboxRecipient> = emptyList(),
)

@Serializable
data class Outbox(val mode: String = "manual", val batches: List<OutboxBatch> = emptyList())

@Serializable
data class SmsStatus(val enabled: Boolean = false, val mode: String = "manual", val host: String = "")

@Serializable
data class StorageStatus(
    @SerialName("db_bytes") val dbBytes: Long = 0,
    @SerialName("media_bytes") val mediaBytes: Long = 0,
    val users: Int = 0,
    val incidents: Int = 0,
)

@Serializable
data class BackupStatus(
    val dir: String? = null,
    @SerialName("every_hours") val everyHours: Double? = null,
    val keep: Int? = null,
    @SerialName("last_path") val lastPath: String? = null,
    @SerialName("last_at") val lastAt: Long? = null,
    val error: String? = null,
)

@Serializable
data class SystemInfo(val backups: BackupStatus? = null)

@Serializable
data class AuditEntry(val action: String, val detail: String = "", val by: String? = null, val at: Long = 0)

@Serializable
data class AdminStatus(
    val sms: SmsStatus = SmsStatus(),
    val storage: StorageStatus = StorageStatus(),
    /** status -> number of alert texts. */
    val outbox: Map<String, Int> = emptyMap(),
    val system: SystemInfo = SystemInfo(),
    val audit: List<AuditEntry> = emptyList(),
)
