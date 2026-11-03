import '@testing-library/jest-dom'

// jsdom has no matchMedia: answer "no match" (desktop-less, mouse) so device hooks work
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList
}
