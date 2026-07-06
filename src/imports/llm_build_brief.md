# LLM Build Brief — Clickable Prototype: In-Platform Written Submissions & Text Review

> **Source ticket:** Jira [MIPU-44](https://mosoas.atlassian.net/browse/MIPU-44) — *Arbeidskrav og tekstredigering*
> **Product:** MOSO InPraxis · **Module:** Supervision (Veiledning)
> **Design system:** Atlassian Design System (Atlaskit) — mandatory
> **Deliverable type:** Interactive, front-end-only prototype for **client verification** (mock data, no backend)

---

## 1. Your task

Build an **interactive, front-end-only prototype** of a written-submission and text-review feature for **MOSO InPraxis**, to be shown to a **client for concept and flow verification**. It must look and feel realistic and allow a full click-through of the happy paths. It does **not** need a backend — use **mock/in-memory data** only.

Optimise for: realistic, polished UI built entirely with Atlassian Design System, and a complete clickable flow across all three user roles.

---

## 2. Hard constraints

- **UI library:** Atlassian Design System — use **Atlaskit** components and **design tokens** throughout. Do not hand-roll styling where an Atlaskit component exists.
- **Stack:** **React + TypeScript**, single-page app (e.g. Vite). No backend, no database, no real auth.
- **Data:** all data is **mock data** in memory / local state, seeded from a single `mockData.ts` file. State resetting on reload is acceptable. **No API/network calls.**
- **Scope:** implement **v1** (Sections 5–8) only. Skip everything in Section 10 "Out of scope".
- This is a **demonstration prototype** — favour visible, clickable behaviour over real persistence, deep validation, or exhaustive edge-case handling.

---

## 3. Context — what the feature is

Students write coursework **directly in the platform** instead of uploading a document. Teachers read the text, **annotate it in place**, leave comments, and **assess** it (approve / reject / request resubmission) — removing the download/re-upload cycle and keeping assessment where the work lives.

**Reference experience:** Canvas **SpeedGrader + DocViewer**. Where behaviour is ambiguous, mirror SpeedGrader.

In production this lives inside the existing **Supervision module** as a submission template. For the prototype you may present it as a standalone demo app.

---

## 4. Roles & permissions

Include a mock **role switcher** in the top bar (no login) so the client can view the same submission as each role:

| Role | Capabilities |
|---|---|
| **Teacher** | Attach a submission task to a student; set a deadline; read submissions; add annotations; add text/audio comments; approve / reject / request resubmission; add a final comment; reopen after assessment; download comments as PDF; view and manage **many submissions at once**. **Only the teacher may assess and set status.** |
| **Student** | Write/edit their own submission in a rich-text editor; submit; view teacher annotations & comments after review; resubmit when requested. |
| **Supervisor** | **Read-only.** Can view the submission and its feedback. **No action controls shown** (no annotate, comment, or status change). |

**Global rules:** assignments target **individual students only** — no group assignments, no collaborative/simultaneous editing.

---

## 5. User stories

1. **Teacher** attaches a submission task (from a template) to an individual student and sets a deadline.
2. **Student** writes a submission directly in a rich-text editor and submits it.
3. **Teacher** opens a submission and adds annotations (point, highlight, text, strikeout) anchored to specific passages.
4. **Teacher** adds overall comments (text or audio) and a final comment, then marks **approved** or **not approved**.
5. **Teacher** requests a resubmission so the student can revise and resubmit.
6. **Teacher** sees a list of all submissions with statuses and manages many at once (SpeedGrader-style), always seeing the **student's name**.
7. **Teacher** reopens an already-assessed submission.
8. **Teacher** downloads the submission comments as a PDF.
9. **Supervisor** opens a submission to read it and the feedback, unable to change anything.

---

## 6. Functional requirements (with Atlaskit mapping)

### 6.1 Submission authoring (Student)
- Rich-text editor for the submission body.
  - **Atlaskit:** `@atlaskit/editor-core` for authoring; `@atlaskit/renderer` for read-only display.
  - Represent content as **ADF (Atlassian Document Format)** JSON (enables anchored annotations and clean rendering).
- Autosave draft (mock: local state); explicit **Submit** action.
- On submit: status becomes `submitted`, or `late` if past the mock deadline.
- After submission the student view is read-only, except when a resubmission is requested.

### 6.2 Annotations (Teacher) — anchored to text ranges
Supported types (v1):

| Type | Behaviour |
|---|---|
| **Point** | Marker at a caret position with an attached note |
| **Highlight** | Colour a selected range, optional note |
| **Text** | Threaded note attached to a selected range |
| **Strikeout** | Strike a selected range, optional note |

- **Atlaskit:** editor **inline-comment / annotation provider** (`@atlaskit/editor-core`) to anchor annotations; render note threads with `@atlaskit/comment`.
- Prototype interaction: selecting text opens a small menu to add an annotation; new annotations appear immediately; seeded annotations are visible on load.
- Each annotation holds: id, type, anchor (range), author, timestamp, optional note, resolved flag.

### 6.3 Comments (overall, not anchored)
- Types v1: **Text** and **Audio**.
  - **Text:** `@atlaskit/comment` + `@atlaskit/textarea` to add.
  - **Audio:** mock a "Record" button that inserts a comment showing a **static audio-player UI** (no real recording).
- Chronological thread showing author name + `@atlaskit/avatar` + timestamp.

### 6.4 Assessment / status (Teacher only)
- Actions: **Approve**, **Reject (Not approved)**, **Request resubmission**.
  - **Atlaskit:** `@atlaskit/button` group — Approve (primary), Request resubmission (subtle/warning), Reject (danger).
  - Confirm Approve/Reject with `@atlaskit/modal-dialog`.
- **Final comment** required before setting approve/reject.
- **Reopen** action after assessment → returns submission to the assessable state.
- Status changes restricted to the teacher role (in the prototype, gated by the role switcher; note in README that production must enforce server-side).
- Applying an action updates lozenges live and shows a success `@atlaskit/flag`.

### 6.5 Submission lifecycle statuses
Two status concepts, kept simple for v1:

**Delivery status** (derived from deadline + student action): `missing`, `late`, `submitted`.
**Assessment status** (teacher-set): `not_assessed`, `resubmission_requested`, `approved`, `not_approved`.

- **Atlaskit `@atlaskit/lozenge`** mapping: `submitted` = default · `late` = moved (yellow) · `missing` = removed (red) · `resubmission_requested` = inprogress (blue) · `approved` = success (green) · `not_approved` = removed (red).
- Teacher sets a **deadline** when attaching the task. **No scale/point grading in v1.**

### 6.6 Multi-submission management (Teacher)
- SpeedGrader-style overview of all submissions for a task.
  - **Atlaskit:** `@atlaskit/dynamic-table` (sortable) for the list; optionally `@atlaskit/side-navigation` for a navigator + detail layout.
  - Columns: **Student name** (always visible), delivery status, assessment status, submitted date, deadline.
  - Selecting a row opens the submission detail; provide **next/previous student** navigation.

### 6.7 Export
- **Download submission comments as PDF** (teacher action). Prototype: a print-friendly view or mock download is acceptable; include student name, submission metadata, and comment thread (annotations optional).

### 6.8 Shared UI
- Page chrome: `@atlaskit/page-header`. Empty states: `@atlaskit/empty-state`. Loading: `@atlaskit/spinner` / skeletons. Notifications & confirmations: `@atlaskit/flag` + `@atlaskit/modal-dialog`.

---

## 7. Screens & suggested layout

```
┌───────────────────────────────────────────────────────────────┐
│ Top bar: MOSO InPraxis   [ Role: Teacher ▾ ]                    │  ← mock role switcher
├───────────────────────────────────────────────────────────────┤
│ Page header: Task title            [Download PDF] [Reopen]      │  ← @atlaskit/page-header, buttons
├──────────────┬────────────────────────────────────────────────┤
│ Submissions  │  Student: <Name>   Status: [Lozenge] [Lozenge]  │  ← avatar + lozenges
│ navigator    │ ┌────────────────────────────────────────────┐ │
│ (students +  │ │ Submission text (renderer + annotation      │ │  ← @atlaskit/renderer + annotations
│  status)     │ │ layer: point / highlight / text / strikeout)│ │
│  ▸ Ola N.    │ │                                             │ │
│  ▸ Kari S.   │ └────────────────────────────────────────────┘ │
│  ▸ ...       │  Comments (text / audio)      @atlaskit/comment  │
│              │  Final comment  [textarea]                       │
│              │  [Approve] [Request resubmission] [Reject]       │  ← @atlaskit/button group
└──────────────┴────────────────────────────────────────────────┘
```

**Screens to build:**
1. **Teacher — Submissions overview** (dynamic-table + lozenges → opens detail).
2. **Submission detail (Teacher)** — header, renderer + annotation layer, comments panel, final comment, assessment actions, reopen, export.
3. **Student view** — editor + submit when open; read-only feedback view after submission.
4. **Supervisor view** — same as teacher detail but **all action controls hidden** (read-only).

---

## 8. Data model / mock data shape

```ts
type DeliveryStatus = 'missing' | 'late' | 'submitted'
type AssessmentStatus = 'not_assessed' | 'resubmission_requested' | 'approved' | 'not_approved'

interface SubmissionTemplate { id: string; title: string; instructions: ADFDoc; createdBy: string }

interface Submission {
  id: string
  templateId: string
  studentId: string
  teacherId: string
  body: ADFDoc                      // ADF JSON
  deliveryStatus: DeliveryStatus
  assessmentStatus: AssessmentStatus
  deadline: string                  // ISO date
  submittedAt: string | null
  finalComment: string | null
  reopened: boolean
}

interface Annotation {
  id: string
  submissionId: string
  authorId: string
  type: 'point' | 'highlight' | 'text' | 'strikeout'
  anchor: unknown                   // range / ADF mark descriptor
  note: string | null
  resolved: boolean
  createdAt: string
}

interface Comment {
  id: string
  submissionId: string
  authorId: string
  kind: 'text' | 'audio'
  text: string | null               // kind = text
  audioUrl: string | null           // kind = audio (mock/static)
  createdAt: string
}

interface User { id: string; name: string; role: 'teacher' | 'student' | 'supervisor'; avatarInitials: string }
```

**Seed (`mockData.ts`):**
- 1 task/template (title + short instructions).
- ~5 students with names, avatar initials, varied delivery + assessment statuses, submitted dates, and one shared deadline.
- For at least 2 students: a full ADF submission body (2–3 realistic paragraphs), 2–3 seeded annotations of mixed types, and a comment thread (text + one audio placeholder).
- 1 teacher and 1 supervisor user.

---

## 9. Acceptance criteria (for the demo)

- [ ] Role switcher toggles Teacher / Student / Supervisor; UI adapts (supervisor is read-only, no action controls).
- [ ] Teacher overview lists students with **name** + status **lozenges**, is sortable, and opens a detail view.
- [ ] Submission text renders from seeded ADF via `@atlaskit/renderer`.
- [ ] Teacher can add each of the 4 annotation types and see them appear on the text; notes render as threads.
- [ ] Teacher can add **text** and **(mock) audio** comments to the chronological thread.
- [ ] Approve / Reject / Request resubmission update status **live** with `modal-dialog` confirmation + success `flag`; final comment required for approve/reject.
- [ ] Reopen and Download-PDF actions are present and give visible feedback (PDF may be a print/mock view).
- [ ] Student can write and submit (status → submitted/late); sees feedback afterward; read-only unless resubmission requested.
- [ ] Student **name** is always visible to the teacher during assessment.
- [ ] Entire UI is built with Atlaskit components + design tokens.

---

## 10. Out of scope (do not build)

- Any backend, database, real auth, or persistence beyond in-memory state.
- Point / scale / rubric grading (approve–reject only).
- Draw and area annotations.
- Collaborative / simultaneous editing; group assignments.
- Video and picture comments; real audio recording (static player UI is fine).
- Real PDF generation (print-friendly / mock download is acceptable).

---

## 11. Assumptions & open questions (resolved for the prototype)

Product left a few points tentative; for the prototype proceed with these assumptions and surface them in the README:
- **Statuses:** limited to the sets in §6.5; teacher sets a deadline. (Final status set to be confirmed with product before production.)
- **Audio comments:** static player UI only; recording/upload/format to be confirmed for production.
- **PDF export:** comment thread only in the mock; confirm whether annotations must be included for production.
- **Swedish-customer requirements:** none incorporated in the prototype; to be confirmed before production build-out.

---

## 12. Deliverable

A runnable prototype:
- `npm install && npm run dev` starts the app.
- A short **README** describing the **role switcher** and the main **click-through path** for the client demo.
- Clean, componentised React + TypeScript using Atlaskit throughout, with all mock data isolated in `mockData.ts`.

---

## 13. References (Canvas SpeedGrader)

- Annotated comments (DocViewer): https://community.instructure.com/en/kb/articles/661165-how-do-i-add-annotated-comments-in-student-submissions-using-docviewer-in-speedgrader
- Change submission status: https://community.instructure.com/en/kb/articles/661167-how-do-i-change-the-status-of-a-submission-in-speedgrader
- Media comments: https://community.instructure.com/en/kb/articles/661180-how-do-i-upload-a-media-file-as-a-comment-in-speedgrader
- Download comments as PDF: https://community.instructure.com/en/kb/articles/661181-how-do-i-download-submission-comments-as-a-pdf-in-speedgrader
