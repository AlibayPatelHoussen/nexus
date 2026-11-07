import { afterEach, describe, expect, it, vi } from 'vitest'
import { installNativeFeel } from '@/services/nativeFeel'

const touch = (on: boolean) => vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
  matches: on && query.includes('pointer: coarse'), media: query, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
}) as MediaQueryList)

const longPress = (el: Element) => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  el.dispatchEvent(e)
  return e.defaultPrevented
}

describe('touch screens feel like an installed app', () => {
  let undo = () => {}
  afterEach(() => { undo(); vi.restoreAllMocks(); document.body.innerHTML = '' })

  it('no browser menu on a long press, except in text fields and logs', () => {
    touch(true)
    undo = installNativeFeel()
    document.body.innerHTML = '<a href="/media/1"><img alt=""></a><input><div class="selectable"><span>log</span></div>'
    expect(longPress(document.querySelector('img')!)).toBe(true)
    expect(longPress(document.querySelector('a')!)).toBe(true)
    expect(longPress(document.querySelector('input')!)).toBe(false)
    expect(longPress(document.querySelector('.selectable span')!)).toBe(false)
  })

  it('mouse: right click untouched', () => {
    touch(false)
    undo = installNativeFeel()
    document.body.innerHTML = '<a href="/x">x</a>'
    expect(longPress(document.querySelector('a')!)).toBe(false)
  })
})
