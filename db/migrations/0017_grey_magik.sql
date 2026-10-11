CREATE TABLE "outlet_storehub_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_name" text NOT NULL,
	"pos_store_id" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outlet_storehub_connections" ADD CONSTRAINT "outlet_storehub_connections_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_storehub_connections" ADD CONSTRAINT "outlet_storehub_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_storehub_connections" ADD CONSTRAINT "outlet_storehub_connections_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outlet_storehub_connections_outlet_uq" ON "outlet_storehub_connections" USING btree ("outlet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outlet_storehub_connections_store_uq" ON "outlet_storehub_connections" USING btree ("store_name","pos_store_id");