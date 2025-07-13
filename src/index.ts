import { Chapa } from 'chapa-nodejs'
import { db } from '../db'
import { transactionTable, userTable, ZInsertUserTable } from '../db/schema'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { ZTransfer, ZVerifyResponse } from './schema'
import express, { Request, Response } from 'express'

const app = express()

app.use(express.json())

const CHAPA_AUTH_KEY = process.env.CHAPA_AUTH_KEY as string

const chapa = new Chapa({ secretKey: CHAPA_AUTH_KEY })

app.get('/', async (req: Request, res: Response) => {
  res.json({ message: 'Chapa Payment API is running' })
})

app.post('/register', async (req: Request, res: Response) => {
  try {
    const body = ZInsertUserTable.parse(req.body)
    const user = await db
      .insert(userTable)
      .values(body)
      .returning({ id: userTable.id, name: userTable.name })
    res
      .status(202)
      .json({ message: 'User registered successfully', data: user })
  } catch (error) {
    console.error('Error inserting user:', error)
    res.status(500).json({ message: 'Error registering user' })
  }
})

app.post('/', async (req: Request, res: Response) => {
  try {
    // sanitizing and validating input
    const body = ZInsertUserTable.pick({ id: true })
      .extend({
        amount: z.number(),
        currency: z.enum(['ETB', 'USD']).default('ETB'),
      })
      .parse(req.body)

    const user = await db.query.userTable.findFirst({
      where: (user) => eq(user.id, body.id),
    })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
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

    res.json(url.data)
  } catch (err) {
    console.error('Error initializing transaction:', err)
    res.status(500).json({ message: 'Error initializing transaction' })
  }
})

app.post('/webhook', async (req: Request, res: Response) => {
  try {
    const body = ZVerifyResponse.parse(req.body)
    if (!body.tx_ref) {
      return res
        .status(400)
        .json({ message: 'Transaction reference not found' })
    }

    console.log(body.tx_ref)
    // verify transaction
    const response = await chapa.verify({
      tx_ref: body.tx_ref!,
    })

    if (response.status !== 'success') {
      return res.status(400).json({ message: 'Transaction failed' })
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
      return res.status(200).json({ message: 'Transaction already verified' })
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

    res.status(200).json({ message: 'Transaction verified successfully' })
  } catch (error) {
    console.error('Error verifying webhook signature:', error)
    res.status(500).json({ message: 'Error verifying webhook signature' })
  }
})

app.post('/transfer', async (req: Request, res: Response) => {
  try {
    const body = ZTransfer.parse(req.body)

    // 1. Check balance and create pending transaction
    const user = await db.query.userTable.findFirst({
      where: (user) => eq(user.id, body.user_id),
    })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (user.balance && user.balance < body.amount) {
      return res.status(400).json({ message: 'Insufficient balance' })
    }

    const tx_ref = await chapa.genTxRef()

    // 2. Create transaction with 'pending' status
    await db.insert(transactionTable).values({
      txRef: tx_ref,
      userId: body.user_id,
      transactionType: 'withdrawal',
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

        res
          .status(200)
          .json({ message: 'Transfer successful', data: transfer.data })
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
    res.status(500).json({ message: 'Error transferring funds' })
  }
})
export default app
