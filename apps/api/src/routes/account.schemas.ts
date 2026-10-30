import { z } from 'zod'

import {
  isStrongPassword,
  MAX_PASSWORD_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from '../services/password-policy.js'

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: z
    .string()
    .min(12)
    .max(MAX_PASSWORD_LENGTH)
    .refine(isStrongPassword, PASSWORD_POLICY_MESSAGE),
})

export const DeleteAccountSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
})

export const ChangeEmailRequestSchema = z.object({
  newEmail: z.string().trim().email().max(254),
})

export const VerifyEmailChangeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
})
