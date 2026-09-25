/**
 * Canonical ticker normalisation.
 *
 * This lives apart from tokenId.ts on purpose. tokenId.ts needs `node:crypto`,
 * and the wire codec needs the ticker rule — keeping them in one module made
 * the codec unbundleable for a browser, which in turn kept the browser from
 * decoding the very OP_RETURN it has to check before signing.
 */
export function canonicalTicker(ticker: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]{0,15}$/.test(ticker)) {
    throw new Error("ticker must be 1..16 alphanumeric, starting with a letter");
  }
  return ticker.toUpperCase();
}
