# Cove V1 State Root — Frozen Serialization Spec

Status: **FROZEN for protocol version 1.** Any change to this serialization
requires a new protocol version. Do not edit `computeStateRoot` or this spec
without bumping `COVE_VERSION`.

## Input

- `state: CoveState` (tokens map, tickerIndex map, balances map, reserveSats,
  platformTreasurySats).
- `domain: string` — the canonical `configDomain(config)` string committing to
  protocol/network/genesis/scripts/fees.

## Serialization

All integers are decimal ASCII (no leading zeros, no sign). All hex fields are
lowercase. Sections are separated by the literal `\n---\n` (LF + three hyphens +
LF). Records within a section are separated by `\n` (LF). Fields within a record
are separated by `:` (colon).

### Section order

1. `domain` (raw string, no transformation)
2. tokens
3. tickerIndex
4. balances
5. reserveSats (decimal string)
6. platformTreasurySats (decimal string)

### tokens

One record per entry of `state.tokens`, sorted by the record string using
JavaScript default string comparison (UTF-16 code-unit / byte-lexicographic for
the ASCII values in use). Record format:

```
<deploymentId>:<ticker>:<creator>:<confirmedSupplyAtoms>:<currentStage>
```

### tickerIndex

One record per entry of `state.tickerIndex`, sorted likewise:

```
<ticker>:<deploymentId>
```

### balances

Flatten every `(ownerScript, Map<deploymentId, balance>)` into one record per
inner entry, sorted by record string:

```
<ownerScript>:<deploymentId>:<availableAtoms>
```

## Digest

`sha256` of the joined payload (UTF-8), hex-encoded lowercase.

## Reference implementation

`state-root-reference.ts` is an INDEPENDENT reimplementation of this spec. It
does not import the production serializer. The test suite proves
`computeStateRoot === referenceComputeStateRoot` on the frozen golden vectors in
`packages/protocol/src/cove/state-root-vectors.json`.
