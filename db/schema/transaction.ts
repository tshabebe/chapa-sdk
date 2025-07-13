import {
  boolean,
  uuid,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { createInsertSchema } from 'drizzle-zod'
import { userTable } from './auth'
import { relations, sql } from 'drizzle-orm'

const transactionType = pgEnum('type', ['deposit', 'withdrawal'])

const transactionStatus = pgEnum('status', [
  'pending', // Initial state
  'processing', // Chapa transfer initiated
  'completed', // Transfer successful, balance updated
  'failed', // Transfer failed
  'reversed', // Money returned to user
])

export const transactionTable = pgTable('transaction', {
  id: uuid('id').defaultRandom(),
  txRef: text('tx_ref').unique(),
  transactionType: transactionType('transaction_type').default('deposit'),
  verified: boolean('verified').default(false),
  status: transactionStatus('status').default('pending'),
  userId: text('user_id').references(() => userTable.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .default(sql`current_timestamp`)
    .$onUpdate(() => new Date()),
})

export const transactionRelation = relations(transactionTable, ({ one }) => ({
  user: one(userTable, {
    fields: [transactionTable.userId],
    references: [userTable.id],
  }),
}))

// used for data sanitization and validation
export const ZInsertTransactionTable = createInsertSchema(transactionTable)
