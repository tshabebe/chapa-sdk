import { startBot } from './telegram-bot'

// Check if required environment variables are set
const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'CHAPA_AUTH_KEY']
const missingVars = requiredEnvVars.filter((varName) => !process.env[varName])

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:')
  missingVars.forEach((varName) => console.error(`   - ${varName}`))
  console.error('\nPlease set these environment variables and try again.')
  process.exit(1)
}

// Start the bot
startBot().catch((error) => {
  console.error('❌ Failed to start bot:', error)
  process.exit(1)
})
