import { writeFileSync, mkdirSync } from 'node:fs'
import { verificationCodeMail } from '../../src/features/auth/mail-templates'

mkdirSync('output/mail-preview', { recursive: true })
for (const purpose of ['signup', 'password_reset'] as const) {
  const mail = verificationCodeMail({ purpose, code: '428193' })
  writeFileSync(`output/mail-preview/${purpose}.html`, mail.html, 'utf8')
}
console.log('written')
