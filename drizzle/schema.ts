import { pgTable, text, timestamp, integer, foreignKey, unique, boolean } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const user = pgTable("user", {
	id: text().primaryKey().notNull(),
	name: text(),
	userRole: text("user_role").default('user'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	number: integer(),
});

export const transaction = pgTable("transaction", {
	id: text().default(gen_random_uuid()).primaryKey().notNull(),
	txRef: text("tx_ref"),
	userId: text("user_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	verified: boolean().default(false),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "transaction_user_id_user_id_fk"
		}),
	unique("transaction_tx_ref_unique").on(table.txRef),
]);
