# Chapa Payment Telegram Bot

A fully functional Telegram bot built with Grammy that integrates with the Chapa payment API for deposits, withdrawals, and balance checking.

## Features

- 💰 **Deposit Funds**: Users can deposit money using Chapa payment gateway
- 💸 **Withdraw Funds**: Check balance and initiate withdrawals (manual processing)
- 💳 **Balance Checking**: Real-time balance inquiry
- 🔐 **Secure**: Uses Telegram user ID for authentication
- 🎯 **User-Friendly**: Intuitive inline keyboard interface
- 📊 **Database Integration**: Stores user data and transaction history

## Prerequisites

- Node.js/Bun runtime
- PostgreSQL database
- Telegram Bot Token (from @BotFather)
- Chapa API credentials

## Environment Variables

Create a `.env` file with the following variables:

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Chapa API
CHAPA_AUTH_KEY=your_chapa_secret_key_here
RETURN_URL=https://your-domain.com

# Database (if not already configured)
DATABASE_URL=your_database_url_here
```

## Installation

1. **Install dependencies** (if not already installed):

   ```bash
   bun install
   ```

2. **Set up the database**:

   ```bash
   bun run db:push
   ```

3. **Start the bot**:

   ```bash
   # Production
   bun run bot

   # Development with hot reload
   bun run bot:dev
   ```

## Bot Commands

### `/start`

- Initializes the bot and registers the user
- Shows the main menu with deposit, withdraw, and balance options

### `/balance`

- Shows the user's current balance
- Displays balance in ETB with formatting

## Bot Features

### 💰 Deposit

- **Preset amounts**: 100, 500, 1000, 5000 ETB
- **Custom amounts**: Users can enter any amount between 1-1,000,000 ETB
- **Payment flow**:
  1. User selects amount
  2. Bot generates transaction reference
  3. Chapa payment link is created
  4. User clicks "Pay Now" to complete payment
  5. Webhook updates balance when payment is confirmed

### 💸 Withdraw

- **Balance check**: Verifies sufficient funds before allowing withdrawal
- **Preset amounts**: 100, 500, 1000, 5000 ETB
- **Custom amounts**: Users can enter any amount up to their balance
- **Status**: Currently shows "not implemented" message (manual processing required)

### 💳 Balance Check

- **Real-time**: Shows current balance from database
- **Formatted**: Displays amount with proper formatting
- **Timestamp**: Shows when balance was last updated

## Database Schema

The bot uses the existing database schema:

### Users Table

- `id`: Telegram user ID (string)
- `name`: User's full name
- `balance`: Current balance in ETB

### Transactions Table

- `txRef`: Chapa transaction reference
- `userId`: Telegram user ID
- `verified`: Payment verification status
- `status`: Transaction status
- `transactionType`: Type of transaction

## Architecture

### File Structure

```
src/
├── telegram-bot.ts      # Main bot implementation
├── bot-runner.ts        # Standalone bot runner
└── index.ts            # Main API server (unchanged)
```

### Key Components

1. **Bot Instance**: Grammy bot with inline keyboards
2. **State Management**: In-memory user state for conversation flow
3. **Database Integration**: Direct integration with existing schema
4. **Chapa Integration**: Full payment processing via Chapa SDK
5. **Error Handling**: Comprehensive error handling and user feedback

## Security Features

- **User Authentication**: Uses Telegram user ID for identification
- **Input Validation**: Validates all user inputs with Zod schemas
- **Amount Limits**: Enforces minimum and maximum deposit/withdrawal limits
- **Balance Verification**: Prevents withdrawals exceeding available balance
- **Transaction Tracking**: All transactions are logged in the database

## Error Handling

The bot handles various error scenarios:

- **Invalid amounts**: Shows clear error messages for invalid inputs
- **Insufficient balance**: Prevents withdrawals when balance is insufficient
- **API failures**: Graceful handling of Chapa API errors
- **Database errors**: Proper error messages for database issues

## Development

### Running in Development

```bash
bun run bot:dev
```

### Testing

1. Start the bot
2. Send `/start` to your bot
3. Test deposit flow with small amounts
4. Verify webhook integration works

### Logs

The bot provides comprehensive logging:

- User interactions
- Payment processing
- Error details
- Database operations

## Production Deployment

### Environment Setup

1. Set all required environment variables
2. Ensure database is properly configured
3. Set up webhook URL for Chapa

### Monitoring

- Monitor bot logs for errors
- Track payment success rates
- Monitor database performance

## Integration with Main API

The bot works alongside the main API server:

1. **Shared Database**: Both bot and API use the same database schema
2. **Webhook Processing**: Main API handles Chapa webhooks and updates balances
3. **Independent Operation**: Bot can run independently of the main API

## Troubleshooting

### Common Issues

1. **Bot not responding**:

   - Check `TELEGRAM_BOT_TOKEN` is correct
   - Verify bot is started with `bun run bot`

2. **Payment not working**:

   - Verify `CHAPA_AUTH_KEY` is correct
   - Check webhook URL is accessible
   - Monitor webhook logs in main API

3. **Database errors**:
   - Run `bun run db:push` to ensure schema is up to date
   - Check database connection

### Debug Mode

Enable debug logging by setting:

```env
DEBUG=grammy:*
```

## Support

For issues or questions:

1. Check the logs for error details
2. Verify environment variables are set correctly
3. Ensure database schema is properly migrated

## License

This bot is part of the Chapa payment integration project.
