import { z } from "zod";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(254)
  .pipe(z.email("Enter a valid email address."))
  .transform((v) => v.toLowerCase());

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // Do not apply length rules on login: they would leak policy details and block legacy passwords.
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1).max(200),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export const verifyEmailSchema = z.object({ token: z.string().min(1).max(200) });
