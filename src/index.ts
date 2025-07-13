import { Chapa } from 'chapa-nodejs'
import { db } from '../db'
import { transactionTable, userTable, ZInsertUserTable } from '../db/schema'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import crypto from 'crypto'
import { ZTransfer, ZVerifyResponse } from './schema'
import express, { Request, Response } from 'express'
import { TransactionReconciliationService } from './services/transaction-reconciliation'

const app = express()

// Raw body middleware for webhook signature verification
app.use('/webhook', express.raw({ type: 'application/json' }))
// JSON parsing for all other routes
app.use(express.json())

const CHAPA_AUTH_KEY = process.env.CHAPA_AUTH_KEY as string
const RETURN_URL = process.env.RETURN_URL || 'http://localhost:3000'
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET
const PORT = process.env.PORT || 3000
const chapa = new Chapa({ secretKey: CHAPA_AUTH_KEY })

// Initialize transaction reconciliation service
const reconciliationService = new TransactionReconciliationService(
  CHAPA_AUTH_KEY,
)

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)

  // Start the reconciliation service
  // reconciliationService.start()
})

app.get('/', async (req: Request, res: Response) => {
  res.json({ message: 'Chapa Payment API is running' })
})

app.post('/register', async (req: Request, res: Response) => {
  try {
    const body = ZInsertUserTable.parse(req.body)

    // Check if user already exists
    const existingUser = await db.query.userTable.findFirst({
      where: (user) => eq(user.id, body.id),
    })

    if (existingUser) {
      return res.status(409).json({ message: 'User already exists' })
    }

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
      return_url: RETURN_URL,
    })

    res.json(url.data)
  } catch (err) {
    console.error('Error initializing transaction:', err)
    res.status(500).json({ message: 'Error initializing transaction' })
  }
})

app.post('/webhook', async (req: Request, res: Response) => {
  try {
    // Get the raw body as string for signature verification
    const rawBody = req.body.toString('utf8')

    // Generate hash from raw body
    const hash = crypto
      .createHmac('sha256', WEBHOOK_SECRET as string)
      .update(rawBody)
      .digest('hex')

    // Check both signature headers
    const chapaSignature =
      req.headers['chapa-signature'] || req.headers['Chapa-Signature']
    const xChapaSignature =
      req.headers['x-chapa-signature'] || req.headers['X-Chapa-Signature']

    const isValidSignature = hash === chapaSignature || hash === xChapaSignature

    if (!isValidSignature) {
      console.error('Signature verification failed')
      return res.status(401).json({ message: 'Something went wrong' })
    }

    // Parse the body for processing
    const body = ZVerifyResponse.parse(JSON.parse(rawBody))
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

      // 5. Mark as completed if transfer was successful
      // Note: Chapa transfers are typically asynchronous, so we don't verify immediately
      await db
        .update(transactionTable)
        .set({ status: 'completed', verified: true })
        .where(eq(transactionTable.txRef, tx_ref))

      res.status(200).json({
        message: 'Transfer initiated successfully',
        data: transfer.data,
        tx_ref: tx_ref,
      })
    } catch (transferError) {
      console.error('Transfer error:', transferError)

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

      // Return a more specific error message
      const errorMessage =
        transferError instanceof Error
          ? transferError.message
          : 'Transfer failed'

      res.status(400).json({
        message: 'Transfer failed',
        error: errorMessage,
        tx_ref: tx_ref,
      })
    }
  } catch (error) {
    console.error('Error transferring funds:', error)
    res.status(500).json({ message: 'Error transferring funds' })
  }
})

// Endpoint to verify transfer status
app.get('/transfer/:tx_ref/status', async (req: Request, res: Response) => {
  try {
    const { tx_ref } = req.params

    // Get transaction from database
    const transaction = await db.query.transactionTable.findFirst({
      where: (transaction) => eq(transaction.txRef, tx_ref),
    })

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' })
    }

    // If transaction is already completed, return status
    if (transaction.status === 'completed') {
      return res.status(200).json({
        status: 'completed',
        message: 'Transfer completed successfully',
      })
    }

    // Try to verify with Chapa
    try {
      const verifyTransaction = await chapa.verifyTransfer({
        tx_ref: tx_ref,
      })

      if (verifyTransaction.status === 'success') {
        // Update transaction status
        await db
          .update(transactionTable)
          .set({ status: 'completed', verified: true })
          .where(eq(transactionTable.txRef, tx_ref))

        return res.status(200).json({
          status: 'completed',
          message: 'Transfer verified and completed',
        })
      } else {
        return res.status(200).json({
          status: transaction.status,
          message: 'Transfer is still processing',
        })
      }
    } catch (verifyError) {
      // If verification fails, return current status
      return res.status(200).json({
        status: transaction.status,
        message: 'Transfer verification failed, check status later',
      })
    }
  } catch (error) {
    console.error('Error checking transfer status:', error)
    res.status(500).json({ message: 'Error checking transfer status' })
  }
})

// Endpoint to check reconciliation service status
app.get('/admin/reconciliation/status', async (req: Request, res: Response) => {
  try {
    const status = reconciliationService.getStatus()
    res.status(200).json({
      message: 'Reconciliation service status',
      data: status,
    })
  } catch (error) {
    console.error('Error getting reconciliation status:', error)
    res.status(500).json({ message: 'Error getting reconciliation status' })
  }
})

// Endpoint to manually trigger reconciliation (admin only)
app.post(
  '/admin/reconciliation/trigger',
  async (req: Request, res: Response) => {
    try {
      // This would typically check for admin authentication
      // For now, we'll just trigger the reconciliation

      // Stop current service
      reconciliationService.stop()

      // Start it again (this will run reconciliation immediately)
      reconciliationService.start()

      res.status(200).json({
        message: 'Reconciliation triggered successfully',
        data: reconciliationService.getStatus(),
      })
    } catch (error) {
      console.error('Error triggering reconciliation:', error)
      res.status(500).json({ message: 'Error triggering reconciliation' })
    }
  },
)

export default app
