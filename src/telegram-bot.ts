import { Bot, Context, InlineKeyboard, webhookCallback } from 'grammy'
import { Chapa } from 'chapa-nodejs'
import { db } from '../db'
import { userTable, transactionTable } from '../db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

// Environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN as string
const CHAPA_AUTH_KEY = process.env.CHAPA_AUTH_KEY as string
const RETURN_URL = process.env.RETURN_URL || 'http://localhost:3000'

// Initialize Chapa
const chapa = new Chapa({ secretKey: CHAPA_AUTH_KEY })

// Initialize bot
const bot = new Bot(TELEGRAM_BOT_TOKEN)

// Register bot commands so that users can access a menu without typing /start
bot.api
  .setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'menu', description: 'Show main menu' },
    { command: 'balance', description: 'Check your balance' },
  ])
  .catch(console.error)

// Validation schemas
const ZDepositAmount = z.object({
  amount: z.number().min(1).max(1000000),
  currency: z.enum(['ETB', 'USD']).default('ETB'),
})

const ZWithdrawAmount = z.object({
  amount: z.number().min(1).max(1000000),
  currency: z.enum(['ETB', 'USD']).default('ETB'),
})

// User state management
interface UserState {
  action:
    | 'deposit'
    | 'withdraw'
    | 'withdraw_bank'
    | 'withdraw_account'
    | 'withdraw_account_number'
    | 'none'
  amount?: number
  currency?: 'ETB' | 'USD'
  bankCode?: number
  accountName?: string
  accountNumber?: string
}

const userStates = new Map<number, UserState>()

// Bank data from Chapa API
let BANKS_DATA: Array<{ id: number; name: string; currency: string }> = []

// Function to fetch banks from Chapa API
async function fetchBanks() {
  try {
    const response = await chapa.getBanks()
    if (response.data) {
      BANKS_DATA = response.data.map((bank) => ({
        id: bank.id,
        name: bank.name,
        currency: bank.currency,
      }))
      console.log(`✅ Fetched ${BANKS_DATA.length} banks from Chapa API`)
    }
  } catch (error) {
    console.error('❌ Failed to fetch banks from Chapa API:', error)
    // Fallback to some common Ethiopian banks if API fails
    BANKS_DATA = [
      { id: 128, name: 'Commercial Bank of Ethiopia', currency: 'ETB' },
      { id: 129, name: 'Bank of Abyssinia', currency: 'ETB' },
      { id: 130, name: 'Dashen Bank', currency: 'ETB' },
      { id: 131, name: 'Bank of Ethiopia', currency: 'ETB' },
      { id: 132, name: 'Cooperative Bank of Oromia', currency: 'ETB' },
    ]
  }
}

// Fetch banks at bot startup
fetchBanks()

// Helper functions
async function ensureUserRegistered(
  userId: number,
  firstName?: string,
  lastName?: string,
) {
  const existingUser = await db.query.userTable.findFirst({
    where: (user) => eq(user.id, userId.toString()),
  })

  if (!existingUser) {
    await db.insert(userTable).values({
      id: userId.toString(),
      name: `${firstName || 'User'} ${lastName || ''}`.trim(),
      balance: 0,
    })
  }

  return (
    existingUser ||
    (await db.query.userTable.findFirst({
      where: (user) => eq(user.id, userId.toString()),
    }))
  )
}

async function getUserBalance(userId: number) {
  const user = await db.query.userTable.findFirst({
    where: (user) => eq(user.id, userId.toString()),
  })
  return user?.balance || 0
}

// Command handlers
bot.command('start', async (ctx) => {
  const userId = ctx.from?.id
  if (!userId || !ctx.from) return

  await ensureUserRegistered(userId, ctx.from.first_name, ctx.from.last_name)

  const keyboard = new InlineKeyboard()
    .text('💰 Deposit', 'deposit')
    .text('💸 Withdraw', 'withdraw')
    .row()
    .text('💳 Check Balance', 'balance')

  await ctx.reply(
    'Welcome to Chapa Payment Bot! 🚀\n\n' +
      'You can deposit, withdraw, and check your balance.\n' +
      'What would you like to do?',
    { reply_markup: keyboard },
  )
})

bot.command('balance', async (ctx) => {
  const userId = ctx.from?.id
  if (!userId || !ctx.from) return

  await ensureUserRegistered(userId, ctx.from.first_name, ctx.from.last_name)
  const balance = await getUserBalance(userId)

  await ctx.reply(
    `💳 **Your Balance**\n\n` +
      `**Amount:** ${balance.toLocaleString()} ETB\n` +
      `**Status:** Active`,
    { parse_mode: 'Markdown' },
  )
})

// Quick /menu command to reopen the main menu without typing /start
bot.command('menu', async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text('💰 Deposit', 'deposit')
    .text('💸 Withdraw', 'withdraw')
    .row()
    .text('💳 Check Balance', 'balance')

  await ctx.reply('Main Menu – What would you like to do?', {
    reply_markup: keyboard,
  })
})

// Callback query handlers
bot.callbackQuery('deposit', async (ctx) => {
  const userId = ctx.from?.id
  if (!userId) return

  userStates.set(userId, { action: 'deposit' })

  const keyboard = new InlineKeyboard()
    .text('100 ETB', 'deposit_100')
    .text('500 ETB', 'deposit_500')
    .row()
    .text('1000 ETB', 'deposit_1000')
    .text('5000 ETB', 'deposit_5000')
    .row()
    .text('💰 Custom Amount', 'deposit_custom')
    .row()
    .text('🔙 Back', 'main_menu')

  await ctx.editMessageText(
    '💰 **Deposit Funds**\n\n' +
      'Select an amount to deposit or choose custom amount:',
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    },
  )
})

bot.callbackQuery('withdraw', async (ctx) => {
  const userId = ctx.from?.id
  if (!userId) return

  const balance = await getUserBalance(userId)

  if (balance <= 0) {
    await ctx.editMessageText(
      '❌ **Insufficient Balance**\n\n' +
        'You need to deposit funds before you can withdraw.',
      { parse_mode: 'Markdown' },
    )
    return
  }

  userStates.set(userId, { action: 'withdraw' })

  const keyboard = new InlineKeyboard()
    .text('100 ETB', 'withdraw_100')
    .text('500 ETB', 'withdraw_500')
    .row()
    .text('1000 ETB', 'withdraw_1000')
    .text('5000 ETB', 'withdraw_5000')
    .row()
    .text('💰 Custom Amount', 'withdraw_custom')
    .row()
    .text('🔙 Back', 'main_menu')

  await ctx.editMessageText(
    '💸 **Withdraw Funds**\n\n' +
      `**Available Balance:** ${balance.toLocaleString()} ETB\n\n` +
      'Select an amount to withdraw or choose custom amount:',
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    },
  )
})

bot.callbackQuery('balance', async (ctx) => {
  const userId = ctx.from?.id
  if (!userId) return

  const balance = await getUserBalance(userId)

  const keyboard = new InlineKeyboard().text('🔙 Back', 'main_menu')

  await ctx.editMessageText(
    `💳 **Your Balance**\n\n` +
      `**Amount:** ${balance.toLocaleString()} ETB\n` +
      `**Status:** Active\n\n` +
      `Last updated: ${new Date().toLocaleString()}`,
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    },
  )
})

bot.callbackQuery('main_menu', async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text('💰 Deposit', 'deposit')
    .text('💸 Withdraw', 'withdraw')
    .row()
    .text('💳 Check Balance', 'balance')

  await ctx.editMessageText(
    'Welcome to Chapa Payment Bot! 🚀\n\n' +
      'You can deposit, withdraw, and check your balance.\n' +
      'What would you like to do?',
    { reply_markup: keyboard },
  )
})

// Deposit amount handlers
bot.callbackQuery(/^deposit_(\d+)$/, async (ctx) => {
  const userId = ctx.from?.id
  if (!userId) return

  const amount = parseInt(ctx.match[1])

  try {
    // Ensure user is registered
    await ensureUserRegistered(userId, ctx.from.first_name, ctx.from.last_name)

    // Generate transaction reference
    const tx_ref = await chapa.genTxRef()

    // Store transaction in database
    await db.insert(transactionTable).values({
      txRef: tx_ref,
      userId: userId.toString(),
    })

    // Initialize payment with Chapa (using same logic as server)
    const url = await chapa.initialize({
      amount: amount.toString(),
      currency: 'ETB',
      tx_ref: tx_ref,
      return_url: RETURN_URL,
    })

    if (url.data) {
      const keyboard = new InlineKeyboard()
        .url('💳 Pay Now', url.data.checkout_url)
        .row()
        .text('🔙 Back', 'deposit')

      await ctx.editMessageText(
        `💰 **Deposit ${amount} ETB**\n\n` +
          `**Transaction ID:** \`${tx_ref}\`\n` +
          `**Amount:** ${amount.toLocaleString()} ETB\n` +
          `**Status:** Pending\n\n` +
          `Click the button below to complete your payment:`,
        {
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        },
      )
    } else {
      throw new Error('Failed to initialize payment')
    }
  } catch (error) {
    console.error('Deposit error:', error)
    await ctx.editMessageText(
      '❌ **Deposit Failed**\n\n' +
        'Unable to process your deposit request. Please try again later.',
      { parse_mode: 'Markdown' },
    )
  }
})

bot.callbackQuery('deposit_custom', async (ctx) => {
  const userId = ctx.from?.id
  if (!userId) return

  userStates.set(userId, { action: 'deposit' })

  await ctx.editMessageText(
    '💰 **Custom Deposit Amount**\n\n' +
      'Please enter the amount you want to deposit (in ETB):\n\n' +
      'Example: `1000` for 1,000 ETB',
    { parse_mode: 'Markdown' },
  )
})

// Withdraw amount handlers
bot.callbackQuery(/^withdraw_(\d+)$/, async (ctx) => {
  const userId = ctx.from?.id
  if (!userId) return

  const amount = parseInt(ctx.match[1])
  const balance = await getUserBalance(userId)

  if (balance < amount) {
    await ctx.editMessageText(
      '❌ **Insufficient Balance**\n\n' +
        `You have ${balance.toLocaleString()} ETB but trying to withdraw ${amount.toLocaleString()} ETB.`,
      { parse_mode: 'Markdown' },
    )
    return
  }

  // Store amount and move to bank selection
  const state = userStates.get(userId) || { action: 'none' }
  state.action = 'withdraw_bank'
  state.amount = amount
  userStates.set(userId, state)

  // Create bank selection keyboard
  const keyboard = new InlineKeyboard()

  // Add banks in rows of 2
  for (let i = 0; i < BANKS_DATA.length; i += 2) {
    const bank1 = BANKS_DATA[i]
    const bank2 = BANKS_DATA[i + 1]

    if (bank2) {
      keyboard
        .text(bank1.name, `bank_${bank1.id}`)
        .text(bank2.name, `bank_${bank2.id}`)
        .row()
    } else {
      keyboard.text(bank1.name, `bank_${bank1.id}`).row()
    }
  }

  keyboard.text('🔙 Back', 'withdraw')

  await ctx.editMessageText(
    `💸 **Withdraw ${amount.toLocaleString()} ETB**\n\n` +
      `**Amount:** ${amount.toLocaleString()} ETB\n` +
      `**Available Balance:** ${balance.toLocaleString()} ETB\n\n` +
      `Please select your bank:`,
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    },
  )
})

// Bank selection handler
bot.callbackQuery(/^bank_(\d+)$/, async (ctx) => {
  const userId = ctx.from?.id
  if (!userId) return

  const bankCode = parseInt(ctx.match[1])
  const state = userStates.get(userId)

  if (!state || state.action !== 'withdraw_bank') {
    await ctx.editMessageText(
      '❌ **Invalid State**\n\n' + 'Please start the withdrawal process again.',
      { parse_mode: 'Markdown' },
    )
    return
  }

  // Update state with bank code
  state.action = 'withdraw_account'
  state.bankCode = bankCode
  userStates.set(userId, state)

  const selectedBank = BANKS_DATA.find((bank) => bank.id === bankCode)

  await ctx.editMessageText(
    `🏦 **Selected Bank: ${selectedBank?.name}**\n\n` +
      `**Amount:** ${state.amount?.toLocaleString()} ETB\n\n` +
      `Please enter the account holder's name:\n\n` +
      `Example: \`John Doe\``,
    { parse_mode: 'Markdown' },
  )
})

bot.callbackQuery('withdraw_custom', async (ctx) => {
  const userId = ctx.from?.id
  if (!userId) return

  const balance = await getUserBalance(userId)

  if (balance <= 0) {
    await ctx.editMessageText(
      '❌ **Insufficient Balance**\n\n' +
        'You need to deposit funds before you can withdraw.',
      { parse_mode: 'Markdown' },
    )
    return
  }

  userStates.set(userId, { action: 'withdraw' })

  await ctx.editMessageText(
    '💸 **Custom Withdrawal Amount**\n\n' +
      `**Available Balance:** ${balance.toLocaleString()} ETB\n\n` +
      'Please enter the amount you want to withdraw (in ETB):\n\n' +
      'Example: `500` for 500 ETB',
    { parse_mode: 'Markdown' },
  )
})

// Text message handlers for custom amounts
bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id
  if (!userId) return

  const state = userStates.get(userId)
  if (!state || state.action === 'none') return

  const text = ctx.message.text.trim()

  try {
    if (state.action === 'deposit') {
      const amount = parseFloat(text)

      if (isNaN(amount) || amount <= 0 || amount > 1000000) {
        await ctx.reply(
          '❌ **Invalid Amount**\n\n' +
            'Please enter a valid amount between 1 and 1,000,000 ETB.',
          { parse_mode: 'Markdown' },
        )
        return
      }

      // Ensure user is registered
      await ensureUserRegistered(
        userId,
        ctx.from.first_name,
        ctx.from.last_name,
      )

      // Generate transaction reference
      const tx_ref = await chapa.genTxRef()

      // Store transaction in database
      await db.insert(transactionTable).values({
        txRef: tx_ref,
        userId: userId.toString(),
      })

      // Initialize payment with Chapa (using same logic as server)
      const url = await chapa.initialize({
        amount: amount.toString(),
        currency: 'ETB',
        tx_ref: tx_ref,
        return_url: RETURN_URL,
      })

      if (url.data) {
        const keyboard = new InlineKeyboard()
          .url('💳 Pay Now', url.data.checkout_url)
          .row()
          .text('🔙 Back', 'deposit')

        await ctx.reply(
          `💰 **Deposit ${amount.toLocaleString()} ETB**\n\n` +
            `**Transaction ID:** \`${tx_ref}\`\n` +
            `**Amount:** ${amount.toLocaleString()} ETB\n` +
            `**Status:** Pending\n\n` +
            `Click the button below to complete your payment:`,
          {
            reply_markup: keyboard,
            parse_mode: 'Markdown',
          },
        )

        // Reset user state – the deposit flow is complete once we show the
        // payment link. The user can start a new action from the menu.
        userStates.set(userId, { action: 'none' })
      } else {
        throw new Error('Failed to initialize payment')
      }
    } else if (state.action === 'withdraw') {
      const amount = parseFloat(text)
      const balance = await getUserBalance(userId)

      if (isNaN(amount) || amount <= 0 || amount > 1000000) {
        await ctx.reply(
          '❌ **Invalid Amount**\n\n' +
            'Please enter a valid amount between 1 and 1,000,000 ETB.',
          { parse_mode: 'Markdown' },
        )
        return
      }

      if (balance < amount) {
        await ctx.reply(
          '❌ **Insufficient Balance**\n\n' +
            `You have ${balance.toLocaleString()} ETB but trying to withdraw ${amount.toLocaleString()} ETB.`,
          { parse_mode: 'Markdown' },
        )
        return
      }

      // Store amount and move to bank selection
      state.action = 'withdraw_bank'
      state.amount = amount
      userStates.set(userId, state)

      // Create bank selection keyboard
      const keyboard = new InlineKeyboard()

      // Add banks in rows of 2
      for (let i = 0; i < BANKS_DATA.length; i += 2) {
        const bank1 = BANKS_DATA[i]
        const bank2 = BANKS_DATA[i + 1]

        if (bank2) {
          keyboard
            .text(bank1.name, `bank_${bank1.id}`)
            .text(bank2.name, `bank_${bank2.id}`)
            .row()
        } else {
          keyboard.text(bank1.name, `bank_${bank1.id}`).row()
        }
      }

      keyboard.text('🔙 Back', 'withdraw')

      await ctx.reply(
        `💸 **Withdraw ${amount.toLocaleString()} ETB**\n\n` +
          `**Amount:** ${amount.toLocaleString()} ETB\n` +
          `**Available Balance:** ${balance.toLocaleString()} ETB\n\n` +
          `Please select your bank:`,
        {
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        },
      )
    } else if (state.action === 'withdraw_account') {
      // This is the account name input
      const accountName = text.trim()

      if (accountName.length < 2) {
        await ctx.reply(
          '❌ **Invalid Account Name**\n\n' +
            'Please enter a valid account holder name (at least 2 characters).',
          { parse_mode: 'Markdown' },
        )
        return
      }

      // Update state with account name
      state.accountName = accountName
      state.action = 'withdraw_account_number'
      userStates.set(userId, state)

      await ctx.reply(
        `👤 **Account Holder: ${accountName}**\n\n` +
          `**Amount:** ${state.amount?.toLocaleString()} ETB\n` +
          `**Bank:** ${
            BANKS_DATA.find((bank) => bank.id === state.bankCode)?.name
          }\n\n` +
          `Please enter the account number:\n\n` +
          `Example: \`1234567890\``,
        { parse_mode: 'Markdown' },
      )
    } else if (state.action === 'withdraw_account_number') {
      // This is the account number input
      const accountNumber = text.trim()

      if (!/^\d{8,15}$/.test(accountNumber)) {
        await ctx.reply(
          '❌ **Invalid Account Number**\n\n' +
            'Please enter a valid account number (8-15 digits).',
          { parse_mode: 'Markdown' },
        )
        return
      }

      // Give the user immediate feedback that their request is being processed
      await ctx.reply(
        '⏳ **Processing your withdrawal…**\n\nPlease wait while we contact the bank.',
        { parse_mode: 'Markdown' },
      )

      // Now we have all the information, process the withdrawal
      try {
        const userId = ctx.from?.id
        if (!userId || !state.amount || !state.bankCode || !state.accountName) {
          throw new Error('Missing required information')
        }

        // Ensure user is registered
        await ensureUserRegistered(
          userId,
          ctx.from.first_name,
          ctx.from.last_name,
        )

        // Check balance again
        const balance = await getUserBalance(userId)
        if (balance < state.amount) {
          await ctx.reply(
            '❌ **Insufficient Balance**\n\n' +
              `Your balance has changed. You now have ${balance.toLocaleString()} ETB.`,
            { parse_mode: 'Markdown' },
          )
          return
        }

        const tx_ref = await chapa.genTxRef()

        // Create transaction with 'pending' status (same as server)
        await db.insert(transactionTable).values({
          txRef: tx_ref,
          userId: userId.toString(),
          transactionType: 'withdrawal',
          status: 'pending',
        })

        // Deduct money and mark as 'processing' (same as server)
        await db.transaction(async (tx) => {
          await tx
            .update(userTable)
            .set({ balance: balance - Number(state.amount) })
            .where(eq(userTable.id, userId.toString()))

          await tx
            .update(transactionTable)
            .set({ status: 'processing' })
            .where(eq(transactionTable.txRef, tx_ref))
        })

        try {
          // Call Chapa transfer (same as server)
          const transfer = await chapa.transfer({
            amount: state.amount.toString(),
            account_name: state.accountName,
            account_number: accountNumber,
            currency: 'ETB',
            reference: tx_ref,
            bank_code: state.bankCode,
          })

          // Mark as completed if transfer was successful (same as server)
          await db
            .update(transactionTable)
            .set({ status: 'completed', verified: true })
            .where(eq(transactionTable.txRef, tx_ref))

          const keyboard = new InlineKeyboard().text(
            '🔙 Back to Menu',
            'main_menu',
          )

          await ctx.reply(
            `✅ **Withdrawal Successful!**\n\n` +
              `**Transaction ID:** \`${tx_ref}\`\n` +
              `**Amount:** ${state.amount.toLocaleString()} ETB\n` +
              `**Account:** ${state.accountName}\n` +
              `**Bank:** ${
                BANKS_DATA.find((bank) => bank.id === state.bankCode)?.name
              }\n` +
              `**Status:** Completed\n\n` +
              `Your withdrawal has been processed successfully!`,
            {
              reply_markup: keyboard,
              parse_mode: 'Markdown',
            },
          )
        } catch (transferError) {
          console.error('Transfer error:', transferError)

          // If transfer fails, reverse the deduction (same as server)
          await db.transaction(async (tx) => {
            await tx
              .update(userTable)
              .set({ balance: balance }) // Restore original balance
              .where(eq(userTable.id, userId.toString()))

            await tx
              .update(transactionTable)
              .set({ status: 'failed' })
              .where(eq(transactionTable.txRef, tx_ref))
          })

          const errorMessage =
            transferError instanceof Error
              ? transferError.message
              : 'Transfer failed'

          await ctx.reply(
            `❌ **Withdrawal Failed**\n\n` +
              `**Transaction ID:** \`${tx_ref}\`\n` +
              `**Error:** ${errorMessage}\n\n` +
              `Your balance has been restored. Please try again later.`,
            { parse_mode: 'Markdown' },
          )
        }
      } catch (error) {
        console.error('Withdrawal error:', error)
        await ctx.reply(
          '❌ **Withdrawal Error**\n\n' +
            'An error occurred while processing your withdrawal. Please try again.',
          { parse_mode: 'Markdown' },
        )
      }

      // End of handler – we intentionally do NOT reset the state here because
      // some flows (e.g. withdrawal) require multiple sequential messages.
      // Each flow is responsible for resetting the state once it is truly
      // finished (see the specific branches above).
    }
  } catch (error) {
    console.error('Error processing text message:', error)
    await ctx.reply(
      '❌ **Error**\n\n' +
        'An error occurred while processing your request. Please try again.',
      { parse_mode: 'Markdown' },
    )
  }
})

// Error handling
bot.catch((err) => {
  console.error('Bot error:', err)
})

// Export bot for use in main application
export { bot }

// Start function for standalone bot
export async function startBot() {
  console.log('Starting Telegram bot...')
  await bot.start()
  console.log('Telegram bot is running!')
}
