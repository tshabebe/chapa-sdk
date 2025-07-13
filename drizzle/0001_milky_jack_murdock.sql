ALTER TABLE "user" ALTER COLUMN "updated_at" SET DEFAULT current_timestamp;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "updated_at" SET DEFAULT current_timestamp;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "type" "type" DEFAULT 'deposit';--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "status" "status" DEFAULT 'pending';