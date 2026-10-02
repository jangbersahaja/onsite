import { sql } from "drizzle-orm";
import {
  boolean,
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

export const globalRoleEnum = pgEnum("global_role", ["member", "admin"]);
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

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  globalRole: globalRoleEnum("global_role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
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
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
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
    role: membershipRoleEnum("role").notNull(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
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

export const authSchema = { user, session, account, verification };
