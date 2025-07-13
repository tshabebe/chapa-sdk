import z from 'zod'

export const ZVerifyResponse = z.object({
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone_number: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  amount: z.string().optional().nullable(),
  charge: z.string().optional().nullable(),
  mode: z.string().optional().nullable(),
  method: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  tx_ref: z.string().optional().nullable(),
  customization: z.object({
    title: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    logo: z.string().optional().nullable(),
  }),
})

export const ZTransfer = z.object({
  user_id: z.string(),
  account_name: z.string().optional(),
  account_number: z.string(),
  amount: z.number(),
  currency: z.string().optional(),
  reference: z.string().optional(),
  bank_code: z.number(),
})
