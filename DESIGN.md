---
name: GodEyes Scene Workbench
description: A bright, quiet work surface for photographs, reviewed imagery, and generated space.
colors:
  workbench-paper: "#f5f7f8"
  workbench-white: "#fff"
  workbench-field: "#edf4f6"
  workbench-blue: "#e8f3f9"
  workbench-green: "#eaf3eb"
  workbench-ink: "#18282b"
  workbench-muted: "#526165"
  workbench-rule: "#9aadb2"
  workbench-focus: "#a7b6ba"
  workbench-selected: "#d7eaf0"
  workbench-action: "#234f5c"
  workbench-action-hover: "#126677"
  incumbent-paper: "oklch(0.155 0.008 62)"
  incumbent-paper-2: "oklch(0.225 0.011 62)"
  incumbent-ink: "oklch(0.9 0.008 82)"
  incumbent-ink-2: "oklch(0.63 0.012 82)"
  incumbent-ox: "oklch(0.42 0.13 28)"
  incumbent-steel: "oklch(0.32 0.028 235)"
  incumbent-sand: "oklch(0.42 0.07 78)"
  incumbent-bone: "oklch(0.2 0.009 62)"
  incumbent-rule: "oklch(0.36 0.012 62)"
  incumbent-ink-hi: "oklch(0.96 0.01 82)"
  explorer-accent: "#b9f7ce"
typography:
  body:
    fontFamily: '"Archivo", "Noto Sans TC", system-ui, sans-serif'
  caption:
    fontFamily: '"Archivo", "Noto Sans TC", system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 400
  step:
    fontSize: "15px"
    fontWeight: 400
  action:
    fontSize: "14px"
    fontWeight: 400
  description:
    fontSize: "clamp(17px, 1.7vw, 24px)"
    lineHeight: 1.7
  incumbent-display:
    fontFamily: '"Archivo", "Noto Serif TC", Georgia, serif'
  incumbent-hand:
    fontFamily: '"Caveat", cursive'
  incumbent-mono:
    fontFamily: '"JetBrains Mono", ui-monospace, "SFMono-Regular", monospace'
rounded:
  square: "0px"
spacing:
  2xs: "8px"
  xs: "12px"
  sm: "16px"
  md: "24px"
  lg: "32px"
  xl: "48px"
  2xl: "72px"
components:
  button-primary:
    backgroundColor: "{colors.workbench-action}"
    textColor: "{colors.workbench-white}"
    typography: "{typography.action}"
    rounded: "{rounded.square}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.workbench-action-hover}"
  sheet:
    backgroundColor: "{colors.workbench-white}"
    textColor: "{colors.workbench-ink}"
    rounded: "{rounded.square}"
    padding: "24px"
  sheet-image:
    backgroundColor: "{colors.workbench-blue}"
  sheet-world:
    backgroundColor: "{colors.workbench-green}"
  description-field:
    backgroundColor: "{colors.workbench-field}"
    typography: "{typography.description}"
    rounded: "{rounded.square}"
    padding: "24px"
---

# Design System: GodEyes Scene Workbench

## Overview

**Creative North Star: "The Three-Stage Work Surface"**

White, ice blue, and pale green sheets create a continuous, quiet workspace. Small labels and large image areas make the work itself the hierarchy. The user-selected dottxt Products reference informs the desktop scroll behavior; the chosen palette and restrained copy are specific to this workbench.

This document scopes the new visual system to SceneBuilder. Landing and Explorer retain their incumbent palettes, typography, and rendering behavior. The `incumbent-*` and `explorer-accent` tokens record protected existing values from `src/index.css`; they are not replacements for workbench tokens. The workbench's local shell overrides must not move to `:root`.

**Key Characteristics:**

- Bright sheets, square edges, and thin framing.
- Small navigation and captions; no promotional headings.
- Real task states and a manual review step before world generation.

## Colors

Primary action colors are dark teal and its brighter hover state. Pale blue identifies the intermediate-image sheet; pale green identifies the world sheet. White and cool paper establish the surrounding workspace; dark ink and muted text carry its sparse labels.

**The Scope Rule.** Apply the bright palette only to the workbench shell; preserve the incumbent Landing and Explorer tokens.

## Typography

The workbench inherits Archivo with Noto Sans TC for Traditional Chinese. Caption and step roles remain deliberately small; the description field is the largest text treatment. Numeric step labels use tabular numerals. Display, handwriting, and monospace families are documented for incumbent surfaces, not introduced as new workbench treatments.

## Layout

The workbench uses horizontal padding of `clamp(16px, 3vw, 48px)` and a 72px minimum toolbar. Desktop sheets stick 16px from the viewport top, with 56px separation and a minimum height of `min(780px, calc(100svh - 32px))`. The input grid divides description and photographs in a `1fr 1.35fr` ratio with a 24px gap.

At 700px and below, sheets return to normal flow, use 16px padding and 24px separation, and stack the input columns. Footers wrap. Thumbnail pairs remain two columns. These composition details belong to this surface, not every page in GodEyes.

## Elevation & Depth

Sheets are flat and framed by thin borders. Overlap during desktop scrolling creates depth without card shadows. The only workbench glow belongs to the animated scanning line (`0 -16px 32px 8px #59bedb40`), where it communicates active processing. Reduced motion disables workbench animations and transitions and holds the scan line at the midpoint.

## Shapes

Square corners and 1px borders define sheets, prompt fields, and image controls. The upload target uses a dashed border. Large rectangular image areas carry the visual weight; controls remain compact and rectangular.

## Components

- **Actions:** Dark teal buttons with white labels, 46px minimum height, and a brighter hover fill. Disabled controls inherit 0.4 opacity and a not-allowed cursor. Keyboard focus inherits a 2px rule-colored outline offset by 2px.
- **Navigation:** A back action and three numbered step buttons; the current step receives a pale blue fill. Buttons have a 44px minimum height.
- **Inputs:** Description text sits on a cool field without an inner border. The expandable prompt uses a framed textarea and is editable during review. Placeholder text remains visibly muted.
- **Photo target:** A dashed rectangle with a plus icon, concise format limits, and a blue hover/drag state. Uploaded photographs use a two-column thumbnail grid with individual remove buttons.
- **Sheets:** White input, blue intermediate image, green world. Small captions anchor each sheet and footer actions stay near the bottom.
- **Progress and errors:** Scanning appears only while queued or cleaning. World progress uses the real generating/downloading status; the existing-scene backdrop is explicitly labeled. Errors use a warm, bordered alert.

## Do's and Don'ts

- Do keep the clean image and editable prompt available for manual review before the user chooses generation.
- Do use real task status for loading and completion states.
- Do preserve the incumbent Landing and Explorer tokens and rendering paths.
- Don't add large promotional headings or explanatory card grids to the workbench.
- Don't present the existing-scene loading backdrop as the newly generated world.
- Don't apply the workbench palette globally.
