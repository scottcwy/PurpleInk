export function divideBillingRoundUp(
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (denominator <= BigInt(0)) {
    throw new Error('billing denominator must be positive')
  }
  return (numerator + denominator - BigInt(1)) / denominator
}

export function applyBillingRatio(
  amount: bigint,
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (amount < BigInt(0) || numerator < BigInt(0)) {
    throw new Error('billing amount and multiplier must not be negative')
  }
  return divideBillingRoundUp(amount * numerator, denominator)
}
