const REQUIRED_VARIABLES = [
  'CVC_MANAGED_STEPFUN_API_KEY',
  'CVC_MANAGED_MIMO_API_KEY',
  'CVC_MANAGED_GEMINI_API_KEY',
  'CVC_MANAGED_OPENAI_API_KEY',
  'CVC_MANAGED_ANTHROPIC_API_KEY',
  'CVC_REDEMPTION_CODE_PEPPER',
]

const statuses = REQUIRED_VARIABLES.map((name) => ({
  name,
  status: process.env[name]?.trim() ? 'configured' : 'missing',
}))

console.log(JSON.stringify({ managedServices: statuses }, null, 2))

if (statuses.some((entry) => entry.status === 'missing')) {
  process.exitCode = 1
}
