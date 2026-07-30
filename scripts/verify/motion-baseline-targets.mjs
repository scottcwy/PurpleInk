export const MOTION_BASELINE_DIRECTORY = 'docs/artifacts/motion-baseline'
export const MOTION_ACTUAL_DIRECTORY = '.data/artifacts/motion-baseline-actual'
export const MOTION_BASE_URL =
  process.env.CVC_SHOT_BASE_URL ?? 'http://localhost:3000'
export const MOTION_VIEWPORT = { width: 1440, height: 900 }
export const MOTION_PIXEL_DIFF_LIMIT = 0.001

const ROUTES = [
  ['marketing', '/'],
  ['foundations', '/playbook/foundations'],
  ['motion', '/playbook/motion'],
  ['ui', '/playbook/ui'],
  ['login', '/login'],
]

export const MOTION_BASELINE_TARGETS = [
  ...['light', 'dark'].flatMap((theme) =>
    ROUTES.map(([name, route]) => ({
      id: `${name}-${theme}`,
      route,
      theme,
      reducedMotion: 'no-preference',
    })),
  ),
  {
    id: 'motion-reduced-motion',
    route: '/playbook/motion',
    theme: 'light',
    reducedMotion: 'reduce',
  },
]

export const EXPECTED_DURATION_STYLES = {
  'duration-fast': '0.15s',
  'duration-base': '0.22s',
  'duration-slow': '0.36s',
  'duration-narrative': '0.3s',
}

export const EXPECTED_EASING_STYLES = {
  'ease-standard': 'cubic-bezier(0.4, 0, 0.2, 1)',
  'ease-emphasized': 'cubic-bezier(0.22, 1, 0.36, 1)',
  'ease-exit': 'cubic-bezier(0.4, 0, 1, 1)',
}
