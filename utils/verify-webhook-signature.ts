import * as crypto from 'crypto'

// Add a simple logger if not already present
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET

export function verifyWebhookSignature(req: Request): boolean {
  // Use Headers.get() for compatibility
  const chapaSignature = req.headers.get('chapa-signature') as string | null
  const xChapaSignature = req.headers.get('x-chapa-signature') as string | null

  if (WEBHOOK_SECRET) {
    // If req.body is a Buffer, convert to string, else JSON.stringify
    let payload: string
    if (
      typeof (req as any).body === 'object' &&
      Buffer.isBuffer((req as any).body)
    ) {
      payload = (req as any).body.toString('utf8')
    } else {
      payload = JSON.stringify((req as any).body)
    }
    const expectedHash = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(payload)
      .digest('hex')

    const isChapaSignatureValid = chapaSignature === expectedHash
    const isXChapaSignatureValid = xChapaSignature === expectedHash

    if (!isChapaSignatureValid && !isXChapaSignatureValid) {
      console.log('❌ Invalid webhook signature')
      return false
    }
    console.log('✅ Webhook signature verified')
    return true
  }
  // If no secret, always fail
  return false
}
