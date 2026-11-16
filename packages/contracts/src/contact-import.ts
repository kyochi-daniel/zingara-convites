import { z } from 'zod'

export const guestFilePreviewInput = z.object({
  file: z.object({
    name: z.string().min(1).max(120).regex(/^[^/\\]+\.(csv|txt|docx|doc)$/i)
      .refine(name => [...name].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)),
    contentBase64: z.string().min(4).max(349528),
  }).strict(),
}).strict()

export const guestFileImportInput = guestFilePreviewInput.extend({
  acceptedRows: z.array(z.number().int().min(1)).min(1).max(200),
  batchId: z.uuid(),
  whatsappConsent: z.boolean().default(false),
  authorizationSource: z.string().trim().min(5).max(300).optional(),
}).strict().refine(value => !value.whatsappConsent || !!value.authorizationSource, {
  message: 'Informe a fonte verificável da autorização WhatsApp.', path: ['authorizationSource'],
})

export type GuestFileImportInput = z.infer<typeof guestFileImportInput>
