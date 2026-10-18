# JARVIS desktop design

Ambient voice-assistant surface for one technical operator: dark, quiet, instrument-grade. The
film JARVIS feel comes from restraint, not HUD decoration. Tokens live in
[styles.css](src/renderer/styles.css); this file records the rules behind them.

## Source

Token base: the ElevenLabs DESIGN.md from awesome-design-md (MIT), which is light-only. The dark
theme below is derived from its stone neutrals and its pastel "atmospheric orb" accents. Only the
design language is borrowed; no brand name, logo, copy or asset is used. Reference images were
not generated (no image-generation credits were available).

## Tokens

| Role | Value |
| --- | --- |
| Canvas | `#0c0a09` |
| Surface (cards, sheet) | `#1c1917` |
| Hairline / strong hairline | `#292524` / `#44403c` |
| Ink / soft ink | `#f5f5f4` / `#a8a29e` |

State colour is the only accent and is never decorative. It drives the presence rings, the status
word and a faint atmospheric glow:

| State | Colour | Motion |
| --- | --- | --- |
| idle | stone `#a8a29e` | slow breath |
| listening | mint `#a7e5d3` | rings follow microphone level |
| thinking | sky `#a8c8e8` | slow spin with a travelling shimmer |
| speaking | lavender `#c8b8e0` | ripples follow reply audio |
| approval | peach `#f4c5a8` | deeper breath |
| error | rose `#e8b8c4` | nearly still, dimmed |

## Type, shape and icons

- Inter Variable for interface text; EB Garamond Variable for the wordmark and JARVIS captions
  (the serif substitutes for the source's display face and marks JARVIS's own voice). The
  operator's words appear in Inter, soft ink.
- Radii: full pills for buttons, 16 px cards, 8 px inputs. Hairline borders.
- Phosphor light icons, bundled as SVG text. Fonts and icons ship locally; the CSP allows no
  remote origin.

## Layout and motion

- One focal point: the presence, centred; cards slide in at the right and shift it left.
  The dock holds only the listening control and its shortcut. Settings is a right-hand sheet.
- Motion is state, not ornament. Rings are WebGL hairlines; colour transitions use a typed
  `--state` custom property. Reduced motion freezes the presence and removes transitions.
- All text meets 4.5:1 contrast on its surface; the UI tests measure it.
