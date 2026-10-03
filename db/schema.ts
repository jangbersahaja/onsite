import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const accountTypeEnum = pgEnum("account_type", [
  "super_admin",
  "admin",
  "staff",
]);
export const membershipRoleEnum = pgEnum("membership_role", [
  "manager",
  "supervisor",
  "staff",
]);
export const correctionEventEnum = pgEnum("correction_event", [
  "clock_in",
  "clock_out",
]);
export const correctionStatusEnum = pgEnum("correction_status", [
  "pending",
  "approved",
  "rejected",
]);
export const punchSourceEnum = pgEnum("punch_source", ["gps", "manual"]);
export const staffDeviceStatusEnum = pgEnum("staff_device_status", [
  "pending",
  "active",
  "revoked",
]);

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    username: text("username").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    profilePhotoPath: text("profile_photo_path"),
    accountType: accountTypeEnum("account_type").notNull().default("staff"),
    canAccessClock: boolean("can_access_clock").notNull().default(true),
    canAccessBackoffice: boolean("can_access_backoffice")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_username_lower_uq").on(sql`lower(${table.username})`),
    uniqueIndex("user_email_lower_uq").on(sql`lower(${table.email})`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    tokenHash: text("token_hash").unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const staffDeviceEnrollments = pgTable(
  "staff_device_enrollments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    status: staffDeviceStatusEnum("status").notNull().default("pending"),
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("staff_device_one_pending_per_user_uq")
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("staff_device_one_active_per_user_uq")
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    index("staff_device_user_idx").on(table.userId),
  ],
);

export const outlets = pgTable("outlets", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  radiusMeters: integer("radius_meters").notNull().default(100),
  timezone: text("timezone").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const outletMemberships = pgTable(
  "outlet_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    assignedBy: text("assigned_by").references(() => user.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("outlet_memberships_user_outlet_uq").on(
      table.userId,
      table.outletId,
    ),
    index("outlet_memberships_outlet_role_idx").on(table.outletId, table.role),
    index("outlet_memberships_user_idx").on(table.userId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    accountType: accountTypeEnum("account_type").notNull().default("staff"),
    canAccessClock: boolean("can_access_clock").notNull().default(true),
    canAccessBackoffice: boolean("can_access_backoffice")
      .notNull()
      .default(false),
    role: membershipRoleEnum("role").notNull(),
    outletId: uuid("outlet_id").references(() => outlets.id, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("invitations_email_outlet_idx").on(table.email, table.outletId),
  ],
);

export const invitationOutlets = pgTable(
  "invitation_outlets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("invitation_outlets_invitation_outlet_uq").on(
      table.invitationId,
      table.outletId,
    ),
    index("invitation_outlets_outlet_idx").on(table.outletId),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("password_reset_user_idx").on(table.userId)],
);

export const authLoginAttempts = pgTable("auth_login_attempts", {
  key: text("key").primaryKey(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
});

export const workSessions = pgTable(
  "work_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "restrict" }),
    timezone: text("timezone").notNull().default("UTC"),
    clockInAt: timestamp("clock_in_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clockInLatitude: doublePrecision("clock_in_latitude"),
    clockInLongitude: doublePrecision("clock_in_longitude"),
    clockInAccuracy: doublePrecision("clock_in_accuracy"),
    clockInSource: punchSourceEnum("clock_in_source").notNull().default("gps"),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
    clockOutLatitude: doublePrecision("clock_out_latitude"),
    clockOutLongitude: doublePrecision("clock_out_longitude"),
    clockOutAccuracy: doublePrecision("clock_out_accuracy"),
    clockOutSource: punchSourceEnum("clock_out_source"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("work_sessions_one_open_per_user_uq")
      .on(table.userId)
      .where(sql`${table.clockOutAt} IS NULL`),
    index("work_sessions_user_clock_in_idx").on(table.userId, table.clockInAt),
    index("work_sessions_outlet_clock_in_idx").on(
      table.outletId,
      table.clockInAt,
    ),
  ],
);

export const workBreaks = pgTable(
  "work_breaks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workSessionId: uuid("work_session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "work_breaks_end_after_start_chk",
      sql`${table.endedAt} IS NULL OR ${table.endedAt} > ${table.startedAt}`,
    ),
    uniqueIndex("work_breaks_one_open_per_session_uq")
      .on(table.workSessionId)
      .where(sql`${table.endedAt} IS NULL`),
    index("work_breaks_session_started_idx").on(
      table.workSessionId,
      table.startedAt,
    ),
  ],
);

export const correctionRequests = pgTable(
  "correction_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "restrict" }),
    timezone: text("timezone").notNull().default("UTC"),
    workSessionId: uuid("work_session_id").references(() => workSessions.id, {
      onDelete: "set null",
    }),
    event: correctionEventEnum("event").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    status: correctionStatusEnum("status").notNull().default("pending"),
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewReason: text("review_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("correction_requests_outlet_status_idx").on(
      table.outletId,
      table.status,
    ),
    index("correction_requests_requester_idx").on(table.requestedBy),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    previousValues: jsonb("previous_values"),
    newValues: jsonb("new_values"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_events_entity_idx").on(table.entityType, table.entityId),
    index("audit_events_actor_created_idx").on(table.actorId, table.createdAt),
  ],
);
