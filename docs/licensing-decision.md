# Licensing decision record — M0

**Decision date:** 2026-11-07
**Status:** decided for the open-source release; implementation documents are
drafts pending legal review.
**Scope:** all code in this repository, including the vendored Zenith core
(MIT, copyright notice retained in `LICENSE`).

## Decision

1. **`LICENSE` stays MIT. No file-license change is made in M0.**
2. An **optional, additive commercial agreement** is offered for private
   delivery engagements. It is described in [`COMMERCIAL.md`](../COMMERCIAL.md).
3. A **contributor agreement** (`CLA.md`, draft) plus DCO sign-off governs
   incoming contributions, so privately commissioned extensions can be offered
   with clean provenance.
4. The AetherFlow name and mark are **reserved** and are not part of the MIT
   grant.

## Why MIT, not BUSL / AGPL / open core

- The product's differentiation is **"your data never leaves your device"**,
  not a set of enterprise-only features. There is no natural feature boundary
  to put behind a commercial license.
- What is sold is custom delivery, support, warranty and a defined acceptance
  boundary. Those are services and commitments, not a software license. A
  source-available license would not improve that offering.
- BUSL 1.1 / AGPL would make individual users, evaluators and security
  reviewers hesitate, which directly works against adoption of a tool whose
  main pitch is trust.
- Open core would create two products and a permanent incentive to keep the
  free kernel artificially weak. M0 explicitly rejects that split.

## The legal constraint we are not pretending away

MIT already grants the right to use, copy, modify, merge, publish, distribute,
sublicense **and sell** the software. A "commercial license" cannot re-sell
those same rights. Therefore the commercial agreement is written as an
**additive** contract (warranty, indemnity, support, trademark, commissioned
work terms) and never as a replacement license. Anyone using the code
commercially under MIT owes nothing and signs nothing.

Existing MIT releases stay MIT. A future license change could only apply to
new code, would need a new decision record, and would need contributor consent
for any contribution it wants to relicense — which is why `CLA.md` exists.

## Rejected alternatives (kept here so we do not re-litigate them)

| Option | Why rejected |
| --- | --- |
| BUSL 1.1 with a change date | Adds friction for individuals and reviewers; protects a hosted competitor that does not exist here. |
| AGPL / GPL family | Network clause is irrelevant to a zero-backend static site; conflicts with the vendored-core statement. |
| Open core (free community / paid enterprise features) | Creates a second product and a reason to weaken the free one. |
| Pure "portfolio piece, not a product" | Contradicted the offer of private delivery work; removed in M0. |

## Before publishing — checklist

- [ ] Counsel reviews `CLA.md` and the optional commercial agreement wording.
- [ ] Replace the placeholder contact in `COMMERCIAL.md` with a real entity.
- [ ] Confirm the trademark statement matches how the name will actually be used.
- [ ] Confirm `CONTRIBUTING.md` tells contributors about DCO sign-off.
- [ ] `LICENSE` copyright holder line is correct and final.
