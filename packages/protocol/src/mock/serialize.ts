const BIGINT_TAG = "__bigint__";

/** Replacer that encodes BigInt as a tagged object so state can be JSON-ified. */
export function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return { [BIGINT_TAG]: value.toString() };
  }
  return value;
}

/** Reviver that restores BigInt from the tagged form. */
export function bigintReviver(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    BIGINT_TAG in (value as Record<string, unknown>) &&
    Object.keys(value as Record<string, unknown>).length === 1
  ) {
    return BigInt((value as Record<string, string>)[BIGINT_TAG]!);
  }
  return value;
}

export function serializeState<T>(state: T): string {
  return JSON.stringify(state, bigintReplacer);
}

export function deserializeState<T>(json: string): T {
  return JSON.parse(json, bigintReviver) as T;
}
