import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HumanCheckField } from '@/components/ui/human-check-field'
import { PasswordStrengthMeter, evaluatePasswordStrength } from './password-strength-meter'

const read = (path: string) => readFileSync(path, 'utf8')

const AUTH = 'src/app/(auth)/_components'
const UI = 'src/components/ui'

describe('密码强度档位与注册规则同源', () => {
  it('不满足 passwordSchema 一律弱档', () => {
    expect(evaluatePasswordStrength('short')).toBe('weak')
    expect(evaluatePasswordStrength('1234567890')).toBe('weak')
  })

  it('满足最低规则即中档（可提交）', () => {
    expect(evaluatePasswordStrength('abcdefgh12')).toBe('medium')
  })

  it('≥12 位且大小写或含特殊字符才是强档', () => {
    expect(evaluatePasswordStrength('abcdefghij12')).toBe('medium')
    expect(evaluatePasswordStrength('Abcdefghij12')).toBe('strong')
    expect(evaluatePasswordStrength('abcdefghij1!')).toBe('strong')
  })
})

describe('密码强度条不只靠颜色，且宽度过渡走 token', () => {
  it('每档都渲染文字标签', () => {
    for (const [password, label] of [
      ['short', '弱'],
      ['abcdefgh12', '中'],
      ['Abcdefghij12', '强'],
    ] as const) {
      const markup = renderToStaticMarkup(createElement(PasswordStrengthMeter, { password }))
      expect(markup).toContain('密码强度：')
      expect(markup).toContain(label)
      expect(markup).toContain('aria-live="polite"')
    }
  })

  it('空密码不渲染任何东西，避免出现空占位', () => {
    expect(renderToStaticMarkup(createElement(PasswordStrengthMeter, { password: '' }))).toBe('')
  })

  it('宽度过渡只用 token class，无时长/曲线字面量', () => {
    const source = read(`${AUTH}/password-strength-meter.tsx`)
    expect(source).toContain('transition-[width] duration-base ease-standard')
    expect(source).not.toMatch(/duration-\[\d/)
    expect(source).not.toMatch(/cubic-bezier/)
  })
})

describe('表单反馈条：进出场参数与自动消失策略', () => {
  const source = read(`${AUTH}/form-feedback.tsx`)

  it('退出用 TRANSITION_EXIT，不用 spring（规范 §5.3）', () => {
    expect(source).toContain('TRANSITION_EXIT')
    expect(source).toContain('TRANSITION_BASE')
    expect(source).not.toContain('SPRING')
    expect(source).not.toContain("type: 'spring'")
  })

  it('只有回执类（info/success）自动消失，错误与警告常驻', () => {
    expect(source).toContain("const AUTO_DISMISS_VARIANTS: readonly ToastVariant[] = ['info', 'success']")
  })

  it('自动消失时长复用 toast store 的 SSOT，不写死毫秒', () => {
    expect(source).toContain('DEFAULT_TOAST_DURATION')
    expect(source).not.toMatch(/setTimeout\([^,]+,\s*\d/)
  })

  it('复用 Toast 原语而非另造一套反馈条', () => {
    expect(source).toContain("from '@/components/ui/toast'")
    expect(source).toContain('<Toast')
  })

  it('三个表单都改用 FormFeedback，不再内联 Toast', () => {
    for (const form of ['login-form.tsx', 'signup-form.tsx', 'reset-password-form.tsx']) {
      const formSource = read(`${AUTH}/${form}`)
      expect(formSource, form).toContain('FormFeedback')
      expect(formSource, form).not.toContain("from '@/components/ui/toast'")
    }
  })
})

describe('注册渐进披露：折叠只是视觉收起', () => {
  const source = read(`${AUTH}/signup-form.tsx`)

  it('用 grid-template-rows 过渡，参数取自 token（意图 4）', () => {
    expect(source).toContain('transition-[grid-template-rows] duration-base ease-emphasized')
    expect(source).toContain('grid-rows-[1fr]')
    expect(source).toContain('grid-rows-[0fr]')
  })

  it('内容始终挂载，折叠态用 aria-hidden + inert 隔离焦点与读屏', () => {
    expect(source).toContain('aria-hidden={!open}')
    expect(source).toContain('inert={!open}')
    expect(source).toContain('min-h-0 overflow-hidden')
    // 条件挂载会丢输入值与倒计时状态，必须不是 `open && <fields/>`。
    expect(source).not.toMatch(/\{\s*open\s*&&\s*</)
  })
})

describe('人机验证失败态可恢复', () => {
  it('失败时给出重试引导文本，而非只变颜色', () => {
    const markup = renderToStaticMarkup(
      createElement(HumanCheckField, { question: '', onRefresh: () => {}, failed: true }),
    )
    expect(markup).toContain('验证题获取失败，点右侧按钮重试')
    expect(markup).toContain('text-ds-red')
  })

  it('取题中显示加载文案，成功后显示题面', () => {
    const loading = renderToStaticMarkup(
      createElement(HumanCheckField, { question: '', onRefresh: () => {} }),
    )
    expect(loading).toContain('正在获取验证题')

    const ready = renderToStaticMarkup(
      createElement(HumanCheckField, { question: '17 + 8', onRefresh: () => {} }),
    )
    expect(ready).toContain('请计算：17 + 8')
    expect(ready).not.toContain('验证题获取失败')
  })

  it('refreshing 时刷新图标旋转且按钮禁用', () => {
    const markup = renderToStaticMarkup(
      createElement(HumanCheckField, {
        question: '17 + 8',
        onRefresh: () => {},
        refreshing: true,
      }),
    )
    expect(markup).toContain('animate-spin')
    expect(markup).toContain('disabled=""')
  })
})

describe('验证码倒计时不抖动', () => {
  const source = read(`${UI}/verification-code-field.tsx`)

  it('按钮文案与提示都用 tabular-nums 等宽数字', () => {
    expect(source.match(/tabular-nums/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('倒计时提示保留 aria-live，读屏可感知', () => {
    expect(source).toContain('aria-live="polite"')
  })
})

describe('侧栏登出反馈', () => {
  const source = read(`${UI}/sidebar-chrome.tsx`)

  it('pending 用 spinner 且并行文本语义（非颜色单通道）', () => {
    expect(source).toContain('LoaderCircle')
    expect(source).toContain('animate-spin')
    expect(source).toContain('正在退出…')
    expect(source).toContain('退出失败，点击重试')
  })

  it('failed 态是瞬时提示：具名常量 + 到期复位 + cleanup', () => {
    expect(source).toContain('const LOGOUT_FAILED_RESET_MS = 5_000')
    expect(source).toContain("setLogoutState('idle')")
    expect(source).toContain('clearTimeout(timer)')
  })

  it('pending 期间禁止重复点击', () => {
    expect(source).toContain("logoutState === 'pending'")
  })
})

describe('新增 opt-in 状态已在 /playbook 登记', () => {
  it('Button loading 有 demo', () => {
    expect(read(`${UI}/button.demo.tsx`)).toContain('loading')
  })

  it('TextField 的 error 与 hint 都有 demo', () => {
    const demo = read(`${UI}/text-field.demo.tsx`)
    expect(demo).toContain('error=')
    expect(demo).toContain('hint=')
  })

  it('HumanCheckField 的 failed 与 refreshing 都有 demo', () => {
    const demo = read(`${UI}/human-check-field.demo.tsx`)
    expect(demo).toContain('failed')
    expect(demo).toContain('refreshing')
  })

  it('VerificationCodeField 的冷却态有 demo（倒计时等宽可验收）', () => {
    expect(read(`${UI}/verification-code-field.demo.tsx`)).toContain('cooldownSeconds')
  })
})

describe('认证壳入场', () => {
  const source = read(`${AUTH}/auth-form-shell.tsx`)

  it('复用共享 fadeInUp（意图 12），不本地写变体', () => {
    expect(source).toContain("import { fadeInUp } from '@/lib/motion/variants'")
    expect(source).toContain('variants={fadeInUp}')
  })

  it('整页导航没有离场动画，因此不声明 exit', () => {
    expect(source).not.toContain('exit=')
  })
})

describe('客户端校验与服务端同源', () => {
  it('实时校验直接跑 credential-policy 的 schema，不复制字面规则', () => {
    const source = read(`${AUTH}/use-auth-validation.ts`)
    expect(source).toContain("from '@/features/auth/credential-policy'")
    expect(source).toContain('safeParse')
  })

  it('credential-policy 对客户端安全：不引 node 内建、不引 db', () => {
    const source = read('src/features/auth/credential-policy.ts')
    // 只看真实 import：文件注释里刻意提到 `node:crypto` 说明为何不引它。
    const imports = source.match(/^import .+$/gm) ?? []
    expect(imports.length).toBeGreaterThan(0)
    for (const line of imports) {
      expect(line).not.toMatch(/from '(node:|@\/lib\/db)/)
    }
  })

  it('服务端 schemas 从同一份 policy re-export，避免第二套规则', () => {
    const source = read('src/features/auth/schemas.ts')
    expect(source).toContain('credential-policy')
  })
})
