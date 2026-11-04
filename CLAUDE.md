# Nexus — rules for every change

Nexus is a self-hosted server panel and media center (backend Node/Express +
PostgreSQL, frontend React + Vite + Tailwind, download scripts in Python in
`downloaders/`). Answer the owner in French.

## Design: iOS 26 / macOS 26 "Liquid Glass" — always

- The whole interface follows **iOS 26 / macOS 26 Liquid Glass** (WWDC 2025). Never the
  iOS 17 (or older) look: no flat grey bars with hairlines, no small rounded rectangles for buttons.
- **Sources, in this order when they disagree:** 1) Apple's official Figma kits
  (iOS & iPadOS: file `XAPnIBWdXCxvERbkNZLRIl`, macOS: file `9Ayp4YtfSedFV74qTqnPPD`, read
  through the Figma MCP), 2) Apple's Human Interface Guidelines, 3) the Apple TV app / tv.apple.com
  and the owner's screenshots, 4) the liquid-glass-design skills, 5) general knowledge.
- **Glass is for the navigation layer only**: sidebar, tab bar, toolbars, floating buttons,
  sheets, menus, popovers, player controls. Content (posters, lists, cards, text) stays opaque.
  Never glass on glass; one or two glass surfaces per screen.
  - `.glass` (small UI), `.glass-strong` (large UI), `.glass-clear` (over images / video): the
    translucent blur + saturation, the thin bright rim (kit: `1.25px 0 0 -0.75px`), specular top light.
- **Type:** the system font (`-apple-system` → SF Pro on Apple devices, Inter elsewhere). Big
  bold titles, clear hierarchy. SF Symbols / SF Pro files are never shipped (Apple license):
  icons are Lucide, sized and weighted like SF Symbols.
- **Shapes:** very round. Buttons, segmented controls, search fields, tab bar = capsules
  (`rounded-pill`). Concentric corners (inner radius = outer radius − inset).
- Light and dark mode, Apple system colours (`src/design/tokens.css`). Only the selected / primary
  element is tinted.
- **Motion:** springs everywhere (`src/design/motion.ts`, framer-motion), 60 fps (transform /
  opacity only). Press = small scale down, spring back. Selection capsules slide (`layoutId`).
  Skeletons, never spinners, for loading content.
- **Accessibility:** `prefers-reduced-motion` (MotionConfig reducedMotion="user" + CSS),
  `prefers-reduced-transparency`, `prefers-contrast`, contrast AA for text, keyboard navigation with
  visible focus, every icon-only control has a label, 44 px touch targets.
- **Navigation stays on the left** on desktop: the floating glass sidebar (macOS 26), same
  sections as today. On iPhone: the floating glass tab bar (iOS 26). Never remove a section.
- **Always reuse the design system** (`src/design/*`, `src/components/ui/*`, `src/components/media/*`).
  Never restyle by hand what a component already does; never hard-code colours, radii or durations
  (tokens only).
- Desktop **and** iPhone must both be right.
- **After every visual change, check with Playwright:** `npm run build -w frontend` then
  `node e2e/shots.mjs [page…]` (1440 px and 390 px, dark and light) and look at the images in
  `/tmp/nexus-e2e/shots/design/`. Compare with the kit / Apple TV, fix the differences.

## Workflow

- Branch `claude/eloquent-darwin-19tvre`; PR to `main`, green CI, squash-merge without asking.
- Checks: `python3 -m unittest discover downloaders`, backend `npm test` (see e2e/setup.sh for the
  test database), `npm run e2e`, frontend `npx tsc --noEmit && npx eslint src --quiet && npx vitest run`.
- Never show secrets (.env). `/media/scripts` holds the owner's original scripts: never modify them.
