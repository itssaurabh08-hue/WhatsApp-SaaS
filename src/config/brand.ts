/**
 * Single source of truth for product branding. Change the product name, logo
 * or contact details here (or via NEXT_PUBLIC_BRAND_* env vars) instead of
 * editing components.
 */
export const brand = {
  productName: process.env.NEXT_PUBLIC_BRAND_PRODUCT_NAME || "WhatsFlow",
  companyName: process.env.NEXT_PUBLIC_BRAND_COMPANY_NAME || "WhatsFlow",
  logoPath: process.env.NEXT_PUBLIC_BRAND_LOGO_PATH || "/logo.svg",
  primaryDomain: process.env.NEXT_PUBLIC_BRAND_DOMAIN || "localhost:3000",
  supportEmail: process.env.NEXT_PUBLIC_BRAND_SUPPORT_EMAIL || "support@example.com",
  social: {
    x: process.env.NEXT_PUBLIC_BRAND_SOCIAL_X || "",
    linkedin: process.env.NEXT_PUBLIC_BRAND_SOCIAL_LINKEDIN || "",
    github: process.env.NEXT_PUBLIC_BRAND_SOCIAL_GITHUB || "",
  },
} as const;

export type Brand = typeof brand;
