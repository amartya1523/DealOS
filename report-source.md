# DealOS UX and Motion Research

Audience: DealOS product team  
Date: 2026-09-05

## Scope and assumptions

This research translates the supplied 13-page DealFlow360 problem statement and the current React/TypeScript + GSAP implementation into a redesigned public experience and a coherent application theme. The goal is not to imitate the supplied Awwwards reference, but to select interaction patterns that clarify DealOS's quote-to-cash model. The implementation remains within the existing frontend architecture and preserves application functionality.

## Direct answer

DealOS should present one authoritative deal record moving through changing states, rather than four disconnected marketing feature cards. The strongest visual metaphor is a living commercial file: a quote accumulates policy evidence, approval decisions, stock commitments, billing schedules, and customer negotiation without losing its history. The public narrative should therefore move from fragmentation, to a single deal record, to governed decisions, to operational proof. The application should use a quiet neutral canvas, dark ink, and one warm signal accent; semantic status colors must remain separate from brand decoration.

## Product evidence

The supplied problem statement defines the core problem as disconnected approval, inventory, billing, and customer-negotiation records. It requires an end-to-end flow spanning quotation building, automatic approval routing, upsell suggestions, warehouse splitting, hybrid billing, a restricted customer portal, deal-health alerts, and reporting. It also requires a visible eight-step validation flow from login through recorded payment. `backend/docs/PRD.md` refines these requirements into one authoritative commercial history with revision-bound approvals, explainable blended risk, atomic stock reservations, cadence-aware billing, and auditable mutations.

## Interaction findings

- GSAP ScrollTrigger supports scrubbed timelines, pinning, responsive `matchMedia()` conditions, and native-scroll behavior. The redesign should use a small number of composed timelines instead of many unrelated entrance effects. Source: GSAP, “ScrollTrigger,” https://gsap.com/docs/v3/Plugins/ScrollTrigger/
- GSAP's `matchMedia()` collects animations and ScrollTriggers for cleanup when conditions change. This fits the current React implementation and should remain the responsive-motion boundary. Source: GSAP, “gsap.matchMedia(),” https://gsap.com/docs/v3/GSAP/gsap.matchMedia%28%29/
- W3C guidance identifies parallax as potentially harmful non-essential motion and recommends a user control plus support for `prefers-reduced-motion`. DealOS should retain its global pause control and render every section intelligibly without motion. Source: W3C WAI, “Understanding SC 2.3.3: Animation from Interactions,” https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html
- Carbon's data-table guidance positions tables as the right tool when users must locate a specific record and act on it, with search/filter tools grouped in a toolbar and detailed content progressively disclosed or moved to a dedicated panel/page. This supports DealOS's dense internal workspace while arguing against decorative cards for every record. Source: Carbon Design System, “Data table usage,” https://carbondesignsystem.com/components/data-table/usage/
- SAP's analytical-list guidance organizes operational pages into a filter header plus chart/table content, with a small number of task-relevant KPIs. This supports the current DealOS workspace structure and suggests keeping global KPIs focused instead of turning the application into a marketing dashboard. Source: SAP Fiori, “Analytical List Page Floorplan,” https://experience.sap.com/fiori-design-web/analytical-list-page/
- USWDS recommends step indicators for three or more genuinely linear stages, with a distinct current state, short labels, explicit headings, and separate navigation. The public experience can show DealOS's lifecycle as a status rail, while nonlinear workspace navigation should remain a sidebar. Source: U.S. Web Design System, “Step indicator,” https://designsystem.digital.gov/components/step-indicator/
- Atlassian's color guidance separates accent color from semantic status color, uses neutral surfaces for most UI, and requires non-color cues and adequate contrast. The redesigned system should reserve orange for brand/action, while approval, risk, and fulfillment states use labeled semantic treatments. Source: Atlassian Design System, “Color,” https://atlassian.design/foundations/color

## Design decision

Visual thesis: **the living deal file**. Use warm paper, carbon-black ink, and signal orange with restrained steel-blue information accents. Avoid glossy 3D sculpture, green, purple, and gradient-heavy hero art. The hero visual is an actual DealOS quote interface composed as layered document frames. Scroll depth peels those frames apart, then recombines them into a single governed record. A pinned vertical sequence replaces the previous horizontal flavor-style carousel. Parallax affects only background grids, frame layers, and non-essential labels; content remains stationary enough to read.

## New public flow

1. Hero: one deal record, already useful and visible.
2. Fragmentation: show what changes at each handoff and why records drift.
3. Living record: pinned vertical sequence for quote, govern, allocate, and bill.
4. Proof grid: product-native UI frames for blended risk, warehouse allocation, recurring billing, and customer negotiation.
5. Accountability: compact audit trail and permission story.
6. Final action and footer.

## Limitations

The Excalidraw board is referenced by the source PDF but was not required to change the current interaction model because the implemented repository already contains the functional screens. Browser visual QA is not performed unless explicitly requested; structural and build validation remain required.
