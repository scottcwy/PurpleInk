const REDACTED = "[REDACTED]";

const patterns = [
  {
    kind: "bearer_token",
    expression: /(bearer\s+)[a-z0-9._~+/=-]{12,}/gi,
    replace: (_match, prefix) => `${prefix}${REDACTED}`,
  },
  {
    kind: "named_secret",
    expression: /((?:api[_-]?key|access[_-]?token|secret|token|password)\s*[:=]\s*)[^\s&"'<>]{6,}/gi,
    replace: (_match, prefix) => `${prefix}${REDACTED}`,
  },
  {
    kind: "aws_access_key",
    expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replace: () => REDACTED,
  },
  {
    kind: "email",
    expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replace: () => REDACTED,
  },
];

export function sanitizeText(value) {
  let text = value;
  const kinds = [];
  for (const pattern of patterns) {
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(text)) kinds.push(pattern.kind);
    pattern.expression.lastIndex = 0;
    text = text.replace(pattern.expression, pattern.replace);
  }
  return { text, kinds };
}

export function sanitizeDomRecords(records) {
  const findings = [];
  const sanitized = records.map((record, recordIndex) =>
    Object.fromEntries(
      Object.entries(record).map(([field, value]) => {
        if (typeof value !== "string") return [field, value];
        const result = sanitizeText(value);
        for (const kind of result.kinds) findings.push({ recordIndex, field, kind });
        return [field, result.text];
      })
    )
  );
  return {
    records: sanitized,
    redactionStatus: findings.length === 0 ? "passed" : "needs_review",
    findings,
  };
}
