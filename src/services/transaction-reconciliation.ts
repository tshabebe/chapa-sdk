import { Chapa } from 'chapa-nodejs'
import { db } from '../../db'
import { transactionTable, userTable } from '../../db/schema'
import { eq, inArray, ne } from 'drizzle-orm'

export class TransactionReconciliationService {
  private chapa: Chapa
  private isRunning = false
  private intervalId: NodeJS.Timeout | null = null

  constructor(chapaAuthKey: string) {
    this.chapa = new Chapa({ secretKey: chapaAuthKey })
  }

  /**
   * Start the reconciliation service
   * Runs every 10 minutes (600,000 ms)
   */
  start(): void {
    if (this.isRunning) {
      console.log('Transaction reconciliation service is already running')
      return
    }

    console.log('Starting transaction reconciliation service...')
    this.isRunning = true

    // Run immediately on start
    this.reconcileTransactions()

    // Then run every 10 minutes
    this.intervalId = setInterval(() => {
      this.reconcileTransactions()
    }, 10 * 60 * 1000) // 10 minutes
  }

  /**
   * Stop the reconciliation service
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    console.log('Stopping transaction reconciliation service...')
    this.isRunning = false

    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  /**
   * Main reconciliation logic
   */
  private async reconcileTransactions(): Promise<void> {
    try {
      console.log('Starting transaction reconciliation...')

      // Get all incomplete transactions
      const incompleteTransactions = await this.getIncompleteTransactions()

      if (incompleteTransactions.length === 0) {
        console.log('No incomplete transactions found')
        return
      }

      console.log(
        `Found ${incompleteTransactions.length} incomplete transactions to reconcile`,
      )

      // Process each transaction
      for (const transaction of incompleteTransactions) {
        await this.processTransaction(transaction)

        // Add a small delay to avoid overwhelming the Chapa API
        await this.delay(1000) // 1 second delay
      }

      console.log('Transaction reconciliation completed')
    } catch (error) {
      console.error('Error during transaction reconciliation:', error)
    }
  }

  /**
   * Get all transactions that are not in completed state
   */
  private async getIncompleteTransactions() {
    return await db.query.transactionTable.findMany({
      where: (transaction) => ne(transaction.status, 'completed'),
      with: {
        user: {
          columns: {
            id: true,
            balance: true,
          },
        },
      },
    })
  }

  /**
   * Process a single transaction
   */
  private async processTransaction(transaction: any): Promise<void> {
    try {
      console.log(
        `Processing transaction: ${transaction.txRef} (${transaction.status})`,
      )

      // Skip if no tx_ref
      if (!transaction.txRef) {
        console.log(`Skipping transaction ${transaction.id} - no tx_ref`)
        return
      }

      // Verify transaction with Chapa
      const verificationResult = await this.verifyWithChapa(transaction.txRef)

      if (verificationResult.success) {
        await this.handleSuccessfulTransaction(
          transaction,
          verificationResult.data,
        )
      } else {
        await this.handleFailedTransaction(
          transaction,
          verificationResult.error ?? 'Unknown error',
        )
      }
    } catch (error) {
      console.error(`Error processing transaction ${transaction.txRef}:`, error)

      // Mark as failed if we can't process it
      if (transaction.txRef) {
        await this.markTransactionAsFailed(
          transaction.txRef,
          'Processing error',
        )
      }
    }
  }

  /**
   * Verify transaction with Chapa API
   */
  private async verifyWithChapa(txRef: string): Promise<{
    success: boolean
    data?: any
    error?: string
  }> {
    try {
      const response = await this.chapa.verify({
        tx_ref: txRef,
      })

      if (response.status === 'success') {
        return {
          success: true,
          data: response,
        }
      } else {
        return {
          success: false,
          error: `Transaction status: ${response.status}`,
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      }
    }
  }

  /**
   * Handle successful transaction verification
   */
  private async handleSuccessfulTransaction(
    transaction: any,
    verificationData: any,
  ): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        // Update user balance if this is a deposit and not already verified
        if (
          transaction.transactionType === 'deposit' &&
          !transaction.verified
        ) {
          const amount = Number(verificationData.amount) || 0

          await tx
            .update(userTable)
            .set({
              balance: (transaction.user?.balance ?? 0) + amount,
            })
            .where(eq(userTable.id, transaction.userId))
        }

        // Mark transaction as completed
        await tx
          .update(transactionTable)
          .set({
            status: 'completed',
            verified: true,
            updatedAt: new Date(),
          })
          .where(eq(transactionTable.txRef, transaction.txRef))
      })

      console.log(`Transaction ${transaction.txRef} marked as completed`)
    } catch (error) {
      console.error(`Error updating transaction ${transaction.txRef}:`, error)
      throw error
    }
  }

  /**
   * Handle failed transaction verification
   */
  private async handleFailedTransaction(
    transaction: any,
    error: string,
  ): Promise<void> {
    // Only mark as failed if it's been pending for too long
    const createdAt = new Date(transaction.createdAt)
    const now = new Date()
    const hoursSinceCreation =
      (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60)

    // If transaction is older than 1 hour and still pending, mark as failed
    if (
      hoursSinceCreation > 1 &&
      transaction.status === 'pending' &&
      transaction.txRef
    ) {
      await this.markTransactionAsFailed(
        transaction.txRef,
        `Failed after ${Math.round(hoursSinceCreation)} hours: ${error}`,
      )
    } else {
      console.log(
        `Transaction ${
          transaction.txRef || 'unknown'
        } still processing (${error})`,
      )
    }
  }

  /**
   * Mark transaction as failed
   */
  private async markTransactionAsFailed(
    txRef: string,
    reason: string,
  ): Promise<void> {
    try {
      await db
        .update(transactionTable)
        .set({
          status: 'failed',
          updatedAt: new Date(),
        })
        .where(eq(transactionTable.txRef, txRef))

      console.log(`Transaction ${txRef} marked as failed: ${reason}`)
    } catch (error) {
      console.error(`Error marking transaction ${txRef} as failed:`, error)
    }
  }

  /**
   * Utility function to add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Get service status
   */
  getStatus(): { isRunning: boolean; lastRun?: Date } {
    return {
      isRunning: this.isRunning,
    }
  }
}
