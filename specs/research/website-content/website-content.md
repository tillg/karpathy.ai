---
title: "Website content: use cases, demo vault, screenshots"
created: 2026-10-02
edited: 2026-10-02
---

# Website content: use cases, demo vault, screenshots

Working list for the website at https://karpathy.app. Mark your picks with `[x]` and add notes inline.

**TL;DR:**

- **16 use cases** below, each with a sample prompt and a check against what the app really does today (no web
  access, no shell for the AI: it works on the notes in the vault and on what you paste into the chat). 11 work
  today, 5 need a skill in the vault or come with a caveat. New: **16, plan a ski tour from your own notes**.
- **11 demo-vault topics**, to choose one from. The demo vault becomes a public repo (`tillg/karpathy-app-demo-vault`)
  and the source of both screenshots.
- **Recommendation:** pick 5–6 use cases for the page (my favourites are marked ★), and a demo vault topic that makes
  those use cases look natural. Then I build the vault and take the screenshots in the prod app.

## 1. Use cases

Columns: **Works today** = yes with the app as built; *skill* = needs a skill (`SKILL.md`) or `AGENTS.md` instruction
in the vault, which the demo vault can ship; *caveat* = works, with a limitation the page must not hide.

### Capture and ingest

- [ ] **1. Turn a pasted article into wiki pages** ★
  - You paste an article (or save it into `Sources/`) and say: *"Ingest this: write a source summary and update the
    entity and concept pages it touches."*
  - The AI writes `Sources/…`, creates or updates 3–6 `Wiki/` pages, links them with `[[wikilinks]]`, and the chips
    show every file it changed.
  - Works today: *skill* (an `ingest` skill or `AGENTS.md` rules in the vault; fetching a URL itself doesn't work, so
    the text has to be in the vault or the chat).
- [ ] **2. Voice-memo thoughts into a clean note**
  - You dictate into the chat on the phone (iOS dictation): *"Here are my rough thoughts on X — turn them into a note
    under Ideas/ and link it to related pages."*
  - Works today: yes.
- [ ] **3. Meeting or call notes into action items**
  - You paste raw notes: *"Summarise, extract decisions and to-dos, add the to-dos to Projects/X."*
  - Works today: yes.

### Ask your knowledge

- [ ] **4. Ask a question, get an answer with sources** ★
  - *"What do my notes say about X? Cite the pages."* The AI searches the vault, reads the pages, answers with
    `[[links]]` you can tap.
  - Works today: yes (the read chips make the "it really read my notes" point visible).
- [ ] **5. Compare two things across your notes** ★
  - *"Compare A and B based on everything in the wiki and write it up as a synthesis page."*
  - Works today: yes; nice because it creates a new page you can open from the chat.
- [ ] **6. "What did I learn this month?"**
  - *"Go through the sources added since September and write a digest."*
  - Works today: *caveat* — the AI has no git history, so it relies on dates in frontmatter or file names.
- [ ] **16. Plan a ski tour from your own notes** ★ (idea from Till)
  - *"I want to do a ski tour this April. Which regions and tours in my vault haven't I done yet, and which will
    probably still have snow in April?"*
  - The AI combines three kinds of notes: tour pages (region, summit and start altitude, aspect, best months),
    the log of tours already done, and what the sources say about spring snow (altitude, north faces, glaciers). The
    answer is a short list with `[[links]]` to the tours, why each fits, and which ones were excluded.
  - Works today: yes, as long as the facts are in the vault. *Caveat:* no live snow or avalanche report (the AI has
    no web access); the answer is "likely snow by altitude and aspect", not today's conditions.
  - Strong demo: a question no full-text search answers, because it needs a join across pages plus reasoning.
- [ ] **7. Prepare for a conversation**
  - *"I'm meeting Anna tomorrow. Brief me from my notes: who she is, what we discussed, open points."*
  - Works today: yes.

### Keep the wiki healthy

- [ ] **8. Lint the wiki** ★
  - *"Check the wiki: dead links, orphan pages, contradictions, pages without sources."* Report first, then fix on
    request.
  - Works today: *skill* (`lint`); shows the "AI as librarian" angle well.
- [ ] **9. Fix links and structure after a rename**
  - *"I renamed `Wiki/ML` to `Wiki/Machine Learning` — update every link."*
  - Works today: yes.
- [ ] **10. Fill in missing pages**
  - *"Create pages for every red link in Wiki/Topics, using what the sources say."*
  - Works today: yes (red links = "No page 'X' yet" in the app).

### Work on the go

- [ ] **11. Edit on the phone, Obsidian picks it up** ★
  - Fix a note on the train, commit with one tap; it's on the Mac in Obsidian when you get home (same GitHub repo,
    no second sync).
  - Works today: yes; the core promise of the app.
- [ ] **12. Review what the AI changed before it's saved for good** ★
  - The AI's edits stay uncommitted: open the changes list, read the diff, discard what you don't like, then commit
    with an AI-proposed message.
  - Works today: yes; the trust argument ("the AI never commits").
- [ ] **13. Survive a conflict**
  - You edited a note on the phone while Obsidian changed it on the Mac: keep mine / theirs / both, per file.
  - Works today: yes; good for a "built for real life" line, weak as a hero use case.

### Bring your own setup

- [ ] **14. Your skills come along**
  - The `query`, `lint` and `ingest` skills you use with Claude Code in the terminal show up in the chat on the iPad.
  - Works today: *caveat* — only skills that need file tools; anything with Python, shell, web or credentials doesn't
    (see functional.md › Skills).
- [ ] **15. Any model, your keys**
  - Switch the model in settings (Claude, GPT, an open model via OpenRouter, a local one); keys stay on your server.
  - Works today: yes (server-wide setting).

## 2. Demo vault topics

What makes a good demo vault: real-looking `Sources/` and `Wiki/` content, a topic every visitor gets in two
seconds, screenshots that look good (titles, links, a bit of structure), nothing personal, nothing that impersonates a
real person or brand. Size: ~10 sources, ~25 wiki pages, an `AGENTS.md`, two or three skills.

| # | Topic | Sources (examples) | Wiki pages (examples) | Pro | Con |
|---|---|---|---|---|---|
| A | **Coffee** | brewing guides, a podcast transcript note, a café review | beans, origins, brew methods, grinders, a "pour-over vs. AeroPress" comparison | Universally understood, warm, good page titles | Feels like a hobby toy |
| B | **Japan trip** | travel blog posts, booking confirmations, a friend's tips mail | cities, itinerary, restaurants, rail passes, packing list | Shows "life admin", relatable | Booking-style content can look like real personal data |
| C | **AI/ML reading notes** | paper abstracts, talk notes, blog posts | concepts (attention, RLHF), models, labs, timelines | Matches the product's origin and audience | Niche; real people's names → careful |
| D | **Home garden** | seed packets, gardening articles, a forum thread | plants, beds, sowing calendar, pests, a "what to plant in May" page | Visual, seasonal, friendly | Less "knowledge work" |
| E | **Running a small product** | user interviews, support mails, competitor notes | personas, feature ideas, roadmap, decisions | Shows the business value; good for use cases 3, 5, 7 | Looks like a work wiki → privacy questions from visitors |
| F | **History reading project** (e.g. the Roman Republic) | book chapter notes, documentaries, articles | people, events, places, a timeline | Rich linking, great for wikilinks and synthesis | Dry for some visitors |
| G | **Cooking & recipes** | recipe clips, a cooking show note, family recipe card | dishes, techniques, ingredients, a weekly meal plan | Very relatable, good for capture use cases | Many recipe apps exist; less "wiki" |
| H | **Learning a language** (e.g. Italian) | lesson notes, podcast episodes, articles | grammar topics, vocabulary sets, mistakes I make | Shows "AI as tutor on my notes" | Content in two languages may confuse screenshots |
| I | **Personal health & fitness** | training plans, articles on sleep, race reports | workouts, races, sleep, nutrition | Relatable, good dates/progress | Health data feels sensitive even when fake |
| K | **Ski touring** (idea from Till) | guidebook excerpts, blog trip reports, an avalanche-course handout, notes on spring snow | regions (e.g. Stubai, Silvretta, Ortler), one page per tour (frontmatter: region, start/summit altitude, aspect, difficulty, best months, done: date), gear, a tour log | Made for use case 16; frontmatter-rich pages look good in Write mode; real-world question | Alpine niche; must not read like avalanche advice (disclaimer on the page) |
| J | **Board games / a hobby collection** | rule summaries, reviews, game-night notes | games, mechanics, designers, "what to play with 5 people" | Fun, playful, clear structure | Playful may undersell the product |

My take: **K (Ski touring)** now that use case 16 exists: it gives the page one concrete, memorable question, and
use cases 1, 4, 5, 8 and 12 fit it as well (ingest a trip report, compare two tours, lint the tour pages, review the
AI's update to the tour log). Otherwise **A (Coffee)** or **F (History)** for the cleanest screenshots.

## 3. The two screenshots

Taken in the prod app with the chosen demo vault, at device widths matching the website's layout:

1. **iPad, wide layout:** file tree + a wiki page in Write mode (frontmatter block, headings, wikilinks) + the chat
   pane with an answer that cites pages (use case 16, 4 or 5). With the ski-touring vault: a tour page open, the chat
   answering the April question.
2. **iPhone:** the chat right after an ingest or synthesis turn — tool chips for read and changed files and the
   "changed pages" footer (use case 1 or 5); alternatively the changes list with a diff (use case 12).

## Next steps

1. You pick the demo vault topic and the use cases for the page.
2. I write the demo vault content, create the public repo `tillg/karpathy-app-demo-vault` and push it.
3. I attach it to the prod app, run the turns for the screenshots, take and check them.
4. I add the screenshots and the chosen use cases to `site/`, test, and deploy.
