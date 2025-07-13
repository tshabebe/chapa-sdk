import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { createInsertSchema } from 'drizzle-zod'
import { transactionTable } from './transaction'

export const userTable = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name'),
  balance: integer('balance'),
  userRole: text('user_role', { enum: ['admin', 'user'] }).default('user'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .default(sql`current_timestamp`)
    .$onUpdate(() => new Date()),
})

export const usersRelations = relations(userTable, ({ many }) => ({
  transitions: many(transactionTable),
}))

// used for data sanitization and validation
export const ZInsertUserTable = createInsertSchema(userTable)
