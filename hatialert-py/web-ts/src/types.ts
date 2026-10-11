/* Shapes of the JSON the Python API sends (hatialert/api.py). Keep these in
   step with the *_view functions there. Times are milliseconds since the
   epoch; coordinates are WGS84 degrees. */

export type Role = "villager" | "guard" | "officer";
export type Severity = "critical" | "high" | "medium" | "low";
export type Status = "reported" | "verified" | "responded" | "resolved" | "false_report";
export type IncidentType = "sighting" | "herd_movement" | "crop_raid" | "property_damage" | "injury" | "death";
export type AlertLevel = "warning" | "info" | "all_clear";
export type Direction = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export type MediaKind = "photo" | "voice";
export type MessageStatus = "queued" | "sent" | "failed" | "manual";

/** App.user_view */
export interface User {
  id: number;
  name: string;
  phone: string;
  village: string;
  role: Role;
  radius_km: number;
  phone_verified: boolean;
  must_change_pin: boolean;
  sms_alerts: boolean;
}

/** App.admin_user_view (GET /api/users) */
export interface AdminUser extends User {
  active: boolean;
  created_at: number;
  last_seen: number | null;
  failed_24h: number;
  sample: boolean;
}

/** App.village_view */
export interface Village {
  id: number;
  name: string;
  lat: number;
  lng: number;
  verified: boolean;
  source: string;
}

/** GET /api/villages (officer) */
export interface AdminVillage extends Village {
  active: number | boolean;
  people: number;
  incidents: number;
}

export interface AttachmentInfo {
  id: number;
  kind: MediaKind;
  mime: string;
  size: number;
  created_at: number;
}

/** GET /api/attachments/:id */
export interface AttachmentData {
  id: number;
  kind: MediaKind;
  mime: string;
  size: number;
  data: string; // base64
}

export interface IncidentEvent {
  status: Status;
  status_label: string;
  note: string;
  at: number;
  by: string | null;
  by_role: Role | null;
}

/** App.incident_view, as in lists. */
export interface Incident {
  id: number;
  type: IncidentType;
  severity: Severity;
  status: Status;
  herd_size: number;
  casualties: number;
  crop_acres: number;
  property_inr: number;
  heading: Direction | "";
  village: string;
  lat: number;
  lng: number;
  place: string;
  description: string;
  created_at: number;
  updated_at: number;
  ref: string;
  type_label: string;
  severity_label: string;
  status_label: string;
  open: boolean;
  sample: boolean;
  mine: boolean;
  attachments: AttachmentInfo[];
  attachments_hidden: number;
  /** Only for the reporter and forest staff. */
  reporter?: { name: string; phone: string; phone_verified: boolean } | null;
}

/** GET /api/incidents/:id adds the history and what the viewer may do. */
export interface IncidentDetail extends Incident {
  events: IncidentEvent[];
  can_attach: boolean;
  next: Status[];
}

/** An incident on the home page, with distance from the home village. */
export interface NearbyIncident extends Incident {
  km: number;
  dir: Direction;
}

/** App.alert_view */
export interface Alert {
  id: number;
  level: AlertLevel;
  level_label: string;
  message: string;
  villages: string[];
  incident_id: number | null;
  by: string | null;
  sent_at: number;
  sample: boolean;
  affects_me: boolean;
  active: boolean;
}

/** POST /api/alerts */
export interface SentAlert extends Alert {
  sms: { recipients: number; mode: string };
}

/** GET /api/overview */
export interface Overview {
  village: Village;
  radius_km: number;
  nearby: NearbyIncident[];
  warning: Alert | null;
  open_total: number;
  reported_24h: number;
  awaiting_check: number;
  has_sample: boolean;
}

export interface MediaRule {
  mimes: string[];
  max_bytes: number;
  max_count: number;
}

export interface DemoAccount {
  name: string;
  phone: string;
  pin: string;
  role: Role;
  village: string;
}

export interface Contact {
  name: string;
  phone: string;
  role: string;
  placeholder: boolean;
}

export interface SafetyTip {
  text: string;
  local: string;
}

/** GET /api/meta (domain.meta plus villages, SMS and demo accounts) */
export interface Meta {
  villages: Village[];
  types: { key: IncidentType; label: string; local: string }[];
  severities: { key: Severity; label: string }[];
  statuses: { key: Status; label: string; open: boolean }[];
  transitions: Record<Status, Status[]>;
  transition_roles: Partial<Record<Status, Role[]>>;
  alert_levels: { key: AlertLevel; label: string }[];
  directions: Direction[];
  limits: Record<string, number | [number, number]>;
  media: { photo: MediaRule; voice: MediaRule; voice_max_seconds: number };
  contacts: Contact[];
  safety: { do: SafetyTip[]; dont: SafetyTip[] };
  compensation: { note: string; rates: { item: string; amount: string }[]; steps: string[]; documents: string[] };
  sms_enabled: boolean;
  demo_accounts: DemoAccount[];
}

/** POST /api/auth/login, /register, /reset */
export interface Session {
  token: string;
  user: User;
}

/** POST /api/severity */
export interface SeverityResult {
  severity: Severity;
  label: string;
}

/** GET /api/incidents/:id/villages */
export interface NearVillage {
  name: string;
  km: number;
  dir: Direction;
}

export interface CountRow {
  count: number;
  label?: string;
  name?: string;
}

/** GET /api/stats */
export interface Stats {
  days: number;
  total: number;
  open: number;
  resolved: number;
  false_reports: number;
  median_response_h: number | null;
  responded_count: number;
  by_type: { key: IncidentType; label: string; count: number }[];
  by_severity: { key: Severity; label: string; count: number }[];
  by_village: { name: string; count: number }[];
  series: { date: string; count: number }[];
  crop_acres: number;
  property_inr: number;
  casualties: number;
}

/** POST /api/users/:id/reset-pin */
export interface PinReset {
  temp_pin: string;
  user: AdminUser;
}

/** POST /api/villages/import */
export interface VillageImport {
  added: number;
  updated: number;
  skipped: number;
  skipped_lines: number[];
}

export interface OutboxRecipient {
  id: number;
  name: string | null;
  village: string | null;
  phone: string;
  status: MessageStatus;
  error: string | null;
}

export interface OutboxBatch {
  alert_id: number;
  level: AlertLevel;
  level_label: string;
  villages: string[];
  sent_at: number;
  text: string;
  counts: Partial<Record<MessageStatus, number>>;
  recipients: OutboxRecipient[];
}

/** GET /api/outbox */
export interface Outbox {
  mode: string;
  batches: OutboxBatch[];
}

/** GET /api/admin/status */
export interface AdminStatus {
  sms: { enabled: boolean; mode: string; host: string | null };
  storage: { db_bytes: number; media_bytes: number; users: number; incidents: number };
  outbox: Partial<Record<MessageStatus, number>>;
  system: {
    backups?: {
      dir: string | null;
      every_hours: number | null;
      keep: number;
      last_path: string | null;
      last_at: number | null;
      error: string | null;
    };
  } | null;
  audit: { action: string; detail: string; by: string | null; at: number }[];
}

/** POST /api/auth/otp */
export interface OtpSent {
  sent: boolean;
  message: string;
}

/** An alert the case page hands to the compose form. */
export interface AlertPrefill {
  level: AlertLevel;
  incident_id: number;
  villages: string[];
  message: string;
}

/** How the client reaches the API: fetch() normally, or the in-browser
    Python engine that the preview build installs as window.HATI_TRANSPORT. */
export interface Transport {
  engine: string;
  canDownload: boolean;
  ready: Promise<unknown>;
  request(method: string, path: string, body: unknown, token: string | null): Promise<{ status: number; type: string; body: string }>;
}

/** Phrase book read from window.HATI_NAGAMESE (nagamese.js). */
export interface PhraseBook {
  words: Record<string, string>;
  /** [English regex source, Nagamese template with {1}, {2}…] */
  patterns: [string, string][];
}

declare global {
  interface Window {
    HATI_TRANSPORT?: Transport;
    HATI_NAGAMESE?: PhraseBook;
    HATI_BOOT_MSG?: (msg: string) => void;
  }
}
