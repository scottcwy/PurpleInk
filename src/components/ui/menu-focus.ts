export const MENU_ITEM_SELECTOR = '[data-menu-item]:not([disabled])'

export function menuItems(root: HTMLElement | null): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? [])]
}

export function focusFirstMenuItem(root: HTMLElement | null) {
  menuItems(root)[0]?.focus()
}

export function moveMenuFocus(root: HTMLElement | null, offset: number) {
  const items = menuItems(root)
  if (items.length === 0) return
  const current = items.findIndex((item) => item === document.activeElement)
  const next = (current + offset + items.length) % items.length
  items[next]?.focus()
}
