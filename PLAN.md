# Word Matcher — research and implementation plan

Prepared by an AI assistant. Planning only; no application has been implemented or device-tested.

## 1. Recommendation

Build a small, mobile-first SvelteKit game for practising your son's actual school vocabulary. Use Duolingo-style two-column matching as the main activity, with short sessions, gentle feedback, and spaced reviews that favour words he struggles with.

**Optimise for remembering tomorrow, not matching faster today.** Keep the default game untimed. Add a short, skippable recall check so recognition is not mistaken for being able to produce a translation.

Recommended starting scope:

- Svelte + SvelteKit + TypeScript; ordinary HTML buttons and CSS, not a canvas/game engine.
- Dutch interface and Dutch as the starting language, inferred from the supplied schoolwork; configurable target language.
- One child profile on one primary device, no account required.
- German, French, Spanish, and English decks where the supplied material actually contains those translations.
- iPhone/iPad browser support, plus optional Add to Home Screen installation and offline practice after an initial successful load.
- Local progress, parent-managed vocabulary, and export/import backups.

**Important tradeoff:** working on both iPhone and iPad does not mean progress automatically synchronises between them. The recommended local-only release keeps progress separately in each browser/install. If your son will regularly switch devices and needs one shared history, include the sync option in section 7 before launch.

## 2. Existing material and content risks

The project currently contains four textbook photographs, not an existing app. They show verbs, nouns (across two photos), and adjectives, with Dutch and several foreign-language columns. These are a better starting point than a generic vocabulary catalogue.

Create reviewed decks from these photos, grouped by chapter, word type, and language pair. Do not build OCR infrastructure for four photos: transcribe once, check carefully, then offer a simple editor and tab-separated paste for subsequent lists.

Content rules:

- Assign stable IDs to meanings/senses, not just display strings.
- Preserve accents, apostrophes, German capitalisation, articles, and meaningful multiword phrases.
- Allow alternate translations and short context labels.
- Missing language entries remain missing; do not invent translations to fill a grid.
- Flag uncertain handwriting and questionable printed forms for parent/teacher review. Do not silently change what a school test expects.
- Distinguish overlapping senses. The verb sheet includes `ser` and `estar`, and overlapping Dutch/French/German translations. A board must not offer two visually indistinguishable answers that are both linguistically valid.
- Prevent ambiguous pairs from sharing a board unless visible context makes the distinction clear; use a smaller board if needed.
- Keep the original photos out of public deployment assets. Check permission before publicly distributing textbook-derived decks.

A deck entry should contain: stable sense ID, chapter/tag, part of speech, language-specific text, accepted alternatives, optional article/context, content revision, and review status. A material meaning change invalidates the affected learning history; a punctuation-only edit should not.

## 3. What the research supports

### Matching is a good interaction model, not a complete assessment

A historical description of Duolingo Match Madness shows two columns, tap-to-match translations, and replacement pairs [1]. Borrow that easily understood interaction, not its countdown, XP economy, branding, or exact historic rules. The source describes a 2022 version, not a verified current specification.

Duolingo's own explanation of its learning metric warns that more sessions or more time are not automatically better learning; its metric distinguishes progression from other practice, including Match Madness [2]. This is product context, not proof that our proposed game will improve school results.

**Decision:** short matching rounds, no mandatory timer, no hearts, no streak-loss punishment, no leaderboards. Completion and effort get encouragement; tapping speed does not establish mastery.

### Space practice over time

Cepeda et al.'s meta-analysis covered 317 experiments and found that spacing and the intended retention interval jointly affect later recall [3]. Duolingo describes tracking word-level outcomes and adapting future practice using a forgetting model [4].

**Decision:** bring difficult words back sooner and successful words back later. Start with an inspectable interval ladder, not machine learning. The exact intervals below are product defaults to evaluate, not a scientifically established optimum for this child.

### Recognition and production are different

A small study with 18 university students found that productive retrieval practice was more effective on a productive vocabulary test than receptive retrieval or repetition [5]. It is relevant evidence, but not a child-specific validation of a matching game.

**Decision:** distinguish “recognised in matching” from “recalled without choices.” Reversing the two columns does not turn matching into productive recall. Add a brief “say the translation, then reveal” check; record self-reported results as such, not objectively verified knowledge. If school requires spelling, typed recall becomes a separate requirement rather than something matching can claim to teach.

## 4. Child and parent experience

### Child flow

1. Home: one prominent “Oefenen” button, selected language/deck, and a small explanation of today's practice.
2. Brief introduction of at most two unfamiliar words: show each translation before testing it.
3. Match four pairs in two independently shuffled columns. Use fewer pairs on constrained layouts or for small decks.
4. Continue through roughly three short boards. Target a comfortable 2–4 minute session, not a hard deadline.
5. Offer two or three recall prompts, preferably words that need a stronger check. Child says/thinks the answer, reveals it, then chooses “I knew it” or “Practise again.” Skipping is not a failure.
6. Finish with a positive summary and an optional “one more round.” No automatic endless session.

These session sizes are usability hypotheses to tune after watching your son play.

### Matching interaction

- Tap a tile in either column, then its partner. Tapping the selected tile deselects; tapping another in the same column changes selection.
- Correct: brief visual/text feedback; matched tiles become inactive but retain their layout space.
- Incorrect: gentle feedback, no loss of lives; retain the first tile as the anchor and allow another answer.
- “Help” reveals the anchor's partner, recorded as assisted practice.
- Keep positions stable throughout a board. Shuffle when the next board begins, not while a finger is targeting a tile.
- Finish a whole board before replacing it. This is a deliberate calmer alternative to the continuous-refill Match Madness format.
- Debounce at the state-transition level: rapid taps cannot match a pair twice or submit against a completed board.
- Treat the final forced pair as completion, not evidence of knowledge. Matches with only two alternatives left are also weak evidence.

### Parent area

- Choose language, chapter, and active words; add/edit a pair or paste two tab-separated columns.
- Preview imports and flag missing, duplicate, or ambiguous content before saving.
- See “new,” “needs practice,” “recognised across days,” and separately labelled recall evidence.
- Show actual missed words rather than an unexplained mastery percentage.
- Export/import a versioned backup including vocabulary and progress; confirm before replacing existing data or resetting a deck.
- Use a deliberately separate parent entry point to reduce accidental editing. A local parent gate is not authentication or a security boundary.

## 5. Adaptive learning rules

### What is tracked

Keep recognition progress per learner + sense + language pair. Keep recall progress separately per translation direction and evidence type (self-report, or a future objectively scored typed answer).

For each progress item retain: interval stage, next review time, last practice time, last promotion date, first-attempt successes, mistakes/hints, and the content revision it applies to. Record each resolved exposure with a unique ID, session ID, mode, anchor, chosen answer, outcome, number of choices remaining, and timestamp.

A mismatch is evidence about the **first selected word's attempted match**, not proof that both selected words are unknown. Do not penalise the distractor automatically. Subsequent correction of the same exposure must not erase its initial mistake.

### Selecting a session

Select only from the chosen language/deck and reviewed content:

1. Due and overdue words first, with recent errors/hints prioritised and oldest-due breaking ties.
2. Fill remaining places with up to two new words per session.
3. Use already familiar words as supporting pairs when needed; practising them early does not postpone their actual due date.
4. If everything is current, say so and offer optional practice rather than inventing an overdue workload.

Reserve most of the session for needed review when there is a backlog; introduce no new words when review already fills it. This avoids both endless failure drills and easy-word farming.

### Scheduling defaults

Use review stages with intervals of **1, 3, 7, 14, and 30 days**. At the last stage, continue occasional 30-day reviews rather than retiring the word forever.

- A new or failed word is due the next day. A miss/hint also schedules one in-session revisit after at least three other completed pairs, if the session has room.
- A first-attempt, unassisted correct match with at least three choices remaining is eligible recognition evidence.
- Only a due review on a later local calendar day can advance one stage. A newly introduced word cannot climb the ladder on its introduction day.
- At most one stage promotion per day. In-session retries do not promote; once an error/hint occurs, later successes that day cannot cancel the shortened interval.
- A correct answer reached through help, retries, or near-forced elimination counts as practice but does not advance the stage.
- Weak positive evidence leaves a due review pending; a miss/hint resets it to the one-day stage.
- Show a due word early on a later board when earlier exposure occurred only by elimination; randomise supporting choices.
- Do not penalise slow answers. Interruptions, reading speed, and motor speed are not vocabulary knowledge.
- Separate recall scheduling uses the same conservative spacing principle; self-reported success must remain visibly distinguishable from an objective assessment.

Store timestamps consistently and use a configured learner timezone for day boundaries. Reject duplicate exposure IDs transactionally. Inject time and randomness into the scheduler so boundary behaviour can be tested deterministically.

**Example:** a missed Dutch–German pair returns later in the session and tomorrow. A familiar pair answered correctly on its due review moves to a longer interval. Getting it right repeatedly in the same sitting cannot make it “known for a month.”

## 6. iPhone and iPad requirements

- Two-column responsive layout; cap width on iPad instead of stretching tiles across the whole screen.
- Start with tiles approximately 56 CSS pixels high, at least 44 × 44 CSS pixels for controls, and generous gaps. The 44-pixel target is WCAG's enhanced/AAA guidance, not its AA minimum [6].
- Readable text, wrapping for phrases, no clipped translations, no hover-only controls, no drag requirement.
- Native buttons, visible focus/selection, keyboard support, language attributes on vocabulary, VoiceOver labels, and restrained live feedback.
- Colour plus text/icon feedback; respect reduced motion. Preserve pinch zoom and support enlarged text.
- Use dynamic viewport sizing with safe-area padding so Safari chrome, notches, and the home indicator do not cover controls [7]. Allow scrolling at large text sizes instead of shrinking text to force a fit.
- At normal text size, keep a small portrait board visible without scrolling. Landscape and iPad Split View must remain usable, even if scrolling becomes necessary.
- Optional sound only after a user action; mute always available. No dependence on autoplay, vibration, speech recognition, or installed voices.
- Suspend interaction/timing on backgrounding. Persist resolved outcomes immediately, not just when leaving the page; an interrupted unfinished exposure is not an error.
- Add a web manifest and a SvelteKit service worker. Cache the app shell and reviewed decks, and show when offline use is actually ready [8]. First-ever offline opening cannot work.
- Do not force a service-worker update during a round. Offer the update between sessions and preserve progress through schema upgrades.

Actual-device checks are required: desktop responsive emulation and Playwright WebKit do not fully reproduce iOS Safari or Home Screen behaviour.

## 7. Technical architecture and persistence

### Recommended local-only build

Use the current stable Svelte and SvelteKit versions at implementation time, TypeScript, component-scoped CSS, and `adapter-static` for HTTPS static hosting [9]. Prerender route shells and load browser-owned progress on the client. Do not read IndexedDB during SSR or store learner state in server-wide module variables [10].

Proposed boundaries (new files, not existing code):

| Area | Responsibility |
| --- | --- |
| `src/routes/+page.svelte` | Home and practice selection |
| `src/routes/play/+page.svelte` | Session orchestration, matching, recall, results |
| `src/routes/parent/+page.svelte` | Deck editing, progress, backup/restore |
| `src/lib/components/` | Match board, word tile, feedback, recall prompt |
| `src/lib/learning/` | Pure scheduler, board generation, session transitions |
| `src/lib/content/` | Reviewed seed decks and content validation |
| `src/lib/storage/` | IndexedDB schema, migrations, transactional writes, backups |
| `src/service-worker.ts` | Versioned offline caching and update lifecycle |
| `static/manifest.webmanifest` | Home Screen metadata and app icons |

Use IndexedDB through a small established wrapper such as `idb`. Persist resolved exposures, resulting progress, and session checkpoints together. Keep unsubmitted selection transient. On resume, never replay an outcome twice. Prevent two tabs from simultaneously advancing the same learner's active session.

Safari storage is best-effort by default and can be evicted. WebKit supports requesting persistent storage, but granting it is heuristic, not guaranteed [11]. Therefore:

- Request persistence when supported, but still provide export/import.
- Explain “saved on this device,” including the separate-storage risk across browsers/installs.
- Surface write failures immediately; do not claim progress is saved when a transaction fails.
- Keep existing data intact on invalid imports or failed migrations.
- Keep personal data local by default: no child email, full name, ads, third-party analytics, or uploaded photos.

### If automatic cross-device progress is required

Choose this explicitly before implementing storage-dependent screens:

- Add parent authentication and one child profile without a child email address.
- Use a small managed Postgres/auth service and a server-capable SvelteKit deployment, with ownership checks enforced server-side/database-side.
- Keep IndexedDB for offline play and queue immutable review events with unique IDs.
- Sync on launch/resume and after play when online; show pending/failed sync rather than depending on iOS background sync.
- Deduplicate events and derive progress from a defined chronological ordering. Concurrent same-day offline sessions cannot grant multiple promotions; mistakes retain their scheduling effect.
- Protect parent-edited deck revisions against silent overwrite and provide account deletion/export.
- Release gate: practise offline on both devices, reconnect in either order, and reach the same final progress without duplicates or lost reviews.

This is more engineering and ongoing operational responsibility than a single-device family tool. Do not pretend local storage alone provides it.

## 8. Implementation milestones and acceptance gates

### Milestone 1 — Reviewed content and playable interaction

Create the SvelteKit project, transcribe/review the supplied decks, and implement the untimed matching loop and feedback.

Acceptance:

- Complete a round using real textbook words on an iPhone and iPad.
- Wrong matches, help, deselection, rapid double-taps, long phrases, and tiny decks behave correctly.
- Every board is solvable and unambiguous; accents and word forms are preserved.
- Observe your son playing without coaching. Adjust tile count, wording, and session length before adding reward mechanics.

### Milestone 2 — Learning that persists

Implement the scheduler, separate recall check, IndexedDB persistence, and resumable sessions.

Acceptance:

- A missed word reappears after intervening practice and is due the next day.
- Due successful words move to longer intervals; same-day repetition, hints, and forced final matches do not inflate mastery.
- Languages and recall/recognition evidence do not contaminate each other.
- Reloading or closing after a committed match preserves progress exactly once; interruption does not create a failure.
- A simulated storage failure produces an honest unsaved warning, not silent loss.

### Milestone 3 — Parent workflow and offline deployment

Implement editing/paste import, progress view, backup/restore, static deployment, manifest, and service worker. If shared-device history is chosen, complete the sync option here before acceptance.

Acceptance:

- Parent adds a school list without editing source code.
- Backup restores decks and progress; malformed backup leaves existing data untouched.
- After an online load reports offline readiness, finish and save a session in airplane mode.
- Home Screen launch, browser launch, browser back, refresh, and application updates all work without lost progress.

### Milestone 4 — Device and learning pilot

Run a one- to two-week family pilot. This is a usability/retention check, not a controlled efficacy study.

Acceptance:

- Validate actual iPhone/iPad Safari in portrait/landscape, iPad Split View, large text, reduced motion, VoiceOver, background/resume, and offline/Home Screen operation.
- Use automated unit coverage for scheduler transitions, ambiguity prevention, duplicate events, and persistence boundaries; browser coverage for complete play/edit/restore journeys.
- Ask a small sample of translations without visible choices on a later day, including some words not just practised. Keep parent-observed recall distinct from self-report.
- Assess whether he can start independently, wants to return, and remembers more of his school words later. Fast matching alone is not the success measure.

## 9. Decisions to settle before implementation

These do not block planning; the recommended defaults are explicit:

1. **Age/reading comfort:** start with four pairs and generous text; tune after observing him.
2. **First school language/chapter:** provide selection from the photographed material rather than guessing one target language.
3. **School expectation:** meaning recognition is covered; spoken recall is sampled. If written spelling is assessed, include typed recall and its language-specific answer policy before calling the learning scope complete.
4. **Device use:** recommend one primary device and backups. Choose cloud sync if uninterrupted shared progress across iPhone/iPad is required.

Do not initially add AI-generated translations, automatic photo ingestion, a general language curriculum, competitive leagues, or complex reward currencies. They do not solve the immediate goal: making these school words easier to remember.

## Sources

1. [Duoplanet: historical Match Madness interaction description (2022)](https://duoplanet.com/duolingo-match-madness/). Secondary source; mechanics inspiration only.
2. [Duolingo: Time Spent Learning Well (2024)](https://blog.duolingo.com/time-spent-learning-well/). Product metric rationale, not independent evidence for this game.
3. [Cepeda et al.: Distributed practice in verbal recall tasks (2006)](https://pubmed.ncbi.nlm.nih.gov/16719566/). Research synthesis; abstract reviewed.
4. [Duolingo: How we learn how you learn (2016)](https://blog.duolingo.com/how-we-learn-how-you-learn/). Historical word-level spaced-repetition approach.
5. [Yanagisawa: Receptive and productive word retrieval practice (2016)](https://www.jstage.jst.go.jp/article/katejournal/30/0/30_11/_article). Small adult study; abstract reviewed, child applicability uncertain.
6. [W3C: Target Size (Enhanced), WCAG 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html).
7. [WebKit: safe-area layout guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).
8. [SvelteKit: service workers](https://svelte.dev/docs/kit/service-workers).
9. [SvelteKit: static site generation](https://svelte.dev/docs/kit/adapter-static).
10. [SvelteKit: state management](https://svelte.dev/docs/kit/state-management).
11. [WebKit: storage policy and persistence](https://webkit.org/blog/14403/updates-to-storage-policy/).
