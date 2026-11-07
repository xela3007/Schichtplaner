import { z } from "zod";

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "must be a valid email address" }));

export const SignupRequest = z.object({
  email: Email,
  password: z
    .string()
    .min(12, { error: "must be at least 12 characters" })
    .max(128, { error: "must be at most 128 characters" }),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const TokenResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type TokenResponse = z.infer<typeof TokenResponse>;

export const MeResponse = z.object({
  id: z.uuid(),
  email: z.email(),
  permissions: z.array(z.string()),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const ErrorResponse = z.object({
  error: z.string(),
  requestId: z.string().optional(),
  issues: z
    .array(z.object({ field: z.string(), message: z.string() }))
    .optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
