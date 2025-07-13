import { relations } from "drizzle-orm/relations";
import { user, transaction } from "./schema";

export const transactionRelations = relations(transaction, ({one}) => ({
	user: one(user, {
		fields: [transaction.userId],
		references: [user.id]
	}),
}));

export const userRelations = relations(user, ({many}) => ({
	transactions: many(transaction),
}));