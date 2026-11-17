import { z } from './zod.js'

export const GeneratedListingSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  highlights: z.array(z.string()).min(1),
  callToAction: z.string().min(1),
})

export type GeneratedListing = z.infer<typeof GeneratedListingSchema>