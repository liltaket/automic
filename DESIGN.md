---
name: Automic
description: A compact recording console in warm paper and forest green.
colors:
  primary: "#244f39"
  primary-hover: "#163d29"
  brand: "#214d39"
  paper: "#f4f3ed"
  surface: "#fffef9"
  settings-surface: "#eeefe7"
  mic-surface: "#edf1e6"
  mic-open: "#cce4cf"
  ink: "#263831"
  muted-ink: "#556457"
  intro-ink: "#546359"
  quiet-ink: "#46604b"
  divider: "#d4d9cd"
  field-border: "#aab6a8"
  button-border: "#adb9aa"
  secondary-hover: "#e4eadf"
  focus: "#407554"
  local-surface: "#e1e9dc"
  local-ink: "#305139"
  pending-surface: "#f4e4b2"
  on-primary: "#ffffff"
typography:
  display:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(30px, 3.2vw, 44px)"
    fontWeight: 550
    lineHeight: 1.15
    letterSpacing: "-.035em"
  section-title:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 650
  mic-title:
    fontSize: "22px"
    fontWeight: 550
  decision-title:
    fontSize: "20px"
    fontWeight: 550
  intro:
    fontSize: "16px"
    lineHeight: 1.6
  caption:
    fontSize: "17px"
    lineHeight: 1.55
  body:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  small-title:
    fontSize: "14px"
    fontWeight: 650
  label:
    fontSize: "12px"
    fontWeight: 600
  hint:
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.55
  status:
    fontSize: "10px"
rounded:
  control: "6px"
  notice: "8px"
  tally: "10px"
  console: "14px"
  badge: "20px"
spacing:
  tight: "7px"
  control-block: "10px"
  control-inline: "12px"
  row: "18px"
  compact-panel: "20px"
  section-heading: "22px"
  tally-block: "24px"
  panel: "25px"
  section: "28px"
  intro: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  button-quiet:
    textColor: "{colors.quiet-ink}"
    typography: "{typography.hint}"
    rounded: "{rounded.control}"
    padding: "4px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 11px"
    width: "100%"
  local-badge:
    backgroundColor: "{colors.local-surface}"
    textColor: "{colors.local-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.badge}"
    padding: "7px 12px"
  mic-tally:
    backgroundColor: "{colors.mic-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tally}"
    padding: "24px 10px"
  mic-tally-open:
    backgroundColor: "{colors.mic-open}"
  pending-notice:
    backgroundColor: "{colors.pending-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.notice}"
    padding: "14px"
---

# Design System: Automic

## Overview

**Creative North Star: "The Recording Console"**

A compact operating interface with warm paper surfaces, forest-green controls, and ruled information rows. Mic state, caption text, and the resulting decision have distinct visual roles: a tally, a readable conversation, and a concise verdict.

This document records the implemented simulator system, rather than an approved brand composition. The direction comes from the implementation brief; its descriptive language remains provisional. The simulator is the canonical visual source while the extension palette is brought into alignment.

**Key Characteristics:**

- Warm paper surfaces and a restrained forest-green action accent.
- Flat panels separated by tonal changes and fine rules.
- System sans-serif type with explicit mic-state and decision hierarchy.
- Compact controls, visible focus, and a mobile summary of simulated state.

## Colors

The palette combines green-tinted neutrals with forest-green actions. Frontmatter contains the normative values; color names describe their existing roles.

### Primary

- **Forest Green**: primary buttons and checked controls.
- **Deep Forest**: primary-button hover state.
- **Brand Forest**: the small wordmark tile.
- **Focus Green**: outlines around keyboard-focused controls.

### Neutral

- **Warm Paper**: page background.
- **Light Paper**: main console and field surfaces.
- **Settings Paper**: settings rail, providing a separate working area.
- **Tally Paper**: muted mic tally and compact mobile status.
- **Dark Green Ink**: main text.
- **Muted Green Ink**: supporting text, hints, and explanatory copy.
- **Rule Grey-Green**: structural panel boundaries and dividers.
- **Field and Button Strokes**: stronger edges around interactive controls.

### State Colors

- **Open Mic Green**: simulated open-mic tally. Pair it with explicit state text.
- **Local Green**: the local-only badge.
- **Pending Amber**: a pending notification with its cancellation action.

**The State Text Rule.** Every mic state or pending action carries readable text alongside its color treatment.

## Typography

**Display and Body Font:** the system sans-serif stack in the frontmatter. No external font is required or loaded.

The type is compact and operational. Medium display weights keep the page welcoming; heavier small titles and labels identify controls and sections.

### Hierarchy

- **Display**: introductory headline; fluid size, tight tracking, and a maximum width of (24ch).
- **Mic title**: current microphone state.
- **Decision title**: latest human-readable verdict.
- **Section title**: settings, simulator, and monitor headings.
- **Caption**: transcript text, slightly larger than field text.
- **Body**: inherited field text and ordinary paragraphs. The recorded body line height applies to paragraphs; the root does not impose a global line height.
- **Small title**: scenario and log headings.
- **Label**: field labels and primary controls.
- **Hint**: explanations and log metadata; use the muted ink treatment.
- **Status**: compact ready/unavailable indicator.

## Layout

The simulator uses a centered container with a maximum width of (1440px) and horizontal gutters of (5%). Desktop content begins with a single introduction above a bordered console. The console has a settings rail (230px), flexible conversation area with a minimum width of (280px), and decision rail (290px). Panels use the panel spacing token.

At (1100px) and below, settings narrow to (210px), the conversation minimum becomes (260px), and the monitor moves below both panels in a two-column arrangement. At (640px) and below, the order becomes conversation, monitor, settings. Panels use compact-panel spacing. The mobile status summary sits above the transcript; the header tagline is hidden and the footer stacks.

Use the spacing roles from the frontmatter according to purpose rather than imposing a new uniform grid. Controls use compact padding, section groups use the section gap, and the introduction uses the intro gap. Transcript and log areas scroll independently when they exceed their existing maximum heights of (350px) and (180px).

## Elevation & Depth

The current system has no shadows. Tonal layering, fine borders, and ruled rows provide structure. Hover darkens or tints controls; it does not lift surfaces. Button background changes use a short (150ms) transition. Reduced-motion settings remove transitions.

## Shapes

Controls have gently rounded corners, the mic tally has softer corners, and the containing console has the largest structural radius. A pill-shaped local badge sits apart from the rectangular controls. Borders are thin (1px); panel separators remain straight within the outer console's clipped corners.

## Components

### Buttons

Primary buttons are full-width forest-green bars with white labels. Secondary controls are transparent with a visible stroke and a light-green hover. Scenario buttons are compact secondary controls with (8px 9px) padding and hint-sized text. Quiet actions use underlined green text and minimal padding.

Keyboard-focused buttons and links receive the focus outline (2px) with an offset of (3px). Disabled buttons reduce opacity to (.55) and show a waiting cursor.

### Inputs / Fields

Fields use light-paper surfaces, stronger green-grey strokes, and control corners. Input and select widths fill their available column; the caption textarea resizes vertically. Focus uses the focus-green outline (2px) with an offset of (2px).

### Navigation

The header is a simple wordmark, short supporting sentence, and local-only badge. Its desktop height is (86px), becoming (70px) on mobile. The wordmark uses a compact forest tile and an unadorned text link; keyboard focus remains visible.

### Chips

The local-only badge is a tonal informational pill. Scenario options are buttons, not selectable filter chips; retain their visible button boundaries.

### Cards / Containers

The main console is one light-paper container divided into working regions. Settings use a slightly darker paper surface. Fine borders and ruled rows keep structure visible without shadows.

### Mic Tally and Decision

The mic tally pairs a simple circular symbol with a prominent state label and the explicit simulated-microphone qualifier. The open state changes the surface tone and text. The verdict follows with a readable decision, supporting reason, and ruled metric rows. On mobile, a compact summary repeats mic state and latest decision near the conversation.

### Pending Notice

A pending notice uses amber paper, concise copy, and a full-width cancellation button. This warning treatment is distinct from the green action and mic-state treatments.

## Do's and Don'ts

### Do:

- **Do** use paper tones, green ink, and fine rules to separate working regions.
- **Do** pair state colors with explicit state labels.
- **Do** preserve visible focus outlines and reduced-motion behavior.
- **Do** keep a compact mic-state and decision summary near the mobile conversation.

### Don't:

- **Don't** rely on color alone to distinguish muted, open, or pending states.
- **Don't** remove the simulated-microphone qualifier from simulator state displays.
- **Don't** replace the observed flat panel structure with decorative shadows when extending this system.
