# Usability and accessibility review (v1.0)

Covers SCRUM-17. Target: WCAG 2.1 AA, and completion by a non-specialist in under five minutes without separate instructions.

Reviewed build: the assessment flow on `SCRUM-17-accessibility`, which includes the SCRUM-15 PDF report. Reviewed on 26 September 2026.

## How this was checked

| Method | What it covers | Where |
| --- | --- | --- |
| `axe-core` on every step of the flow | Machine-checkable WCAG 2.1 A/AA failures: names, roles, labels, landmarks, heading order | `frontend/tests/accessibility.test.tsx`, run by `npm test` |
| Contrast maths against the stylesheet | 1.4.3 text contrast, 1.4.11 control boundaries | This document, "Contrast" below |
| Keyboard walkthrough in a browser | 2.1.1 keyboard, 2.4.3 focus order, 2.4.7 visible focus | Manual, desktop and 375&nbsp;px |
| Responsive check at 375×812 | 1.4.10 reflow | Manual |
| Plain-language review | Comprehension, jargon | This document, "Language" |
| Structured scenario walkthrough | Completion without instructions, timing | This document, "Completion time" |

`axe-core` cannot judge contrast in jsdom, so the `color-contrast` rule is disabled in the test and contrast is verified against the stylesheet instead.

## Findings and fixes

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | High | Step numbers in the progress list were `#777d73` on `#151714` — 4.26:1, below the 4.5:1 needed for 10&nbsp;px text | Changed to `#9aa096` (6.73:1) |
| 2 | High | The textarea placeholder was `#898e86` on `#fbfaf5` — 3.20:1 | Changed to `var(--muted)` (5.48:1) |
| 3 | High | Choice and Yes/No buttons were outlined in `--line` `#cdcfc4` — 1.51:1 against the surface, below the 3:1 that WCAG 1.4.11 requires for control boundaries | Added `--control-line: #8e9386` (3.01:1) for interactive controls, leaving `--line` for decorative rules |
| 4 | Medium | No way to skip the masthead; keyboard and screen-reader users walked the header on every step | Added a "Skip to the assessment" link, visible on focus, targeting `#assessment` |
| 5 | Medium | The whole workspace was `aria-live="polite"`, so screen readers re-announced the entire panel on every change | Replaced with a visually hidden `role="status"` that announces "Step N of 4: <name>" and the assessing state; focus still moves to the step heading |
| 6 | Medium | The step heading had `outline: none` on focus, so keyboard users got no indicator when focus moved there | Suppressed only for `:focus:not(:focus-visible)`, with a visible ring for `:focus-visible` |
| 7 | Low | At phone width the character counter collided with the help text under the textarea | `.field-meta` stacks below 560&nbsp;px |
| 8 | Low | The capability panel listed capability names only ("Protected matching · De-identification"), with no explanation | Each capability now shows its approved plain-language description from the rubric |

All eight are fixed on this branch. No high-severity issues remain open for the demo.

## Contrast

Every text and control colour in `app/globals.css`, measured against its own background:

| Element | Ratio | Required | Result |
| --- | --- | --- | --- |
| Step name | 5.87:1 | 4.5:1 | Pass |
| Step number (fixed) | 6.73:1 | 4.5:1 | Pass |
| Completed step | 11.17:1 | 4.5:1 | Pass |
| Eyebrow label | 9.54:1 | 4.5:1 | Pass |
| Sidebar intro | 11.78:1 | 4.5:1 | Pass |
| Progress copy | 6.73:1 | 4.5:1 | Pass |
| Body and help text | 5.48:1 | 4.5:1 | Pass |
| Placeholder (fixed) | 5.48:1 | 4.5:1 | Pass |
| Error text | 7.61:1 | 4.5:1 | Pass |
| Section number | 7.58:1 | 4.5:1 | Pass |
| Score, high risk | 7.61:1 | 3:1 (large) | Pass |
| Score, low risk | 7.55:1 | 3:1 (large) | Pass |
| Capability panel text | 11.78:1 | 4.5:1 | Pass |
| Control borders (fixed) | 3.01:1 | 3:1 | Pass |
| Footer | 15.92:1 | 4.5:1 | Pass |

## Keyboard and screen-reader behaviour

- Every control is reachable and operable with Tab, Enter and Space. There are no custom key handlers to learn, and no keyboard traps.
- Focus is visible everywhere: a 3&nbsp;px brass outline with a 3&nbsp;px offset.
- The first Tab reveals the skip link.
- Moving between steps puts focus on the new step heading, which scrolls it into view.
- Selected options carry `aria-pressed`, and the current step carries `aria-current="step"`.
- Steps not yet reached are `disabled`, so they are skipped in the tab order rather than being focusable dead ends.
- Errors use `role="alert"`; the status region announces step changes and "Assessing your answers."
- Smooth scrolling and panel animation are disabled under `prefers-reduced-motion`.

## Not conveyed by colour alone

The risk level is stated in words ("HIGH RISK", "The proposed use case is high risk"), and colour only reinforces it. Selected choices show a tick mark as well as a filled background. Score factors list their points numerically.

## Language

- Every question that used privacy jargon now carries a plain-language note: what "another organization" means, what counts as data leaving its environment, why combining datasets matters, and what reuse means. "Raw identifiable values" was already explained.
- Capability names are accompanied by the approved rubric copy, so "De-identification" and "Protected matching" are explained rather than assumed.
- The disclaimer says the report is decision support and not legal advice, in both the app and the PDF.
- Wording not changed: the capability copy and risk guidance are approved text from `docs/risk-scoring-rubric-v1.0.md` (SCRUM-6). Any rewording needs product-owner approval.

## Completion time and scenario coverage

Three structured scenarios — partner matching, health data to a vendor, and low-risk internal analytics — were executed end to end against the merged build. All three completed without external instructions, and each produced exactly the score and level the rubric predicts (50 MEDIUM, 100 HIGH, 16 LOW). Full write-up: [usability-scenarios.md](usability-scenarios.md).

Representative completion time is **3.2–3.8 minutes**, modelled from the measured content load (521 words across the flow) plus interaction counts, against a five-minute target. The developer walkthrough ran 2.5–3 minutes per scenario.

These are developer-executed scenarios, which is what the ticket permits as an alternative to user sessions. Independent users remain stronger evidence: `docs/usability-test-script.md` is ready, and the median from those sessions should be added here if they are run.

## Known limitations

- No testing with assistive technology yet: findings come from `axe-core`, the stylesheet and keyboard walkthroughs, not from a VoiceOver or NVDA session with a screen-reader user.
- Automated checks cover roughly a third of WCAG criteria. The rest were reviewed by hand.
- No testing at 200% or 400% browser zoom.
- The button order on the recommendations step reverses at phone width (Start over, Download, Back). It is operable and logical top to bottom, but worth a look if the team revisits that screen.
- Completion-time and scenario evidence comes from developer-executed walkthroughs, not independent users.
