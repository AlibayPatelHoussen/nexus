/**
 * Light selection haptic (UISelectionFeedbackGenerator-like).
 * Android: navigator.vibrate. iPhone: Safari has no vibrate, but since iOS 18 toggling a
 * switch checkbox plays the system selection haptic; a hidden one is toggled through its
 * label. Must be called from a user gesture (pointer up, click…).
 */
let label: HTMLLabelElement | null = null

export function selectionHaptic(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') { navigator.vibrate(8); return }
    if (typeof document === 'undefined') return
    if (!label) {
      const box = document.createElement('div')
      box.setAttribute('aria-hidden', 'true')
      box.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('switch', '')
      input.id = 'nx-haptic'
      input.tabIndex = -1
      label = document.createElement('label')
      label.htmlFor = input.id
      box.append(input, label)
      document.body.append(box)
    }
    label.click()
  } catch { /* no haptics here */ }
}
