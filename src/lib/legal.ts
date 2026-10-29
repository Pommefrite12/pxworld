/** Operator identity shown on legal pages. Configure through environment variables; never invent them. */
export function operator() {
  const missing = "[to be configured]";
  return {
    name: process.env.NEXT_PUBLIC_OPERATOR_NAME || missing,
    address: process.env.NEXT_PUBLIC_OPERATOR_ADDRESS || missing,
    email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || missing,
    registration: process.env.NEXT_PUBLIC_OPERATOR_REGISTRATION || missing,
    vat: process.env.NEXT_PUBLIC_OPERATOR_VAT || missing,
    host: "Vercel Inc. (hosting), Supabase Inc. (database & storage), Stripe Payments Europe Ltd. (payments)",
  };
}
