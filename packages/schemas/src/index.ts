import { z } from "zod";

/** Conservative V1 ticker rule: exactly 4 uppercase ASCII alphanumeric chars. */
export const TICKER_REGEX = /^[A-Z0-9]{4}$/;

export const tickerSchema = z
  .string()
  .min(1)
  .max(12)
  .transform((s) => s.toUpperCase())
  .refine((s) => TICKER_REGEX.test(s), {
    message: "Ticker must be exactly 4 uppercase letters/digits (A-Z, 0-9).",
  });

const httpsUrl = z.string().url().startsWith("https://").max(300).optional().or(z.literal(""));

export const launchMetadataSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name too long"),
  ticker: tickerSchema,
  description: z.string().trim().max(500, "Description too long").default(""),
  websiteUrl: httpsUrl,
  xUrl: httpsUrl,
  imageHash: z.string().optional(),
});

export const mintQuoteSchema = z.object({
  deploymentId: z.string().min(1),
  mode: z.enum(["EXACT_TOKENS", "EXACT_SATS"]),
  // Exactly one of these is required depending on mode.
  tokens: z.string().optional(),
  sats: z.string().optional(),
  walletAddress: z.string().min(1),
});

export const mintBuildSchema = z.object({
  quoteId: z.string().uuid(),
  walletAddress: z.string().min(1),
});

export const sellBuildSchema = z.object({
  deploymentId: z.string().min(1),
  sellerAddress: z.string().min(1),
  tokenAmountAtoms: z.string(),
  askingPriceSats: z.string(),
  expiryBlocks: z.number().int().positive().max(10000).default(144),
});

export const buyBuildSchema = z.object({
  listingId: z.string().min(1),
  buyerAddress: z.string().min(1),
});

export const cancelBuildSchema = z.object({
  listingId: z.string().min(1),
  sellerAddress: z.string().min(1),
});

export const broadcastSchema = z.object({
  signedPsbt: z.string().min(1),
  walletAddress: z.string().min(1),
  operation: z.enum(["DEPLOY", "MINT", "DEX_ASK", "DEX_BID", "DEX_CANCEL"]),
  deploymentId: z.string().optional(),
});

export const reportSchema = z.object({
  deploymentId: z.string().min(1),
  reason: z.enum(["impersonation", "malware", "illegal", "copyright", "other"]),
  details: z.string().max(2000).optional(),
});

export const launchBuildSchema = launchMetadataSchema.extend({
  walletAddress: z.string().min(1),
  termsVersion: z.string().min(1),
});

export type LaunchMetadata = z.infer<typeof launchMetadataSchema>;
export type MintQuoteInput = z.infer<typeof mintQuoteSchema>;
export type SellBuildInput = z.infer<typeof sellBuildSchema>;
