import { Hono } from 'hono'
import { Chapa } from 'chapa-nodejs'
import { db } from '../db'
import { transactionTable, userTable, ZInsertUserTable } from '../db/schema'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { ZTransfer, ZVerifyResponse } from './schema'

const CHAPA_AUTH_KEY = process.env.CHAPA_AUTH_KEY as string

const app = new Hono()
const chapa = new Chapa({ secretKey: CHAPA_AUTH_KEY })

app.get('/', async (c) => {
  return c.json({ message: 'Chapa Payment API is running' })
})

app.post('/register', async (c) => {
  try {
    const body = ZInsertUserTable.parse(await c.req.json())
    const user = await db
      .insert(userTable)
      .values(body)
      .returning({ id: userTable.id, name: userTable.name })
    return c.json({ message: 'User registered successfully', data: user }, 202)
  } catch (error) {
    console.error('Error inserting user:', error)
    return c.json({ message: 'Error registering user' }, 500)
  }
})

app.post('/', async (c) => {
  try {
    // sanitizing and validating input
    const body = ZInsertUserTable.pick({ id: true })
      .extend({
        amount: z.number(),
        currency: z.enum(['ETB', 'USD']).default('ETB'),
      })
      .parse(await c.req.json())

    const user = await db.query.userTable.findFirst({
      where: (user) => eq(user.id, body.id),
    })

    if (!user) {
      return c.json({ message: 'User not found' }, 404)
    }

    const tx_ref = await chapa.genTxRef()

    // store the transaction
    await db.insert(transactionTable).values({
      txRef: tx_ref,
      userId: body.id,
    })

    const url = await chapa.initialize({
      amount: body.amount.toString(),
      currency: body.currency,
      tx_ref: tx_ref,
    })

    return c.json(url.data)
  } catch (err) {
    console.error('Error initializing transaction:', err)
    return c.json({ message: 'Error initializing transaction' }, 500)
  }
})

app.post('/webhook', async (c) => {
  try {
    const body = ZVerifyResponse.parse(await c.req.json())
    if (!body.tx_ref) {
      return c.json({ message: 'Transaction reference not found' }, 400)
    }

    console.log(body.tx_ref)
    // verify transaction
    const response = await chapa.verify({
      tx_ref: body.tx_ref!,
    })

    if (response.status !== 'success') {
      return c.json({ message: 'Transaction failed' }, 400)
    }

    // get transaction
    const transaction = await db.query.transactionTable.findFirst({
      where: (transaction) => eq(transaction.txRef, body.tx_ref!),
      with: {
        user: {
          columns: {
            id: true,
            balance: true,
          },
        },
      },
    })

    if (transaction?.verified) {
      return c.json({ message: 'Transaction already verified' }, 200)
    }

    await db.transaction(async (tx) => {
      if (transaction?.user) {
        await tx
          .update(userTable)
          .set({
            balance: (transaction.user.balance ?? 0) + Number(body.amount),
          })
          .where(eq(userTable.id, transaction.user.id))
      }

      await tx
        .update(transactionTable)
        .set({ verified: true })
        .where(eq(transactionTable.txRef, body.tx_ref!))
    })

    return c.json({ message: 'Transaction verified successfully' }, 200)
  } catch (error) {
    console.error('Error verifying webhook signature:', error)
    return c.json({ message: 'Error verifying webhook signature' }, 500)
  }
})

app.post('/transfer', async (c) => {
  try {
    const body = ZTransfer.parse(await c.req.json())

    // 1. Check balance and create pending transaction
    const user = await db.query.userTable.findFirst({
      where: (user) => eq(user.id, body.user_id),
    })

    if (!user) {
      return c.json({ message: 'User not found' }, 404)
    }

    if (user.balance && user.balance < body.amount) {
      return c.json({ message: 'Insufficient balance' }, 400)
    }

    const tx_ref = await chapa.genTxRef()

    // 2. Create transaction with 'pending' status
    await db.insert(transactionTable).values({
      txRef: tx_ref,
      userId: body.user_id,
      type: 'withdrawal',
      status: 'pending',
    })

    // 3. Deduct money and mark as 'processing'
    await db.transaction(async (tx) => {
      await tx
        .update(userTable)
        .set({ balance: (user.balance ?? 0) - Number(body.amount) })
        .where(eq(userTable.id, body.user_id))

      await tx
        .update(transactionTable)
        .set({ status: 'processing' })
        .where(eq(transactionTable.txRef, tx_ref))
    })

    try {
      // 4. Call Chapa transfer
      const transfer = await chapa.transfer({
        amount: body.amount.toString(),
        account_name: body.account_name ?? '',
        account_number: body.account_number,
        currency: body.currency ?? 'ETB',
        reference: tx_ref,
        bank_code: body.bank_code,
      })

      // 5. Verify transfer
      const verifyTransaction = await chapa.verifyTransfer({
        tx_ref: tx_ref,
      })

      if (verifyTransaction.status === 'success') {
        // 6. Mark as completed
        await db
          .update(transactionTable)
          .set({ status: 'completed', verified: true })
          .where(eq(transactionTable.txRef, tx_ref))

        return c.json(
          { message: 'Transfer successful', data: transfer.data },
          200,
        )
      } else {
        throw new Error('Transfer verification failed')
      }
    } catch (transferError) {
      // 7. If transfer fails, reverse the deduction
      await db.transaction(async (tx) => {
        await tx
          .update(userTable)
          .set({ balance: user.balance ?? 0 }) // Restore original balance
          .where(eq(userTable.id, body.user_id))

        await tx
          .update(transactionTable)
          .set({ status: 'failed' })
          .where(eq(transactionTable.txRef, tx_ref))
      })

      throw transferError
    }
  } catch (error) {
    console.error('Error transferring funds:', error)
    return c.json({ message: 'Error transferring funds' }, 500)
  }
})
export default app
