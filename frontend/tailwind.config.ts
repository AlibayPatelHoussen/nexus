import type { Config } from 'tailwindcss'

// Layout utilities only: every colour, radius and font comes from the
// design tokens (src/design/tokens.css).
const v = (name: string) => `var(--${name})`

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font)'],
        mono: ['var(--font-mono)'],
      },
      colors: {
        bg:        v('bg'),
        grouped:   v('bg-grouped'),
        surface:   v('surface'),
        surface2:  v('surface-2'),
        fill:      v('fill'),
        fill2:     v('fill-2'),
        separator: v('separator'),
        label:     v('label'),
        label2:    v('label-2'),
        label3:    v('label-3'),
        accent:    v('accent'),
        'accent-text': v('accent-text'),
        'accent-fill': v('accent-fill'),
        'accent-soft': v('accent-soft'),
        ok:        v('green'),
        'ok-text': v('green-text'),
        warn:      v('orange'),
        'warn-text': v('orange-text'),
        danger:    v('red'),
        'danger-text': v('red-text'),
      },
      fontSize: {
        largetitle: ['var(--text-largetitle)', { lineHeight: '1.12', letterSpacing: 'var(--track-largetitle)', fontWeight: '700' }],
        title:      ['var(--text-title)', { lineHeight: '1.2', letterSpacing: 'var(--track-title)', fontWeight: '700' }],
        headline:   ['var(--text-headline)', { lineHeight: '1.3', fontWeight: '600' }],
        body:       ['var(--text-body)', { lineHeight: '1.38' }],
        callout:    ['var(--text-callout)', { lineHeight: '1.47' }],
        subhead:    ['var(--text-subhead)', { lineHeight: '1.33' }],
        caption:    ['var(--text-caption)', { lineHeight: '1.3' }],
      },
      borderRadius: {
        card:    v('r-card'),
        group:   v('r-group'),
        control: v('r-control'),
        sheet:   v('r-sheet'),
      },
      transitionDuration: { fast: '150ms', DEFAULT: '200ms', slow: '250ms' },
      transitionTimingFunction: { out: 'cubic-bezier(0.2, 0.8, 0.2, 1)', sheet: 'cubic-bezier(0.32, 0.72, 0, 1)' },
      minHeight: { row: v('row-h'), control: v('control-h'), hit: v('hit') },
      minWidth: { hit: v('hit') },
      height: { toolbar: v('toolbar-h'), control: v('control-h') },
    },
  },
  plugins: [],
}

export default config
