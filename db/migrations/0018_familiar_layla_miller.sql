CREATE TYPE "public"."user_locale" AS ENUM('en', 'ms', 'id');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "locale" "user_locale";