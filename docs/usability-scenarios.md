# Structured usability scenarios (v1.0)

Evidence for the SCRUM-17 criterion that representative scenarios can be completed without external instructions, within five minutes.

Executed against the merged `dev` build (PR #7 and #8 included) on 27 September 2026, in a desktop browser at 1280&nbsp;px and again at 375&nbsp;px. Each scenario was run start to finish through the interface — typing, clicking, reading the result — with no use of developer tools to shortcut a step.

**Who ran these:** the developer (J D), not an independent user. See "Limitations".

## Scenario 1 — Partner record matching

**Situation given:** Your company wants to share customer email addresses with a partner company so both can tell which customers they have in common.

**Answers:** Email addresses · another organization: Yes · raw identifiers exchanged: No · data leaves its environment: Yes · combined with other datasets: No · reused beyond purpose: No · intended use: Customer or record matching

| | Expected | Observed |
| --- | --- | --- |
| Score | 50 (14 + 18 + 12 + 6 per rubric v1.0) | **50** |
| Level | MEDIUM | **MEDIUM** |
| Guidance | Proceed only after controls and review | As expected |
| Capability fit | Protected matching offered | **Protected matching, data minimization, governance policy execution** (3 controls, each with its approved description) |
| Safeguards | Base set | **5 recommendations** |
| Report | PDF downloads | As expected |

**Completed without instructions:** yes. Nothing in the flow required knowledge outside the screen.

## Scenario 2 — Health data to an outside vendor

**Situation given:** You plan to send patient health survey responses to an outside analytics vendor so they can train a model predicting missed appointments.

**Answers:** Health information · all five risk questions: Yes · intended use: AI model training or development

| | Expected | Observed |
| --- | --- | --- |
| Score | Capped at 100 (raw total 110) | **100** |
| Level | HIGH | **HIGH** |
| Factors | All seven applicable rules listed | **7 factors, each with its points** |
| Limitation | HIPAA specialist-review note | Shown |
| Guidance | Pause implementation | As expected |

**Completed without instructions:** yes.

## Scenario 3 — Internal analytics, low risk

**Situation given:** Your own team wants to count how many customers used the mobile app last month, using data already in your internal warehouse.

**Answers:** Names · all five risk questions: No · intended use: Internal analytics

| | Expected | Observed |
| --- | --- | --- |
| Score | 16 (14 + 2) | **16** |
| Level | LOW | **LOW** |
| Guidance | Standard safeguards likely sufficient | As expected |
| Capability fit | Only the always-applicable controls | As expected |

**Completed without instructions:** yes. This scenario confirms a low-risk case is not over-flagged.

## Completion time

Measured content load across the flow, at 1280&nbsp;px:

| Step | Words to read | Interactions |
| --- | --- | --- |
| Orientation sidebar | 40 | 0 |
| 01 Describe | 77 | type a description |
| 02 Answer questions | 185 | 7 selections |
| 03 Assessment | 77 | 1 |
| 04 Recommendations | 142 | 1 (download) |
| **Total** | **521** | **~10** |

At an average adult reading speed of 200–250 words per minute, reading everything takes **2.1–2.6 minutes**. Add roughly 45 seconds to compose a two-sentence description and about 30 seconds for the ten interactions, and a representative completion lands at **3.2–3.8 minutes** — inside the five-minute target, with margin for a user who re-reads a question.

The observed developer walkthrough took about 2.5–3 minutes per scenario, consistent with the estimate but faster, as expected from someone who already knows the questions.

## What the scenarios surfaced

- The flow is self-explanatory step to step: each screen states what to do, and the primary action is always bottom-right (full width at phone size).
- Scoring matched the rubric exactly in all three scenarios, so what the interface shows is trustworthy against rubric v1.0.
- The capability panel is markedly clearer since each control gained its approved description; in scenario 1 a reader sees what "protected matching" actually means rather than a bare label.
- No dead ends: every step can be left forwards or backwards, and "Start over" clears everything.

## Limitations

- **These are developer-executed scenarios, not user research.** The person running them wrote much of the interface and cannot be surprised by it. Independent users would be stronger evidence; `docs/usability-test-script.md` is ready for those sessions and the median should be added here when they happen.
- Completion time is modelled from measured content load plus observed interaction counts, not stopwatch data from independent participants.
- No assistive-technology session and no 200%/400% zoom testing; both are recorded in `docs/accessibility-review.md`.
