# How the prototype works

A plain-language walkthrough of the flow and the rules behind it. No code, no setup —
just what happens and why.

## The three views

The buttons in the top-right switch between them:

- **Template** — where the wording of the whole form is decided.
- **Teacher** — reads the submission, marks it up, and assesses it.
- **Student** — writes, submits, reads the feedback, revises.

In real use these are different people logging in. Here you switch between them, so you
can watch both sides of the same submission.

## Two statuses that move independently

- **Delivery** — did the work arrive? *Not submitted · Submitted · Late · Excused · Extended*
- **Assessment** — what did the teacher decide? *Not graded · Resubmission requested · Approved · Not approved*

A submitted paper can sit ungraded for a while; an excused student never has to submit at
all. Only the teacher can change the assessment.

## The main flow

1. **The task is assigned.** The student sees the title and the instructions. Delivery
   starts at *Not submitted*.

2. **The student writes and submits.** A word count tracks progress against the minimum.
   Delivery becomes *Submitted*.

3. **The teacher reads and marks up.** Selecting a passage offers three kinds of mark:
   highlight it, strike it out, or replace it with better wording. Each mark can carry a
   note. Marks and notes are collected in a list beside the text — clicking a marked
   passage jumps to its note, and back.

4. **The teacher comments.** Alongside the marks there is a conversation feed for whole-text
   remarks, written or recorded.

5. **The teacher decides.** A final comment is required before approving or rejecting.
   Three outcomes:
   - **Approve** — done.
   - **Not approve** — done, but not passed.
   - **Request resubmission** — the work goes back to the student, and assessment pauses
     until they return. A message can be attached explaining what to fix.

   A decision can be undone, which reopens the assessment.

6. **The student reads the feedback.** Nothing is released until the teacher has acted —
   before that the student only sees "awaiting review". Once released, the marks appear in
   their own text and the notes and comments beside it.

7. **The student revises.** "Revise & resubmit" opens the next version as a private draft:
   a clean copy of what they submitted, without the teacher's marks. Nobody else sees it
   until it is sent. The earlier version can be opened alongside the draft to read the
   feedback while rewriting.

8. **The student resubmits.** The new version becomes the current one; the earlier version
   stays in the list, read-only, still carrying the marks that were made on it.
   Assessment returns to *Not graded* and the teacher reviews again.

9. **The cycle repeats** until the work is approved or not approved.

## Excused and extended

## Late, excused and extended

There are no deadlines here, so nothing is ever flagged automatically. These three are
labels the teacher applies from the grading panel when the situation calls for them:

- **Late** — the work arrived after it should have.
- **Excused** — cancels the request entirely: nothing to submit, nothing to grade, and the
  student is told so.
- **Extended** — the student has been given more time.

## The instructions text

The instructions are written once in the Template view. Both the teacher and the student see
them on the task card, and either can collapse them out of the way — each independently, so
one hiding them does not hide them for the other.

## Why the Template view exists

Every visible word in the form can be rewritten there: buttons, status chips, tabs,
headings, input hints, notices, confirmation dialogs and pop-up messages. Changes take
effect immediately in the Teacher and Student views, so wording — including a different
language — can be tried out and discussed on the spot. "Reset all" puts the original
wording back.

## What is deliberately not real

This is a clickable concept, not a working system:

- **No login.** The view switcher stands in for signing in as different people. In a real
  system, who may do what would be enforced properly, not by hiding buttons.
- **Nothing is saved.** Reloading the page starts over with a fresh, unsubmitted task.
- **The PDF button prints the page**, and the audio player only pretends to play.
- **There are no deadlines.** No due date is set, shown or checked, and nothing changes on
  its own with time. *Late* is a label the teacher chooses, not something the system works
  out.
