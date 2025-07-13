-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations

CREATE TABLE IF NOT EXISTS "user" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text,
    "user_role" text DEFAULT 'user',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
    "number" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transaction" (
    "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tx_ref" text,
    "user_id" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
    "verified" boolean DEFAULT false,
    CONSTRAINT "transaction_tx_ref_unique" UNIQUE("tx_ref")
);
--> statement-breakpoint
ALTER TABLE IF EXISTS "transaction" ADD CONSTRAINT IF NOT EXISTS "transaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
