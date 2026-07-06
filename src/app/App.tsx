import { useState, useEffect, useRef, ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Role = "teacher" | "student" | "supervisor";
type DeliveryStatus = "missing" | "late" | "submitted" | "excused" | "extended";
type AssessmentStatus =
  | "not_assessed"
  | "resubmission_requested"
  | "approved"
  | "not_approved";
type AnnotationType = "point" | "highlight" | "text" | "strikeout";

interface User {
  id: string;
  name: string;
  role: Role;
  initials: string;
  color: string;
}
// A submission version archived when the student resubmits. Only versions
// that were superseded live here — the current one is on the Submission.
// `outcome` records why the version was sent back.
interface PastVersion {
  n: number;
  body: string;
  submittedAt: string | null;
  outcome: "resubmission_requested" | "rejected";
}
interface Submission {
  id: string;
  studentId: string;
  body: string;
  deliveryStatus: DeliveryStatus;
  assessmentStatus: AssessmentStatus;
  deadline: string;
  submittedAt: string | null;
  finalComment: string | null;
  // Teacher's instruction attached to a resubmission request; shown to the
  // student and cleared when the cycle moves on.
  resubmissionMessage: string | null;
  version: number;
  pastVersions: PastVersion[];
}
interface Annotation {
  id: string;
  submissionId: string;
  version: number;
  type: AnnotationType;
  selectedText: string;
  note: string;
  resolved: boolean;
  createdAt: string;
}
interface Comment {
  id: string;
  submissionId: string;
  authorId: string;
  kind: "text" | "audio";
  text: string;
  createdAt: string;
}
interface Toast {
  id: string;
  type: "success" | "error" | "info" | "warning";
  message: string;
}
type GradingEventAction =
  | "assigned"
  | "submitted"
  | "resubmitted"
  | "resubmission_requested"
  | "approved"
  | "rejected"
  | "grading_undone";
interface GradingEvent {
  id: string;
  submissionId: string;
  actorId: string;
  action: GradingEventAction;
  note: string | null;
  createdAt: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────
const USERS: User[] = [
  { id: "teacher1", name: "Morten Berg", role: "teacher", initials: "MB", color: "#0052CC" },
  { id: "student1", name: "Ola Nordmann", role: "student", initials: "ON", color: "#36B37E" },
  { id: "supervisor1", name: "Ingrid Haug", role: "supervisor", initials: "IH", color: "#97A0AF" },
];

const TASK = {
  title: "Reflection Report — Practicum Week 3",
  instructions:
    "Write a reflection on your practicum experiences this week. Address your professional development, challenges encountered, and learning outcomes. Minimum 400 words.",
};

const SUBS_INIT: Submission[] = [
  {
    id: "sub1",
    studentId: "student1",
    body: "",
    deliveryStatus: "missing",
    assessmentStatus: "not_assessed",
    deadline: "2026-07-05",
    submittedAt: null,
    finalComment: null,
    resubmissionMessage: null,
    version: 1,
    pastVersions: [],
  },
];

const ANNS_INIT: Annotation[] = [];

const COMS_INIT: Comment[] = [];

// The task assignment is the first activity on every submission's timeline.
const EVENTS_INIT: GradingEvent[] = [
  {
    id: "ev1",
    submissionId: "sub1",
    actorId: "teacher1",
    action: "assigned",
    note: null,
    createdAt: "2026-07-01T09:00:00.000Z",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getUser(id: string): User {
  return USERS.find((u) => u.id === id) ?? USERS[0];
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function uid(): string {
  return Math.random().toString(36).slice(2);
}

// One status line per submission version, newest first, e.g.:
//   Version-2  [RESUBMITTED] [NOT GRADED]
//   Version-1 - Submitted - Resubmission requested
// Past versions carry their delivery + outcome as text; the current version's
// line is just the version number — its status lives in the chips rendered
// inline next to it.
function versionLines(sub: Submission): { n: number; label: string; isCurrent: boolean }[] {
  if (!sub.submittedAt) return [];
  const name = (n: number) => (n === 1 ? "Submitted" : "Resubmitted");
  const lines = sub.pastVersions.map((p) => ({
    n: p.n,
    label: `Version-${p.n} - ${name(p.n)} - ${p.outcome === "rejected" ? "Rejected" : "Resubmission requested"}`,
    isCurrent: false,
  }));
  lines.push({
    n: sub.version,
    label: `Version-${sub.version}`,
    isCurrent: true,
  });
  return lines.reverse();
}

// How many version lines a card shows before collapsing the older ones
// behind a "Display previous versions" action.
const VERSION_LINES_VISIBLE = 2;

// Version-aware delivery chip: a resubmitted current version reads
// "Resubmitted" rather than "Submitted".
function deliveryChipStatus(sub: Submission): string {
  return sub.version > 1 && sub.deliveryStatus === "submitted" ? "resubmitted" : sub.deliveryStatus;
}

// HTML for the student's revision editor: the submission text with the
// teacher's annotations embedded as styled spans (note shown as a native
// tooltip), so feedback stays visible inside the editable text. Uses the same
// first-match-per-paragraph anchoring as the read-only renderer. "text"
// annotations render the teacher's replacement (highlighted) in place of the
// original words, exactly as submitted by the teacher; the original is kept
// in the tooltip. Spans carry data-ann-id so the passage can be located,
// flashed, and rewritten from the feedback card while revising.
function annotationEditorHtml(body: string, anns: Annotation[]): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const SPAN_STYLE: Record<AnnotationType, string> = {
    highlight: "background-color:#FF991F33;border-bottom:2px solid #FF991F;",
    strikeout: "text-decoration:line-through;text-decoration-color:#DE350B;background-color:#FFEBE6;",
    text: "background-color:#DEEBFF;border-bottom:2px solid #0052CC;",
    point: "background-color:#EAE6FF;",
  };
  return body
    .split("\n\n")
    .filter(Boolean)
    .map((para) => {
      const hits: { start: number; end: number; ann: Annotation }[] = [];
      for (const ann of anns) {
        if (!ann.selectedText) continue;
        const i = para.indexOf(ann.selectedText);
        if (i !== -1) hits.push({ start: i, end: i + ann.selectedText.length, ann });
      }
      hits.sort((a, b) => a.start - b.start);
      let html = "";
      let pos = 0;
      let lastEnd = 0;
      for (const h of hits) {
        if (h.start < lastEnd) continue;
        html += esc(para.slice(pos, h.start));
        const isTextEdit = h.ann.type === "text" && !!h.ann.note;
        const shown = isTextEdit ? h.ann.note : para.slice(h.start, h.end);
        const tip = isTextEdit
          ? `Replaced by teacher — original: "${h.ann.selectedText}"`
          : h.ann.note || h.ann.type;
        html += `<span data-ann-id="${esc(h.ann.id)}" style="${SPAN_STYLE[h.ann.type]}" title="${esc(tip)}">${esc(shown)}</span>`;
        pos = h.end;
        lastEnd = h.end;
      }
      html += esc(para.slice(pos));
      return `<p style="margin:0 0 16px">${html}</p>`;
    })
    .join("");
}

// Scroll-and-flash focus for annotation cards in a sidebar feed: clicking an
// annotated span in the text scrolls its card into view and highlights it
// briefly. Cards register their DOM node via registerCard(id).
function useAnnCardFocus() {
  const [focusedAnnId, setFocusedAnnId] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!focusedAnnId) return;
    cardRefs.current.get(focusedAnnId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = window.setTimeout(() => setFocusedAnnId(null), 1600);
    return () => window.clearTimeout(t);
  }, [focusedAnnId]);
  const registerCard = (id: string) => (el: HTMLElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  };
  return { focusedAnnId, focusAnn: setFocusedAnnId, registerCard };
}

// Style applied to a feed card while it is flash-focused.
const CARD_FOCUS_STYLE = {
  boxShadow: "0 0 0 2px #4C9AFF",
  backgroundColor: "#DEEBFF",
} as const;

// ─── Atom components ──────────────────────────────────────────────────────────
function Avatar({ userId, size = 32 }: { userId: string; size?: number }) {
  const u = getUser(userId);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: u.color,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.36,
        fontWeight: 600,
        flexShrink: 0,
        letterSpacing: "0.02em",
      }}
    >
      {u.initials}
    </div>
  );
}

const LOZENGE_CFG: Record<string, { bg: string; color: string; label: string }> = {
  submitted:              { bg: "#DEEBFF", color: "#0747A6", label: "Submitted" },
  resubmitted:            { bg: "#DEEBFF", color: "#0747A6", label: "Resubmitted" },
  late:                   { bg: "#FFFAE6", color: "#6B4E00", label: "Late" },
  missing:                { bg: "#FFEBE6", color: "#BF2600", label: "Not submitted" },
  excused:                { bg: "#EAE6FF", color: "#403294", label: "Excused" },
  extended:               { bg: "#E6FCFF", color: "#227D9B", label: "Extended" },
  not_assessed:           { bg: "#F4F5F7", color: "#42526E", label: "Not assessed" },
  not_graded:             { bg: "#FFFAE6", color: "#6B4E00", label: "Not graded" },
  resubmission_requested: { bg: "#EAE6FF", color: "#403294", label: "Resubmission req." },
  approved:               { bg: "#E3FCEF", color: "#006644", label: "Approved" },
  not_approved:           { bg: "#FFEBE6", color: "#BF2600", label: "Not approved" },
};

function Lozenge({ status }: { status: string }) {
  const cfg = LOZENGE_CFG[status] ?? { bg: "#F4F5F7", color: "#42526E", label: status };
  return (
    <span
      style={{
        backgroundColor: cfg.bg,
        color: cfg.color,
        padding: "2px 8px",
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        display: "inline-block",
      }}
    >
      {cfg.label}
    </span>
  );
}

type BtnVariant = "primary" | "default" | "subtle" | "danger" | "warning";
const BTN_STYLES: Record<BtnVariant, { bg: string; color: string; border: string; hoverBg: string }> = {
  primary: { bg: "#0052CC", color: "#fff",     border: "transparent",   hoverBg: "#0747A6" },
  default: { bg: "#FAFBFC", color: "#172B4D",  border: "#DFE1E6",       hoverBg: "#EBECF0" },
  subtle:  { bg: "transparent", color: "#0052CC", border: "transparent", hoverBg: "#DEEBFF" },
  danger:  { bg: "#DE350B", color: "#fff",     border: "transparent",   hoverBg: "#BF2600" },
  warning: { bg: "#FF991F", color: "#172B4D",  border: "transparent",   hoverBg: "#FF8B00" },
};

function Btn({
  variant = "default",
  onClick,
  children,
  disabled,
  small,
  fullWidth,
}: {
  variant?: BtnVariant;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  small?: boolean;
  fullWidth?: boolean;
}) {
  const [hov, setHov] = useState(false);
  const s = BTN_STYLES[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        backgroundColor: disabled ? "#F4F5F7" : hov ? s.hoverBg : s.bg,
        color: disabled ? "#A5ADBA" : s.color,
        border: `2px solid ${s.border === "transparent" ? "transparent" : s.border}`,
        borderRadius: 3,
        padding: small ? "4px 10px" : "7px 14px",
        fontSize: small ? 12 : 14,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background-color 0.1s",
        width: fullWidth ? "100%" : "auto",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        lineHeight: 1.4,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  confirmVariant = "primary",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  confirmVariant?: BtnVariant;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(9,30,66,0.54)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 8,
          padding: 32,
          maxWidth: 480,
          width: "90%",
          boxShadow: "0 8px 40px rgba(9,30,66,0.4)",
        }}
      >
        <h3 style={{ fontSize: 20, fontWeight: 600, color: "#172B4D", marginBottom: 10 }}>
          {title}
        </h3>
        <p style={{ color: "#42526E", marginBottom: 28, lineHeight: 1.6, fontSize: 14 }}>{body}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="default" onClick={onCancel}>
            Cancel
          </Btn>
          <Btn variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  const BG: Record<Toast["type"], string> = {
    success: "#36B37E",
    error: "#DE350B",
    info: "#0052CC",
    warning: "#FF991F",
  };
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: 24,
        zIndex: 2000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            backgroundColor: BG[t.type],
            color: "#fff",
            padding: "12px 16px",
            borderRadius: 4,
            boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            minWidth: 280,
            fontSize: 14,
            pointerEvents: "all",
          }}
        >
          <span style={{ flex: 1, lineHeight: 1.5 }}>{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.8)",
              cursor: "pointer",
              fontSize: 18,
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function AudioPlayer({ label }: { label: string }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          setPlaying(false);
          return 100;
        }
        return p + 1.5;
      });
    }, 80);
    return () => clearInterval(iv);
  }, [playing]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        backgroundColor: "#F4F5F7",
        borderRadius: 4,
        padding: "8px 12px",
      }}
    >
      <button
        onClick={() => {
          if (progress >= 100) setProgress(0);
          setPlaying((p) => !p);
        }}
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          backgroundColor: "#0052CC",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: "#172B4D", marginBottom: 5 }}>{label}</div>
        <div
          style={{
            height: 4,
            backgroundColor: "#DFE1E6",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              backgroundColor: "#0052CC",
              transition: "width 0.08s linear",
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Annotation rendering ─────────────────────────────────────────────────────
const ANN_STYLE: Record<
  AnnotationType,
  { bg: string; underline?: string; strike?: boolean; dot?: boolean }
> = {
  highlight: { bg: "rgba(255,250,230,0.9)", underline: "#FFAB00" },
  text:      { bg: "rgba(222,235,255,0.8)", underline: "#4C9AFF" },
  strikeout: { bg: "transparent", strike: true },
  point:     { bg: "rgba(234,230,255,0.8)", underline: "#6554C0", dot: true },
};

function AnnSpan({
  ann,
  text,
  onClick,
}: {
  ann: Annotation;
  text: string;
  onClick?: (annId: string) => void;
}) {
  const [show, setShow] = useState(false);
  const s = ANN_STYLE[ann.type];
  // For "text" annotations the note is a replacement: show the new text in
  // place of the original, and surface the original in the tooltip.
  const isTextEdit = ann.type === "text" && !!ann.note;
  const displayText = isTextEdit ? ann.note : text;

  return (
    <span style={{ position: "relative", display: "inline" }}>
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={onClick ? () => onClick(ann.id) : undefined}
        title={onClick ? "Show this annotation in the sidebar" : undefined}
        style={{
          backgroundColor: s.bg,
          borderBottom: s.underline ? `2px solid ${s.underline}` : undefined,
          textDecoration: s.strike ? "line-through" : undefined,
          textDecorationColor: s.strike ? "#DE350B" : undefined,
          cursor: onClick ? "pointer" : "help",
          borderRadius: 2,
          padding: "1px 0",
          position: "relative",
        }}
      >
        {s.dot && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: "#6554C0",
              display: "inline-block",
              marginRight: 2,
              verticalAlign: "middle",
            }}
          />
        )}
        {displayText}
      </span>
      {show && ann.note && (
        <span
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 200,
            backgroundColor: "#172B4D",
            color: "#fff",
            padding: "8px 12px",
            borderRadius: 4,
            fontSize: 12,
            lineHeight: 1.6,
            width: 240,
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            display: "block",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "#97A0AF",
              marginBottom: 3,
              fontWeight: 700,
            }}
          >
            {isTextEdit ? "text · replaced" : ann.type}
          </span>
          {isTextEdit ? `Original: "${text}"` : ann.note}
        </span>
      )}
    </span>
  );
}

function renderAnnotatedPara(
  text: string,
  anns: Annotation[],
  onAnnClick?: (annId: string) => void
): ReactNode {
  const hits: { start: number; end: number; ann: Annotation }[] = [];
  for (const ann of anns) {
    if (!ann.selectedText) continue;
    const i = text.indexOf(ann.selectedText);
    if (i !== -1) hits.push({ start: i, end: i + ann.selectedText.length, ann });
  }
  hits.sort((a, b) => a.start - b.start);

  const nodes: ReactNode[] = [];
  let pos = 0;
  let lastEnd = 0;
  for (const h of hits) {
    if (h.start < lastEnd) continue;
    if (h.start > pos) nodes.push(<span key={`t${pos}`}>{text.slice(pos, h.start)}</span>);
    nodes.push(<AnnSpan key={`a${h.start}`} ann={h.ann} text={text.slice(h.start, h.end)} onClick={onAnnClick} />);
    pos = h.end;
    lastEnd = h.end;
  }
  if (pos < text.length) nodes.push(<span key={`t${pos}`}>{text.slice(pos)}</span>);
  return nodes;
}

function AnnotatedText({
  text,
  anns,
  onMouseUp,
  onAnnClick,
}: {
  text: string;
  anns: Annotation[];
  onMouseUp?: (e: React.MouseEvent) => void;
  onAnnClick?: (annId: string) => void;
}) {
  const paras = text.split("\n\n").filter(Boolean);
  if (!paras.length)
    return (
      <p style={{ color: "#6B778C", fontStyle: "italic", fontSize: 14 }}>
        No submission text yet.
      </p>
    );
  return (
    <div onMouseUp={onMouseUp} style={{ userSelect: onMouseUp ? "text" : undefined }}>
      {paras.map((p, i) => (
        <p
          key={i}
          style={{
            marginBottom: 16,
            lineHeight: 1.75,
            color: "#172B4D",
            fontSize: 15,
          }}
        >
          {renderAnnotatedPara(p, anns, onAnnClick)}
        </p>
      ))}
    </div>
  );
}

// ─── Teacher Detail ───────────────────────────────────────────────────────────
function TeacherDetail({
  submissionId,
  submissions,
  annotations,
  comments,
  events,
  onAnnotationAdd,
  onAnnotationEdit,
  onAnnotationDelete,
  onCommentAdd,
  onCommentEdit,
  onCommentDelete,
  onAssessAction,
  onUndoGrading,
  onDeliveryStatusChange,
  onNavigate,
  showAnnHint,
  onDismissAnnHint,
  onToast,
}: {
  submissionId: string;
  submissions: Submission[];
  annotations: Annotation[];
  comments: Comment[];
  events: GradingEvent[];
  onAnnotationAdd: (ann: Omit<Annotation, "id">) => void;
  onAnnotationEdit: (id: string, note: string) => void;
  onAnnotationDelete: (id: string) => void;
  onCommentAdd: (com: Omit<Comment, "id">) => void;
  onCommentEdit: (id: string, text: string) => void;
  onCommentDelete: (id: string) => void;
  onAssessAction: (id: string, action: "approve" | "reject" | "resubmit", fc?: string) => void;
  onUndoGrading: (id: string) => void;
  onDeliveryStatusChange: (id: string, status: DeliveryStatus) => void;
  onNavigate: (dir: "prev" | "next") => void;
  showAnnHint: boolean;
  onDismissAnnHint: () => void;
  onToast: (type: Toast["type"], message: string) => void;
}) {
  const sub = submissions.find((s) => s.id === submissionId)!;
  const student = getUser(sub.studentId);
  // Which version is on screen: null = current, otherwise an archived one
  // (read-only). Annotations are scoped to the version they were made on.
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const viewingPast = viewVersion !== null && viewVersion !== sub.version;
  const shownVersion = viewingPast ? viewVersion! : sub.version;
  const shownBody = viewingPast
    ? sub.pastVersions.find((p) => p.n === viewVersion)?.body ?? sub.body
    : sub.body;
  const subAnns = annotations.filter(
    (a) => a.submissionId === submissionId && a.version === shownVersion
  );
  // Current version's annotations — used by the side-by-side compare view.
  const currentAnns = annotations.filter(
    (a) => a.submissionId === submissionId && a.version === sub.version
  );
  const subComs = comments.filter((c) => c.submissionId === submissionId);
  const subEvents = events
    .filter((e) => e.submissionId === submissionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const subIdx = submissions.findIndex((s) => s.id === submissionId);

  const [activeAnnType, setActiveAnnType] = useState<AnnotationType | null>(null);
  const [annTypePopover, setAnnTypePopover] = useState<{
    x: number;
    y: number;
    selectedText: string;
  } | null>(null);
  const [annPopover, setAnnPopover] = useState<{
    x: number;
    y: number;
    selectedText: string;
  } | null>(null);
  const [annNote, setAnnNote] = useState("");
  const [newComment, setNewComment] = useState("");
  const [finalComment, setFinalComment] = useState(sub.finalComment ?? "");
  const [finalCommentError, setFinalCommentError] = useState(false);
  const [modal, setModal] = useState<
    "approve" | "reject" | "undo" | "excuse" | null
  >(null);
  // What the right sidebar shows, driven by the action bar above the canvas.
  // Activities is the default; annotating is only allowed on Annotations.
  const [sidebarView, setSidebarView] = useState<
    "activities" | "annotations" | "grading" | "resubmission"
  >("activities");
  // Message the teacher writes when requesting a resubmission.
  const [resubMessage, setResubMessage] = useState("");
  const [resubError, setResubError] = useState(false);
  // Inline editing of a feed card (annotation note / comment text).
  const [editing, setEditing] = useState<
    { kind: "annotation" | "comment"; id: string; text: string } | null
  >(null);

  // Clicking an annotated span focuses its card in the sidebar feed. No-op on
  // a previous version — its sidebar shows no cards.
  const { focusedAnnId, focusAnn, registerCard } = useAnnCardFocus();
  const handleAnnTextClick = (annId: string) => {
    if (viewingPast) return;
    setSidebarView("annotations");
    focusAnn(annId);
  };

  useEffect(() => {
    setFinalComment(sub.finalComment ?? "");
    setFinalCommentError(false);
    setActiveAnnType(null);
    setAnnTypePopover(null);
    setAnnPopover(null);
    setSidebarView("activities");
    setResubMessage("");
    setResubError(false);
    setEditing(null);
    setViewVersion(null);
  }, [submissionId]);

  // A new resubmission arrived — jump back to the current version.
  useEffect(() => {
    setViewVersion(null);
  }, [sub.version]);


  // Leaving the Annotations view closes any in-progress annotation popup.
  useEffect(() => {
    if (sidebarView !== "annotations") {
      setAnnTypePopover(null);
      setAnnPopover(null);
      setActiveAnnType(null);
      setAnnNote("");
    }
  }, [sidebarView]);

  // Clicking anywhere outside an annotation popup dismisses it. The note
  // editor stays open once the user has typed, so a stray click can't lose
  // their text — it still closes via its own × / Cancel.
  const typePopoverRef = useRef<HTMLDivElement>(null);
  const notePopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!annTypePopover && !annPopover) return;
    const onMouseDown = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (typePopoverRef.current?.contains(target)) return;
      if (notePopoverRef.current?.contains(target)) return;
      if (annTypePopover) {
        setAnnTypePopover(null);
        window.getSelection()?.removeAllRanges();
      }
      if (annPopover && !annNote.trim()) {
        setAnnPopover(null);
        setActiveAnnType(null);
        setAnnNote("");
        window.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [annTypePopover, annPopover, annNote]);

  // Auto-grow the comment composer to fit its text (capped), and shrink back
  // when it is cleared after sending.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [newComment, sidebarView]);

  // Small text button used for the Edit/Delete/Save/Cancel actions on cards.
  const CardBtn = ({
    label,
    onClick,
    danger,
  }: {
    label: string;
    onClick: () => void;
    danger?: boolean;
  }) => (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 11,
        fontWeight: 600,
        color: danger ? "#DE350B" : "#0052CC",
        padding: "2px 5px",
        borderRadius: 3,
        lineHeight: 1.2,
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = danger ? "#FFEBE6" : "#DEEBFF")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")}
    >
      {label}
    </button>
  );

  // Inline editor shown inside a card while `editing` targets it.
  const EditBox = ({ onSave }: { onSave: (text: string) => void }) => (
    <div>
      <textarea
        value={editing?.text ?? ""}
        onChange={(e) => setEditing((ed) => (ed ? { ...ed, text: e.target.value } : ed))}
        autoFocus
        rows={3}
        style={{
          width: "100%",
          border: "2px solid #4C9AFF",
          borderRadius: 3,
          padding: "6px 8px",
          fontSize: 13,
          resize: "vertical",
          fontFamily: "inherit",
          outline: "none",
          boxSizing: "border-box",
          color: "#172B4D",
          lineHeight: 1.5,
          marginBottom: 6,
        }}
      />
      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
        <CardBtn label="Cancel" onClick={() => setEditing(null)} />
        <CardBtn
          label="Save"
          onClick={() => {
            onSave((editing?.text ?? "").trim());
            setEditing(null);
          }}
        />
      </div>
    </div>
  );

  const canAssess =
    sub.assessmentStatus === "not_assessed" ||
    sub.assessmentStatus === "resubmission_requested";
  const hasBody = shownBody.trim().length > 0;
  // After requesting a resubmission, assessing is paused until the student resubmits.
  const awaitingResubmission = sub.assessmentStatus === "resubmission_requested";
  // Excused cancels the submission request: nothing to submit, nothing to grade.
  const isExcused = sub.deliveryStatus === "excused";
  // Approve/Reject are actionable only with a gradeable submission on hand.
  const canGrade = hasBody && !awaitingResubmission && !isExcused;

  // Chip shown in the info card — reflects the assessment action taken.
  const gradeChip =
    sub.assessmentStatus === "approved"
      ? { label: "Graded", bg: "#E3FCEF", color: "#006644" }
      : sub.assessmentStatus === "not_approved"
      ? { label: "Not approved", bg: "#FFEBE6", color: "#BF2600" }
      : sub.assessmentStatus === "resubmission_requested"
      ? { label: "Resubmission requested", bg: "#EAE6FF", color: "#403294" }
      : { label: "Not graded", bg: "#FFFAE6", color: "#6B4E00" };

  // Mirrors renderAnnotatedPara's anchoring (first indexOf match within a
  // paragraph) to predict where a new selection would land. Overlapping an
  // existing annotation would silently drop one of them at render time, so
  // such selections are blocked up front. Selections that can't be anchored
  // (spanning paragraphs, or inside replaced text) are blocked for the same
  // reason: the annotation would never show up.
  const findSelectionClash = (selText: string): "overlap" | "unanchored" | null => {
    const paras = sub.body.split("\n\n").filter(Boolean);
    const para = paras.find((p) => p.indexOf(selText) !== -1);
    if (!para) return "unanchored";
    const start = para.indexOf(selText);
    const end = start + selText.length;
    for (const ann of currentAnns) {
      if (!ann.selectedText) continue;
      const i = para.indexOf(ann.selectedText);
      if (i === -1) continue;
      if (start < i + ann.selectedText.length && i < end) return "overlap";
    }
    return null;
  };

  const handleTextMouseUp = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;
    // Annotating only works on the Annotations view — nudge, don't switch.
    // In compare mode the sidebar is hidden, so the gate doesn't apply: the
    // current version's pane is directly annotatable there.
    if (!viewingPast && sidebarView !== "annotations") {
      onToast("info", "Click Annotations to annotate");
      return;
    }
    const clash = findSelectionClash(text);
    if (clash) {
      onToast(
        "warning",
        clash === "overlap"
          ? "Selection overlaps an existing annotation — adjust the selection or delete the annotation first"
          : "This selection can't be annotated — select text within a single paragraph"
      );
      window.getSelection()?.removeAllRanges();
      return;
    }
    setAnnTypePopover({ x: e.clientX, y: e.clientY, selectedText: text });
  };

  const handleTypePick = (type: AnnotationType) => {
    if (!annTypePopover) return;
    setActiveAnnType(type);
    setAnnPopover({ x: annTypePopover.x, y: annTypePopover.y, selectedText: annTypePopover.selectedText });
    setAnnTypePopover(null);
  };

  const saveAnnotation = () => {
    if (!annPopover || !activeAnnType) return;
    // A "text" annotation replaces the selected text, so the input is required.
    if (activeAnnType === "text" && !annNote.trim()) {
      alert("Please enter the replacement text.");
      return;
    }
    onAnnotationAdd({
      submissionId,
      version: sub.version,
      type: activeAnnType,
      selectedText: annPopover.selectedText,
      note: annNote,
      resolved: false,
      createdAt: new Date().toISOString(),
    });
    setAnnPopover(null);
    setAnnNote("");
    setActiveAnnType(null);
    window.getSelection()?.removeAllRanges();
  };

  const ANN_COLORS: Record<AnnotationType, string> = {
    highlight: "#FF991F",
    text: "#0052CC",
    strikeout: "#DE350B",
    point: "#6554C0",
  };

  const assessStatusColor =
    sub.assessmentStatus === "approved"
      ? { bg: "#E3FCEF", border: "#57D9A3", text: "#006644", icon: "✓" }
      : sub.assessmentStatus === "not_approved"
      ? { bg: "#FFEBE6", border: "#FF8F73", text: "#BF2600", icon: "✗" }
      : null;

  return (
    <div className="print-flow" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ── Body: main + sidebar ── */}
      <div className="print-flow" style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Left: submission text (always visible) ── */}
        <div
          className="print-flow"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 24,
            minWidth: 0,
          }}
        >
          {/* Info card */}
          <div
            style={{
              backgroundColor: "#fff",
              border: "1px solid #DFE1E6",
              borderRadius: 4,
              padding: "16px 20px",
              marginBottom: 20,
              borderLeft: "4px solid #0052CC",
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#172B4D", marginBottom: 6 }}>
              {TASK.title}
            </h2>
            {versionLines(sub).length === 0 ? (
              <Lozenge status={sub.deliveryStatus} />
            ) : (
              /* Version history — newest first; status chips live on the
                 current version's line; past versions are plain text and open
                 read-only. Older lines collapse behind "Display previous
                 versions". */
              <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-start" }}>
                {(showAllVersions
                  ? versionLines(sub)
                  : versionLines(sub).slice(0, VERSION_LINES_VISIBLE)
                ).map((v) =>
                  v.isCurrent ? (
                    <div key={v.n} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "#172B4D", fontWeight: 600 }}>{v.label}</span>
                      <Lozenge status={deliveryChipStatus(sub)} />
                      <button
                        onClick={() => setSidebarView("grading")}
                        title="Open the Grading tab"
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          padding: "3px 9px",
                          borderRadius: 3,
                          border: "none",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          backgroundColor: gradeChip.bg,
                          color: gradeChip.color,
                        }}
                      >
                        {gradeChip.label}
                      </button>
                    </div>
                  ) : (
                    <button
                      key={v.n}
                      onClick={() => setViewVersion(v.n)}
                      title="Open this version (read-only)"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: 12,
                        color: viewVersion === v.n ? "#0052CC" : "#6B778C",
                        fontWeight: viewVersion === v.n ? 700 : 400,
                        textDecoration: "underline",
                      }}
                    >
                      {v.label}
                      {viewVersion === v.n ? " · viewing" : ""}
                    </button>
                  )
                )}
                {versionLines(sub).length > VERSION_LINES_VISIBLE && (
                  <button
                    onClick={() => setShowAllVersions((s) => !s)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#0052CC",
                    }}
                  >
                    {showAllVersions
                      ? "Hide previous versions"
                      : `Display previous versions (${versionLines(sub).length - VERSION_LINES_VISIBLE})`}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Past-version banner */}
          {viewingPast && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", backgroundColor: "#FFFAE6", border: "1px solid #FFC400", borderRadius: 4, padding: "8px 10px", marginBottom: 20 }}>
              <span style={{ fontSize: 13, flexShrink: 0 }}>🕘</span>
              <p style={{ margin: 0, fontSize: 12, color: "#6B4E00", lineHeight: 1.5, flex: 1 }}>
                Comparing <strong>Version-{viewVersion}</strong> (read-only) with the current{" "}
                <strong>Version-{sub.version}</strong> — select text on the current version to annotate it.
              </p>
              <button
                className="no-print"
                onClick={() => setViewVersion(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#0052CC",
                  whiteSpace: "nowrap",
                  padding: "2px 4px",
                  flexShrink: 0,
                }}
              >
                Back to current version
              </button>
            </div>
          )}

          {/* ── Action bar — picks what the right sidebar shows. Styled after
                 the Atlassian Design System Tabs component: sentence-case
                 labels on a shared divider line, selected tab underlined. ── */}
          <div className="no-print" style={{ display: "flex", alignItems: "center", marginBottom: 20, borderBottom: "2px solid #DFE1E6" }}>
            {([
              { key: "activities", label: "🕘 Activities" },
              { key: "annotations", label: "✎ Annotations" },
              { key: "grading", label: "✓ Grading" },
              { key: "resubmission", label: "↩ Request resubmission" },
            ] as const).map((a) => {
              // Activities and Grading are always available (the teacher can
              // review the timeline or set a status — e.g. Excused — before
              // anything is submitted); the rest need a submission first.
              const disabled =
                viewingPast ||
                (!sub.submittedAt && (a.key === "annotations" || a.key === "resubmission")) ||
                (a.key === "resubmission" && (awaitingResubmission || !canAssess));
              const active = sidebarView === a.key && !disabled;
              const count = subAnns.length + subComs.length;
              return (
                <button
                  key={a.key}
                  disabled={disabled}
                  title={
                    !disabled
                      ? undefined
                      : viewingPast
                      ? "Unavailable while viewing a previous version"
                      : !sub.submittedAt
                      ? "Available once the student has submitted"
                      : awaitingResubmission
                      ? "Already requested — waiting for the student to resubmit"
                      : "The submission has been graded — undo grading first"
                  }
                  onClick={() => setSidebarView(a.key)}
                  onMouseEnter={(e) => {
                    if (!disabled && !active) (e.currentTarget as HTMLElement).style.color = "#0052CC";
                  }}
                  onMouseLeave={(e) => {
                    if (!disabled && !active) (e.currentTarget as HTMLElement).style.color = "#44546F";
                  }}
                  style={{
                    padding: "8px 12px",
                    border: "none",
                    background: "none",
                    cursor: disabled ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    fontSize: 14,
                    fontWeight: 500,
                    lineHeight: 1.4,
                    color: disabled ? "#C1C7D0" : active ? "#0052CC" : "#44546F",
                    borderBottom: active ? "2px solid #0052CC" : "2px solid transparent",
                    marginBottom: -2,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "color 0.1s",
                  }}
                >
                  {a.label}
                  {a.key === "annotations" && count > 0 && (
                    <span style={{ backgroundColor: active ? "#DEEBFF" : "#DFE1E6", color: active ? "#0052CC" : "#42526E", borderRadius: 10, fontSize: 11, padding: "1px 7px", fontWeight: 700 }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Annotation hint — dismissible, only when annotating is possible */}
          {showAnnHint && hasBody && !viewingPast && (
            <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "flex-start", backgroundColor: "#DEEBFF", border: "1px solid #B3D4FF", borderRadius: 4, padding: "8px 10px", marginBottom: 20 }}>
              <span style={{ fontSize: 13, flexShrink: 0, lineHeight: 1.4 }}>💡</span>
              <p style={{ margin: 0, fontSize: 12, color: "#42526E", lineHeight: 1.5, flex: 1 }}>
                To add an annotation, open the <strong>Annotations</strong> tab and select
                the text you want to annotate.
              </p>
              <button
                onClick={onDismissAnnHint}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#0052CC",
                  whiteSpace: "nowrap",
                  padding: "2px 4px",
                  flexShrink: 0,
                }}
              >
                Don't show again
              </button>
            </div>
          )}

          {viewingPast ? (
            /* Side-by-side compare: selected previous version (left) against
               the current version (right), each with its own annotations. */
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6B4E00", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Version-{viewVersion} — previous
                </div>
                <div style={{ backgroundColor: "#fff", borderRadius: 4, border: "1px solid #DFE1E6", borderTop: "3px solid #FFC400", padding: 24 }}>
                  <AnnotatedText text={shownBody} anns={subAnns} />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#0052CC", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Version-{sub.version} — current
                </div>
                <div style={{ backgroundColor: "#fff", borderRadius: 4, border: "1px solid #DFE1E6", borderTop: "3px solid #0052CC", padding: 24 }}>
                  <AnnotatedText text={sub.body} anns={currentAnns} onMouseUp={handleTextMouseUp} />
                </div>
              </div>
            </div>
          ) : hasBody ? (
            <div
              style={{
                backgroundColor: "#fff",
                borderRadius: 4,
                border: "1px solid #DFE1E6",
                padding: 28,
              }}
            >
              <AnnotatedText
                text={shownBody}
                anns={subAnns}
                onMouseUp={handleTextMouseUp}
                onAnnClick={handleAnnTextClick}
              />
            </div>
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: "64px 24px",
                color: "#6B778C",
              }}
            >
              <div style={{ fontSize: 44, marginBottom: 12 }}>📄</div>
              <p style={{ fontSize: 15, marginBottom: 4, color: "#42526E", fontWeight: 500 }}>
                No submission yet
              </p>
              <p style={{ fontSize: 13 }}>{student.name} has not submitted their work.</p>
            </div>
          )}

          {/* Print-only summary — grading, annotations and history stacked in
              reading order after the text (the sidebar is hidden in print). */}
          <div className="print-only" style={{ marginTop: 24 }}>
            {/* Grading */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#172B4D", borderBottom: "1px solid #DFE1E6", paddingBottom: 6, marginBottom: 10 }}>
                Grading
              </div>
              <p style={{ margin: "0 0 4px", fontSize: 12, color: "#172B4D", lineHeight: 1.6 }}>
                Delivery: <strong>{LOZENGE_CFG[deliveryChipStatus(sub)]?.label ?? sub.deliveryStatus}</strong>
                {" · "}Assessment:{" "}
                <strong>
                  {sub.assessmentStatus === "not_assessed"
                    ? "Not graded"
                    : LOZENGE_CFG[sub.assessmentStatus]?.label ?? sub.assessmentStatus}
                </strong>
              </p>
              {sub.finalComment && (
                <p style={{ margin: "0 0 4px", fontSize: 12, color: "#172B4D", lineHeight: 1.6 }}>
                  Final comment: "{sub.finalComment}"
                </p>
              )}
              {sub.resubmissionMessage && (
                <p style={{ margin: 0, fontSize: 12, color: "#172B4D", lineHeight: 1.6 }}>
                  Resubmission message: "{sub.resubmissionMessage}"
                </p>
              )}
            </div>

            {/* Annotations & comments */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#172B4D", borderBottom: "1px solid #DFE1E6", paddingBottom: 6, marginBottom: 10 }}>
                Annotations &amp; comments
              </div>
              {currentAnns.length === 0 && subComs.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: "#6B778C", fontStyle: "italic" }}>None.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {currentAnns.map((ann) => (
                    <div key={ann.id} style={{ fontSize: 12, color: "#172B4D", lineHeight: 1.6, borderLeft: `3px solid ${ANN_COLORS[ann.type]}`, paddingLeft: 8 }}>
                      <strong style={{ textTransform: "uppercase", fontSize: 10, letterSpacing: "0.06em", color: ANN_COLORS[ann.type] }}>{ann.type}</strong>{" "}
                      "{ann.selectedText}"
                      {ann.note && <> — {ann.type === "text" ? `replaced with "${ann.note}"` : ann.note}</>}
                    </div>
                  ))}
                  {subComs.map((com) => (
                    <div key={com.id} style={{ fontSize: 12, color: "#172B4D", lineHeight: 1.6, borderLeft: "3px solid #0052CC", paddingLeft: 8 }}>
                      <strong style={{ textTransform: "uppercase", fontSize: 10, letterSpacing: "0.06em", color: "#0052CC" }}>
                        {com.kind === "audio" ? "Audio" : "Comment"}
                      </strong>{" "}
                      {getUser(com.authorId).name}: {com.text}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Activities */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#172B4D", borderBottom: "1px solid #DFE1E6", paddingBottom: 6, marginBottom: 10 }}>
                Activities
              </div>
              {subEvents.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: "#6B778C", fontStyle: "italic" }}>No activity yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {subEvents.map((e) => {
                    const cfg = {
                      assigned: "Assigned",
                      submitted: "Submitted",
                      resubmitted: "Resubmitted",
                      resubmission_requested: "Requested resubmission",
                      approved: "Approved",
                      rejected: "Not approved",
                      grading_undone: "Undid grading",
                    }[e.action];
                    return (
                      <p key={e.id} style={{ margin: 0, fontSize: 12, color: "#172B4D", lineHeight: 1.6 }}>
                        {fmtDate(e.createdAt)} {fmtTime(e.createdAt)} —{" "}
                        {e.action === "assigned" ? (
                          <>'{TASK.title}' <strong>assigned to {student.name}</strong></>
                        ) : (
                          <><strong>{getUser(e.actorId).name}</strong> {cfg}</>
                        )}
                        {e.note && <> ("{e.note}")</>}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: sidebar (hidden while comparing versions) ── */}
        {!viewingPast && (
        <div
          className="no-print"
          style={{
            width: 340,
            flexShrink: 0,
            borderLeft: "1px solid #DFE1E6",
            backgroundColor: "#fff",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Panel title — the action bar above the canvas picks the view */}
          <div style={{ padding: "11px 16px", borderBottom: "1px solid #DFE1E6", flexShrink: 0, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#42526E" }}>
            {sidebarView === "annotations"
              ? "Annotations & comments"
              : sidebarView === "grading"
              ? "Grading"
              : sidebarView === "activities"
              ? "Activities"
              : "Request resubmission"}
          </div>

          {/* Sidebar content */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
            {!sub.submittedAt && (sidebarView === "annotations" || sidebarView === "resubmission") ? (
              /* Annotating and resubmission requests need a submission;
                 Activities and Grading are available from assignment onwards. */
              <div style={{ padding: "40px 24px", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>⏳</div>
                <p style={{ margin: 0, fontSize: 13, color: "#6B778C", lineHeight: 1.6 }}>
                  Available after {student.name} has submitted their work.
                </p>
              </div>
            ) : sidebarView === "grading" ? (
              <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {/* Submission status — auto from the student, overridable by teacher */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#42526E", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Submission status
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {((sub.submittedAt !== null
                    ? ["submitted", "late", "excused", "extended"]
                    : ["missing", "excused", "extended"]) as DeliveryStatus[]).map((st) => {
                    const active = sub.deliveryStatus === st;
                    const cfg = LOZENGE_CFG[st];
                    return (
                      <button
                        key={st}
                        onClick={() => {
                          // Excusing cancels the submission request — confirm first.
                          if (st === "excused" && !isExcused) {
                            setModal("excuse");
                            return;
                          }
                          onDeliveryStatusChange(sub.id, st);
                        }}
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          padding: "4px 10px",
                          borderRadius: 3,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          border: active ? `2px solid ${cfg.color}` : "2px solid #DFE1E6",
                          backgroundColor: active ? cfg.bg : "#fff",
                          color: active ? cfg.color : "#6B778C",
                        }}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {canAssess ? (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#172B4D", marginBottom: 12 }}>
                    Assess submission
                  </div>
                  {awaitingResubmission && (
                    <div style={{ backgroundColor: "#EAE6FF", border: "1px solid #998DD9", borderRadius: 4, padding: "8px 10px", marginBottom: 12, fontSize: 12, color: "#403294", lineHeight: 1.5 }}>
                      ↩ Resubmission requested — assessment is paused until {student.name} resubmits.
                    </div>
                  )}
                  {isExcused && (
                    <div style={{ backgroundColor: "#EAE6FF", border: "1px solid #998DD9", borderRadius: 4, padding: "8px 10px", marginBottom: 12, fontSize: 12, color: "#403294", lineHeight: 1.5 }}>
                      Excused — the submission request is cancelled. {student.name} doesn't have to
                      submit and no grading is required.
                    </div>
                  )}
                  {!isExcused && !awaitingResubmission && !hasBody && (
                    <div style={{ backgroundColor: "#F4F5F7", border: "1px solid #DFE1E6", borderRadius: 4, padding: "8px 10px", marginBottom: 12, fontSize: 12, color: "#6B778C", lineHeight: 1.5 }}>
                      📝 No submission to grade yet — approve and reject unlock once {student.name} submits.
                    </div>
                  )}
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#42526E", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
                    Final comment <span style={{ color: "#DE350B" }}>*</span>
                  </label>
                  <textarea
                    value={finalComment}
                    onChange={(e) => {
                      setFinalComment(e.target.value);
                      if (finalCommentError && e.target.value.trim()) setFinalCommentError(false);
                    }}
                    placeholder="Required before approving or rejecting…"
                    rows={5}
                    disabled={!canGrade}
                    style={{ width: "100%", border: `2px solid ${finalCommentError ? "#DE350B" : "#DFE1E6"}`, borderRadius: 3, padding: "8px 10px", fontSize: 13, resize: "vertical", fontFamily: "inherit", outline: "none", boxSizing: "border-box", color: "#172B4D", lineHeight: 1.5, backgroundColor: !canGrade ? "#F4F5F7" : "#fff", marginBottom: finalCommentError ? 4 : 12 }}
                    onFocus={(e) => (e.target.style.borderColor = "#4C9AFF")}
                    onBlur={(e) => (e.target.style.borderColor = finalCommentError ? "#DE350B" : "#DFE1E6")}
                  />
                  {finalCommentError && (
                    <p style={{ margin: "0 0 12px", fontSize: 12, color: "#DE350B", lineHeight: 1.4 }}>
                      ⚠ Add a final comment
                    </p>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <Btn variant="primary" fullWidth disabled={!canGrade} onClick={() => { if (!finalComment.trim()) { setFinalCommentError(true); return; } setFinalCommentError(false); setModal("approve"); }}>✓ Approve</Btn>
                    <Btn variant="danger" fullWidth disabled={!canGrade} onClick={() => { if (!finalComment.trim()) { setFinalCommentError(true); return; } setFinalCommentError(false); setModal("reject"); }}>✗ Reject</Btn>
                  </div>
                </div>
              ) : (
                <div>
                  {assessStatusColor && (
                    <div style={{ backgroundColor: assessStatusColor.bg, border: `1px solid ${assessStatusColor.border}`, borderRadius: 4, padding: "12px 14px", marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: sub.finalComment ? 8 : 0 }}>
                        <span style={{ fontSize: 16, color: assessStatusColor.text }}>{assessStatusColor.icon}</span>
                        <span style={{ fontWeight: 700, fontSize: 13, color: assessStatusColor.text }}>
                          {sub.assessmentStatus === "approved" ? "Approved" : "Not approved"}
                        </span>
                      </div>
                      {sub.finalComment && (
                        <p style={{ margin: 0, fontSize: 12, color: "#172B4D", lineHeight: 1.6 }}>{sub.finalComment}</p>
                      )}
                    </div>
                  )}
                  <Btn variant="default" fullWidth onClick={() => setModal("undo")}>
                    ↺ Undo grading
                  </Btn>
                </div>
              )}
              </div>
            ) : sidebarView === "activities" ? (
              /* Activities — timeline of assignment, submissions and grading */
              <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                {subEvents.length === 0 ? (
                  <div style={{ textAlign: "center", paddingTop: 40, paddingBottom: 20 }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>🕘</div>
                    <p style={{ fontSize: 13, color: "#97A0AF", lineHeight: 1.5 }}>No activity yet.</p>
                  </div>
                ) : (
                  /* Newest first — the latest action is what the teacher
                     checks most often. */
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {[...subEvents].reverse().map((e) => {
                      const cfg = {
                        assigned: { label: `assigned to ${student.name}`, color: "#0747A6" },
                        submitted: { label: "Submitted", color: "#0747A6" },
                        resubmitted: { label: "Resubmitted", color: "#0747A6" },
                        resubmission_requested: { label: "Requested resubmission", color: "#403294" },
                        approved: { label: "Approved", color: "#006644" },
                        rejected: { label: "Not approved", color: "#BF2600" },
                        grading_undone: { label: "Undid grading", color: "#6B778C" },
                      }[e.action];
                      const actor = getUser(e.actorId);
                      return (
                        <div key={e.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <Avatar userId={e.actorId} size={22} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: "#172B4D", lineHeight: 1.4 }}>
                              <strong>{e.action === "assigned" ? `'${TASK.title}'` : actor.name}</strong>{" "}
                              <span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
                            </div>
                            <div style={{ fontSize: 10, color: "#97A0AF", marginTop: 1 }}>
                              {fmtDate(e.createdAt)} · {fmtTime(e.createdAt)}
                            </div>
                            {e.note && (
                              <p style={{ margin: "4px 0 0", fontSize: 11, color: "#42526E", lineHeight: 1.5, backgroundColor: "#F4F5F7", borderRadius: 3, padding: "5px 8px" }}>
                                "{e.note}"
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : sidebarView === "resubmission" ? (
              /* Message-first resubmission request */
              <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                {awaitingResubmission ? (
                  <div>
                    <div style={{ backgroundColor: "#EAE6FF", border: "1px solid #998DD9", borderRadius: 4, padding: "8px 10px", marginBottom: 12, fontSize: 12, color: "#403294", lineHeight: 1.5 }}>
                      ↩ Resubmission requested — assessment is paused until {student.name} resubmits.
                    </div>
                    {sub.resubmissionMessage && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#42526E", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
                          Your message
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: "#172B4D", lineHeight: 1.6, backgroundColor: "#F4F5F7", borderRadius: 3, padding: "8px 10px" }}>
                          "{sub.resubmissionMessage}"
                        </p>
                      </>
                    )}
                  </div>
                ) : !canAssess ? (
                  <p style={{ margin: 0, fontSize: 12, color: "#6B778C", fontStyle: "italic", lineHeight: 1.5 }}>
                    The submission has already been graded — undo the grading first to request a resubmission.
                  </p>
                ) : (
                  <div>
                    <p style={{ margin: "0 0 12px", fontSize: 12, color: "#6B778C", lineHeight: 1.5 }}>
                      Ask {student.name} to revise and resubmit their work. The message below is shown to the student together with the request.
                    </p>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#42526E", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
                      Message to the student <span style={{ color: "#DE350B" }}>*</span>
                    </label>
                    <textarea
                      value={resubMessage}
                      onChange={(e) => {
                        setResubMessage(e.target.value);
                        if (resubError && e.target.value.trim()) setResubError(false);
                      }}
                      placeholder={`What should ${student.name} revise?`}
                      rows={5}
                      style={{ width: "100%", border: `2px solid ${resubError ? "#DE350B" : "#DFE1E6"}`, borderRadius: 3, padding: "8px 10px", fontSize: 13, resize: "vertical", fontFamily: "inherit", outline: "none", boxSizing: "border-box", color: "#172B4D", lineHeight: 1.5, backgroundColor: "#fff", marginBottom: resubError ? 4 : 12 }}
                      onFocus={(e) => (e.target.style.borderColor = "#4C9AFF")}
                      onBlur={(e) => (e.target.style.borderColor = resubError ? "#DE350B" : "#DFE1E6")}
                    />
                    {resubError && (
                      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#DE350B", lineHeight: 1.4 }}>
                        ⚠ Add a message
                      </p>
                    )}
                    <Btn
                      variant="warning"
                      fullWidth
                      onClick={() => {
                        if (!resubMessage.trim()) {
                          setResubError(true);
                          return;
                        }
                        setResubError(false);
                        onAssessAction(submissionId, "resubmit", resubMessage.trim());
                        setResubMessage("");
                      }}
                    >
                      ↩ Request resubmission
                    </Btn>
                  </div>
                )}
              </div>
            ) : (() => {
              // Build a unified chronological feed of annotations + comments
              type FeedItem =
                | { kind: "annotation"; data: Annotation; createdAt: string }
                | { kind: "comment"; data: Comment; createdAt: string };

              const feed: FeedItem[] = [
                ...subAnns.map((a) => ({ kind: "annotation" as const, data: a, createdAt: a.createdAt })),
                ...subComs.map((c) => ({ kind: "comment" as const, data: c, createdAt: c.createdAt })),
              ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

              const COM_COLOR: Record<Comment["kind"], string> = {
                text: "#0052CC",
                audio: "#36B37E",
              };

              // WhatsApp-style composer: send text if typed, otherwise record audio.
              const hasText = newComment.trim().length > 0;
              const sendText = () => {
                if (!newComment.trim()) return;
                onCommentAdd({
                  submissionId,
                  authorId: "teacher1",
                  kind: "text",
                  text: newComment,
                  createdAt: new Date().toISOString(),
                });
                setNewComment("");
              };
              const recordAudio = () => {
                onCommentAdd({
                  submissionId,
                  authorId: "teacher1",
                  kind: "audio",
                  text: "Audio comment — 0:30",
                  createdAt: new Date().toISOString(),
                });
              };

              return (
                <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}>
                  <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                  {/* Unified feed */}
                  {feed.length === 0 ? (
                    <p style={{ fontSize: 13, color: "#97A0AF", fontStyle: "italic", textAlign: "center", marginTop: 20, marginBottom: 20 }}>
                      No annotations or comments yet.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                      {feed.map((item) => {
                        if (item.kind === "annotation") {
                          const ann = item.data;
                          const accentColor = ANN_COLORS[ann.type];
                          const isEditingThis = editing?.kind === "annotation" && editing.id === ann.id;
                          return (
                            <div
                              key={ann.id}
                              ref={registerCard(ann.id)}
                              style={{
                                backgroundColor: "#FAFBFC",
                                border: "1px solid #DFE1E6",
                                borderLeft: `3px solid ${accentColor}`,
                                borderRadius: 4,
                                padding: "10px 12px",
                                transition: "box-shadow 0.2s, background-color 0.2s",
                                ...(focusedAnnId === ann.id ? CARD_FOCUS_STYLE : null),
                              }}
                            >
                              {/* Header */}
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                    color: accentColor,
                                    backgroundColor: `${accentColor}14`,
                                    padding: "2px 6px",
                                    borderRadius: 3,
                                  }}
                                >
                                  {ann.type}
                                </span>
                                <span style={{ fontSize: 10, color: "#97A0AF" }}>
                                  {fmtDate(ann.createdAt)}
                                </span>
                              </div>
                              {isEditingThis ? (
                                /* Inline edit: anchor stays read-only, note/replacement is editable */
                                <>
                                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#97A0AF", marginBottom: 2 }}>
                                    {ann.type === "text" ? "Original" : "Selected text"}
                                  </div>
                                  <p style={{ fontSize: 11, color: "#6B778C", fontStyle: "italic", textDecoration: ann.type === "text" ? "line-through" : undefined, margin: "0 0 6px", lineHeight: 1.45, paddingLeft: 8, borderLeft: `2px solid ${accentColor}40` }}>
                                    "{ann.selectedText.slice(0, 80)}{ann.selectedText.length > 80 ? "…" : ""}"
                                  </p>
                                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#97A0AF", marginBottom: 4 }}>
                                    {ann.type === "text" ? "Replaced with" : "Note"}
                                  </div>
                                  <EditBox onSave={(t) => onAnnotationEdit(ann.id, t)} />
                                </>
                              ) : ann.type === "text" ? (
                                /* Text replacement: show original → new */
                                <>
                                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#97A0AF", marginBottom: 2 }}>Original</div>
                                  <p style={{ fontSize: 11, color: "#BF2600", fontStyle: "italic", textDecoration: "line-through", margin: "0 0 6px", lineHeight: 1.45, paddingLeft: 8, borderLeft: `2px solid ${accentColor}40` }}>
                                    "{ann.selectedText}"
                                  </p>
                                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#97A0AF", marginBottom: 2 }}>Replaced with</div>
                                  <p style={{ fontSize: 12, color: "#006644", fontWeight: 500, margin: 0, lineHeight: 1.55, paddingLeft: 8, borderLeft: `2px solid ${accentColor}40` }}>
                                    "{ann.note}"
                                  </p>
                                </>
                              ) : (
                                <>
                                  {/* Quoted text */}
                                  <p
                                    style={{
                                      fontSize: 11,
                                      color: "#6B778C",
                                      fontStyle: "italic",
                                      margin: "0 0 5px",
                                      lineHeight: 1.45,
                                      paddingLeft: 8,
                                      borderLeft: `2px solid ${accentColor}40`,
                                    }}
                                  >
                                    "{ann.selectedText.slice(0, 60)}{ann.selectedText.length > 60 ? "…" : ""}"
                                  </p>
                                  {/* Note */}
                                  {ann.note && (
                                    <p style={{ margin: 0, fontSize: 12, color: "#172B4D", lineHeight: 1.55 }}>
                                      {ann.note}
                                    </p>
                                  )}
                                </>
                              )}
                              {/* Footer: author + actions */}
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                                <Avatar userId="teacher1" size={18} />
                                <span style={{ fontSize: 11, color: "#6B778C" }}>
                                  {getUser("teacher1").name}
                                </span>
                                {!isEditingThis && (
                                  <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                                    <CardBtn
                                      label="Edit"
                                      onClick={() =>
                                        setEditing({ kind: "annotation", id: ann.id, text: ann.note })
                                      }
                                    />
                                    <CardBtn
                                      label="Delete"
                                      danger
                                      onClick={() => {
                                        if (window.confirm("Delete this annotation? Any attached note will be removed too."))
                                          onAnnotationDelete(ann.id);
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        } else {
                          const com = item.data;
                          const accentColor = COM_COLOR[com.kind];
                          const author = getUser(com.authorId);
                          const isEditingCom = editing?.kind === "comment" && editing.id === com.id;
                          return (
                            <div
                              key={com.id}
                              style={{
                                backgroundColor: "#FAFBFC",
                                border: "1px solid #DFE1E6",
                                borderLeft: `3px solid ${accentColor}`,
                                borderRadius: 4,
                                padding: "10px 12px",
                              }}
                            >
                              {/* Header */}
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                    color: accentColor,
                                    backgroundColor: `${accentColor}14`,
                                    padding: "2px 6px",
                                    borderRadius: 3,
                                  }}
                                >
                                  {com.kind === "audio" ? "Audio" : "Comment"}
                                </span>
                                <span style={{ fontSize: 10, color: "#97A0AF" }}>
                                  {fmtDate(com.createdAt)}
                                </span>
                              </div>
                              {/* Body */}
                              {isEditingCom ? (
                                <div style={{ marginBottom: 8 }}>
                                  <EditBox onSave={(t) => onCommentEdit(com.id, t)} />
                                </div>
                              ) : com.kind === "audio" ? (
                                <AudioPlayer label={com.text} />
                              ) : (
                                <p style={{ margin: "0 0 8px", fontSize: 12, color: "#172B4D", lineHeight: 1.6 }}>
                                  {com.text}
                                </p>
                              )}
                              {/* Footer: author + actions */}
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: com.kind === "audio" ? 8 : 0 }}>
                                <Avatar userId={com.authorId} size={18} />
                                <span style={{ fontSize: 11, color: "#6B778C" }}>{author.name}</span>
                                {!isEditingCom && (
                                  <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                                    {com.kind === "text" && (
                                      <CardBtn
                                        label="Edit"
                                        onClick={() =>
                                          setEditing({ kind: "comment", id: com.id, text: com.text })
                                        }
                                      />
                                    )}
                                    <CardBtn
                                      label="Delete"
                                      danger
                                      onClick={() => {
                                        if (window.confirm("Delete this comment?")) onCommentDelete(com.id);
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }
                      })}
                    </div>
                  )}
                  </div>

                  {/* Add comment — pinned to the bottom, always visible */}
                  <div style={{ flexShrink: 0, borderTop: "1px solid #DFE1E6", padding: "12px 16px", backgroundColor: "#fff" }}>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                      <textarea
                        ref={composerRef}
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendText();
                          }
                        }}
                        placeholder="Write a comment…"
                        rows={1}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          border: "2px solid #DFE1E6",
                          borderRadius: 20,
                          padding: "8px 14px",
                          fontSize: 13,
                          resize: "none",
                          minHeight: 38,
                          maxHeight: 120,
                          overflowY: "auto",
                          fontFamily: "inherit",
                          outline: "none",
                          boxSizing: "border-box",
                          color: "#172B4D",
                          lineHeight: 1.5,
                          backgroundColor: "#F4F5F7",
                        }}
                        onFocus={(e) => { e.target.style.borderColor = "#4C9AFF"; e.target.style.backgroundColor = "#fff"; }}
                        onBlur={(e) => { e.target.style.borderColor = "#DFE1E6"; e.target.style.backgroundColor = "#F4F5F7"; }}
                      />
                      <button
                        onClick={() => (hasText ? sendText() : recordAudio())}
                        title={hasText ? "Send comment" : "Record audio comment"}
                        style={{
                          flexShrink: 0,
                          width: 38,
                          height: 38,
                          borderRadius: "50%",
                          border: "none",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: hasText ? "#0052CC" : "#F4F5F7",
                          color: hasText ? "#fff" : "#42526E",
                          transition: "background-color 0.15s, color 0.15s",
                        }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = hasText ? "#0747A6" : "#EBECF0")}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = hasText ? "#0052CC" : "#F4F5F7")}
                      >
                        {hasText ? (
                          /* Send (paper plane) */
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                          </svg>
                        ) : (
                          /* Microphone */
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="23" />
                            <line x1="8" y1="23" x2="16" y2="23" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

          </div>
        </div>
        )}
      </div>

      {/* Type picker popup */}
      {annTypePopover && (
        <div
          ref={typePopoverRef}
          style={{
            position: "fixed",
            left: annTypePopover.x,
            top: annTypePopover.y - 12,
            zIndex: 500,
            transform: "translate(-50%, -100%)",
            backgroundColor: "#fff",
            border: "1px solid #DFE1E6",
            borderRadius: 6,
            padding: "8px 10px",
            boxShadow: "0 4px 20px rgba(9,30,66,0.18)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6B778C" }}>
              Annotation types
            </span>
            <button
              onClick={() => { setAnnTypePopover(null); window.getSelection()?.removeAllRanges(); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#97A0AF", fontSize: 16, lineHeight: 1, padding: "0 2px", fontFamily: "inherit" }}
            >
              ×
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {(["highlight", "strikeout", "text"] as AnnotationType[]).map((type) => {
            const c = ANN_COLORS[type];
            return (
              <button
                key={type}
                onClick={() => handleTypePick(type)}
                title={type === "text" ? "replace text" : type}
                style={{
                  padding: "4px 10px",
                  borderRadius: 3,
                  border: `2px solid ${c}`,
                  backgroundColor: `${c}18`,
                  color: c,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  textTransform: "capitalize",
                  fontFamily: "inherit",
                  transition: "background-color 0.1s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = `${c}35`)}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = `${c}18`)}
              >
                {type === "text" ? "Replace text" : type}
              </button>
            );
          })}
          </div>
        </div>
      )}

      {/* Annotation popover */}
      {annPopover && (
        <div
          ref={notePopoverRef}
          style={{
            position: "fixed",
            left: annPopover.x,
            top: annPopover.y - 12,
            zIndex: 500,
            transform: "translate(-50%, -100%)",
            backgroundColor: "#fff",
            border: "1px solid #DFE1E6",
            borderRadius: 6,
            padding: 14,
            boxShadow: "0 4px 24px rgba(9,30,66,0.2)",
            width: 290,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: ANN_COLORS[activeAnnType!],
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 8,
            }}
          >
            {activeAnnType === "text" ? "Replace text" : `Add ${activeAnnType} annotation`}
          </div>
          <p
            style={{
              fontSize: 12,
              color: activeAnnType === "text" ? "#BF2600" : "#42526E",
              fontStyle: "italic",
              marginBottom: 10,
              backgroundColor: "#F4F5F7",
              padding: "4px 8px",
              borderRadius: 3,
              textDecoration: activeAnnType === "text" ? "line-through" : undefined,
            }}
          >
            "{annPopover.selectedText.slice(0, 70)}
            {annPopover.selectedText.length > 70 ? "…" : ""}"
          </p>
          <textarea
            value={annNote}
            onChange={(e) => setAnnNote(e.target.value)}
            placeholder={activeAnnType === "text" ? "Enter replacement text…" : "Add a note (optional)…"}
            autoFocus
            style={{
              width: "100%",
              border: "2px solid #DFE1E6",
              borderRadius: 3,
              padding: "6px 8px",
              fontSize: 13,
              resize: "none",
              height: 60,
              fontFamily: "inherit",
              outline: "none",
              boxSizing: "border-box",
              marginBottom: 10,
            }}
            onFocus={(e) => (e.target.style.borderColor = "#4C9AFF")}
            onBlur={(e) => (e.target.style.borderColor = "#DFE1E6")}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <Btn
              small
              variant="default"
              onClick={() => {
                setAnnPopover(null);
                setAnnNote("");
                window.getSelection()?.removeAllRanges();
              }}
            >
              Cancel
            </Btn>
            <Btn small variant="primary" onClick={saveAnnotation}>
              Save
            </Btn>
          </div>
        </div>
      )}

      {/* Modals */}
      {modal === "approve" && (
        <ConfirmModal
          title="Approve submission"
          body={`Approve ${student.name}'s submission with the final comment provided?`}
          confirmLabel="Approve"
          confirmVariant="primary"
          onCancel={() => setModal(null)}
          onConfirm={() => {
            onAssessAction(submissionId, "approve", finalComment);
            setModal(null);
          }}
        />
      )}
      {modal === "reject" && (
        <ConfirmModal
          title="Reject submission"
          body={`Mark ${student.name}'s submission as Not Approved?`}
          confirmLabel="Reject"
          confirmVariant="danger"
          onCancel={() => setModal(null)}
          onConfirm={() => {
            onAssessAction(submissionId, "reject", finalComment);
            setModal(null);
          }}
        />
      )}
      {modal === "excuse" && (
        <ConfirmModal
          title="Excuse student"
          body={`Are you sure you want to excuse ${student.name} from this assignment? This cancels the submission request — ${student.name} will not submit, and no grading is required.`}
          confirmLabel="Excuse student"
          confirmVariant="warning"
          onCancel={() => setModal(null)}
          onConfirm={() => {
            onDeliveryStatusChange(sub.id, "excused");
            setModal(null);
          }}
        />
      )}
      {modal === "undo" && (
        <ConfirmModal
          title="Undo grading"
          body={`Undo the grading of ${student.name}'s submission? The result is reverted and the submission can be assessed again.`}
          confirmLabel="Undo grading"
          confirmVariant="default"
          onCancel={() => setModal(null)}
          onConfirm={() => {
            onUndoGrading(submissionId);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Shared feedback sidebar ─────────────────────────────────────────────────
const ANN_COLORS_SHARED: Record<AnnotationType, string> = {
  highlight: "#FF991F",
  text: "#0052CC",
  strikeout: "#DE350B",
  point: "#6554C0",
};
const COM_COLOR_SHARED: Record<Comment["kind"], string> = {
  text: "#0052CC",
  audio: "#36B37E",
};

function FeedbackSidebar({
  sub,
  subAnns,
  subComs,
  released = true,
  focusedAnnId = null,
  registerCard,
  onAnnEditStart,
  onAnnEditSave,
}: {
  sub: Submission;
  subAnns: Annotation[];
  subComs: Comment[];
  released?: boolean;
  focusedAnnId?: string | null;
  registerCard?: (id: string) => (el: HTMLElement | null) => void;
  // Revision mode only (student): edit the annotated passage from the card.
  // Start returns the passage's current text in the editor (and highlights
  // it there); save writes the new text back into the editor.
  onAnnEditStart?: (ann: Annotation) => string | null;
  onAnnEditSave?: (ann: Annotation, newText: string) => void;
}) {
  const feedCount = subAnns.length + subComs.length;
  // Card currently in passage-edit mode (revision only).
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  useEffect(() => {
    if (!onAnnEditSave) setEditingAnnId(null);
  }, [!onAnnEditSave]);
  const assessStatusColor =
    sub.assessmentStatus === "approved"
      ? { bg: "#E3FCEF", border: "#57D9A3", color: "#006644", icon: "✓", label: "Approved" }
      : sub.assessmentStatus === "not_approved"
      ? { bg: "#FFEBE6", border: "#FF8F73", color: "#BF2600", icon: "✗", label: "Not Approved" }
      : sub.assessmentStatus === "resubmission_requested"
      ? { bg: "#EAE6FF", border: "#998DD9", color: "#403294", icon: "↩", label: "Resubmission requested" }
      : null;

  type FeedItem =
    | { kind: "annotation"; data: Annotation; createdAt: string }
    | { kind: "comment"; data: Comment; createdAt: string };

  const feed: FeedItem[] = [
    ...subAnns.map((a) => ({ kind: "annotation" as const, data: a, createdAt: a.createdAt })),
    ...subComs.map((c) => ({ kind: "comment" as const, data: c, createdAt: c.createdAt })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div
      style={{
        width: 340,
        flexShrink: 0,
        borderLeft: "1px solid #DFE1E6",
        backgroundColor: "#fff",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid #DFE1E6",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: "#42526E", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Feedback
        </span>
        {released && feedCount > 0 && (
          <span style={{ backgroundColor: "#DFE1E6", color: "#42526E", borderRadius: 10, fontSize: 10, padding: "1px 7px", fontWeight: 700 }}>
            {feedCount}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {/* No feedback yet (or feedback not released until the teacher grades) */}
        {(!released || (feedCount === 0 && !sub.finalComment)) && (
          <div style={{ textAlign: "center", paddingTop: 40, paddingBottom: 20 }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>💬</div>
            <p style={{ fontSize: 13, color: "#97A0AF", lineHeight: 1.5 }}>
              Feedback from your teacher will appear here after review.
            </p>
          </div>
        )}

        {/* Assessment status banner */}
        {released && assessStatusColor && (
          <div
            style={{
              backgroundColor: assessStatusColor.bg,
              border: `1px solid ${assessStatusColor.border}`,
              borderRadius: 4,
              padding: "10px 12px",
              marginBottom: 12,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 16, color: assessStatusColor.color, flexShrink: 0 }}>
              {assessStatusColor.icon}
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: assessStatusColor.color }}>
                {assessStatusColor.label}
              </div>
              {sub.finalComment && (
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#172B4D", lineHeight: 1.5 }}>
                  {sub.finalComment}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Unified feed */}
        {released && feed.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {feed.map((item) => {
              if (item.kind === "annotation") {
                const ann = item.data;
                const ac = ANN_COLORS_SHARED[ann.type];
                return (
                  <div
                    key={ann.id}
                    ref={registerCard?.(ann.id)}
                    style={{
                      backgroundColor: "#FAFBFC",
                      border: "1px solid #DFE1E6",
                      borderLeft: `3px solid ${ac}`,
                      borderRadius: 4,
                      padding: "10px 12px",
                      transition: "box-shadow 0.2s, background-color 0.2s",
                      ...(focusedAnnId === ann.id ? CARD_FOCUS_STYLE : null),
                    }}
                  >
                    {(() => {
                      // Passage editing from the card — highlight/strikeout
                      // only; "text" annotations already carry the teacher's
                      // replacement.
                      const canEdit =
                        !!onAnnEditSave && (ann.type === "highlight" || ann.type === "strikeout");
                      const isEditing = editingAnnId === ann.id;
                      return (
                        <>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: ac, backgroundColor: `${ac}14`, padding: "2px 6px", borderRadius: 3 }}>
                              {ann.type}
                            </span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              {canEdit && !isEditing && (
                                <button
                                  onClick={() => {
                                    const current = onAnnEditStart?.(ann) ?? null;
                                    setEditText(current ?? ann.selectedText);
                                    setEditingAnnId(ann.id);
                                  }}
                                  title="Edit this passage in your revision"
                                  style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, color: "#0052CC", padding: "1px 4px" }}
                                >
                                  ✎ Edit
                                </button>
                              )}
                              <span style={{ fontSize: 10, color: "#97A0AF" }}>{fmtDate(ann.createdAt)}</span>
                            </span>
                          </div>
                          {ann.type === "text" ? (
                            /* Text replacement: show original → new */
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#97A0AF", marginBottom: 2 }}>Original</div>
                              <p style={{ fontSize: 11, color: "#BF2600", fontStyle: "italic", textDecoration: "line-through", margin: "0 0 6px", lineHeight: 1.45, paddingLeft: 8, borderLeft: `2px solid ${ac}40` }}>
                                "{ann.selectedText}"
                              </p>
                              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#97A0AF", marginBottom: 2 }}>Replaced with</div>
                              <p style={{ fontSize: 12, color: "#006644", fontWeight: 500, margin: 0, lineHeight: 1.55, paddingLeft: 8, borderLeft: `2px solid ${ac}40` }}>
                                "{ann.note}"
                              </p>
                            </div>
                          ) : isEditing ? (
                            /* Edit the annotated passage; saving updates the
                               text in the revision editor. */
                            <div style={{ marginBottom: 8 }}>
                              {ann.note && (
                                <p style={{ margin: "0 0 6px", fontSize: 12, color: "#172B4D", lineHeight: 1.55 }}>{ann.note}</p>
                              )}
                              <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                rows={3}
                                autoFocus
                                style={{ width: "100%", border: "2px solid #4C9AFF", borderRadius: 3, padding: "6px 8px", fontSize: 12, resize: "vertical", fontFamily: "inherit", outline: "none", boxSizing: "border-box", color: "#172B4D", lineHeight: 1.5 }}
                              />
                              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6 }}>
                                <button
                                  onClick={() => setEditingAnnId(null)}
                                  style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, color: "#42526E", padding: "2px 5px" }}
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => {
                                    onAnnEditSave?.(ann, editText);
                                    setEditingAnnId(null);
                                  }}
                                  style={{ background: "#0052CC", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, color: "#fff", padding: "3px 10px", borderRadius: 3 }}
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p style={{ fontSize: 11, color: "#6B778C", fontStyle: "italic", margin: "0 0 5px", lineHeight: 1.45, paddingLeft: 8, borderLeft: `2px solid ${ac}40` }}>
                                "{ann.selectedText.slice(0, 60)}{ann.selectedText.length > 60 ? "…" : ""}"
                              </p>
                              {ann.note && (
                                <p style={{ margin: "0 0 8px", fontSize: 12, color: "#172B4D", lineHeight: 1.55 }}>{ann.note}</p>
                              )}
                            </>
                          )}
                        </>
                      );
                    })()}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Avatar userId="teacher1" size={18} />
                      <span style={{ fontSize: 11, color: "#6B778C" }}>{getUser("teacher1").name}</span>
                    </div>
                  </div>
                );
              } else {
                const com = item.data;
                const cc = COM_COLOR_SHARED[com.kind];
                return (
                  <div
                    key={com.id}
                    style={{
                      backgroundColor: "#FAFBFC",
                      border: "1px solid #DFE1E6",
                      borderLeft: `3px solid ${cc}`,
                      borderRadius: 4,
                      padding: "10px 12px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: cc, backgroundColor: `${cc}14`, padding: "2px 6px", borderRadius: 3 }}>
                        {com.kind === "audio" ? "Audio" : "Comment"}
                      </span>
                      <span style={{ fontSize: 10, color: "#97A0AF" }}>{fmtDate(com.createdAt)}</span>
                    </div>
                    {com.kind === "audio" ? (
                      <div style={{ marginBottom: 8 }}><AudioPlayer label={com.text} /></div>
                    ) : (
                      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#172B4D", lineHeight: 1.6 }}>{com.text}</p>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Avatar userId={com.authorId} size={18} />
                      <span style={{ fontSize: 11, color: "#6B778C" }}>{getUser(com.authorId).name}</span>
                    </div>
                  </div>
                );
              }
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Student View ─────────────────────────────────────────────────────────────
function StudentView({
  submissionId,
  submissions,
  annotations,
  comments,
  onSubmit,
  onResubmit,
}: {
  submissionId: string;
  submissions: Submission[];
  annotations: Annotation[];
  comments: Comment[];
  onSubmit: (id: string, body: string) => void;
  onResubmit: (id: string, body: string) => void;
}) {
  const sub = submissions.find((s) => s.id === submissionId)!;
  // Which version is on screen: null = current, otherwise an archived one.
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const viewingPast = viewVersion !== null && viewVersion !== sub.version;
  const shownVersion = viewingPast ? viewVersion! : sub.version;
  const shownBody = viewingPast
    ? sub.pastVersions.find((p) => p.n === viewVersion)?.body ?? sub.body
    : sub.body;
  // Annotations are scoped to the version on screen.
  const subAnns = annotations.filter(
    (a) => a.submissionId === submissionId && a.version === shownVersion
  );
  const subComs = comments.filter((c) => c.submissionId === submissionId);
  const [draft, setDraft] = useState(sub.body);
  const [revising, setRevising] = useState(false);
  const [showAllVersions, setShowAllVersions] = useState(false);
  // A new resubmission arrived — jump back to the current version.
  useEffect(() => {
    setViewVersion(null);
  }, [sub.version]);

  useEffect(() => {
    setDraft(sub.body);
  }, [submissionId]);

  // A grading action (approve / reject / request resubmission) releases feedback.
  const feedbackReleased = sub.assessmentStatus !== "not_assessed";
  // Feedback on the current version is gated until the teacher assesses;
  // a past version's feedback was already released before the resubmission.
  const annsVisible = viewingPast ? subAnns : feedbackReleased ? subAnns : [];
  const feedVisible = viewingPast || feedbackReleased;
  // Clicking an annotated span focuses its card in the feedback sidebar.
  const { focusedAnnId, focusAnn, registerCard } = useAnnCardFocus();
  const resubmissionOpen = sub.assessmentStatus === "resubmission_requested";
  const notSubmitted = sub.submittedAt === null;
  // Excused cancels the submission request — nothing to write or submit.
  const excused = sub.deliveryStatus === "excused";
  // Reset the revise toggle whenever the submission is no longer open for resubmission.
  useEffect(() => {
    if (!resubmissionOpen) setRevising(false);
  }, [resubmissionOpen]);
  // Show the editor for the first draft, or when the student opts to revise after a request.
  const showEditor = (notSubmitted && !excused) || (resubmissionOpen && revising);

  // Entering revision mode seeds the contentEditable editor once with the
  // annotated HTML; after that the DOM owns the content so the caret is
  // preserved while typing. `draft` mirrors its plain text via onInput.
  const reviseEditorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (revising && reviseEditorRef.current) {
      const anns = annotations.filter(
        (a) => a.submissionId === submissionId && a.version === sub.version
      );
      reviseEditorRef.current.innerHTML = annotationEditorHtml(sub.body, anns);
      setDraft(sub.body);
    }
  }, [revising]);

  const annSpanInEditor = (annId: string) =>
    reviseEditorRef.current?.querySelector(`[data-ann-id="${annId}"]`) as HTMLElement | null;

  // "Edit" pressed on a feedback card: flash the passage in the editor and
  // hand its current text back to the card.
  const handleAnnEditStart = (ann: Annotation): string | null => {
    const el = annSpanInEditor(ann.id);
    if (!el) return null;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.boxShadow = "0 0 0 2px #4C9AFF";
    window.setTimeout(() => (el.style.boxShadow = ""), 1600);
    return el.textContent;
  };

  // Save from the card: write the new text into the editor and restyle the
  // passage as edited so progress stays visible.
  const handleAnnEditSave = (ann: Annotation, newText: string) => {
    const el = annSpanInEditor(ann.id);
    if (!el) return;
    el.textContent = newText;
    el.setAttribute("style", "background-color:#E3FCEF;border-bottom:2px solid #36B37E;");
    el.title = "Edited in this revision";
    setDraft(reviseEditorRef.current?.innerText ?? "");
  };

  const wordCount = draft
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* ── Left: main content ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24, minWidth: 0 }}>
        {/* Task info card */}
        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #DFE1E6",
            borderRadius: 4,
            padding: "16px 20px",
            marginBottom: 20,
            borderLeft: "4px solid #0052CC",
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#172B4D", marginBottom: 6 }}>
            {TASK.title}
          </h2>
          {versionLines(sub).length === 0 ? (
            <Lozenge status={sub.deliveryStatus} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-start" }}>
              {(showAllVersions
                ? versionLines(sub)
                : versionLines(sub).slice(0, VERSION_LINES_VISIBLE)
              ).map((v) =>
                v.isCurrent ? (
                  <div key={v.n} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "#172B4D", fontWeight: 600 }}>{v.label}</span>
                    <Lozenge status={deliveryChipStatus(sub)} />
                    <Lozenge status={sub.assessmentStatus === "not_assessed" ? "not_graded" : sub.assessmentStatus} />
                  </div>
                ) : (
                  <button
                    key={v.n}
                    onClick={() => setViewVersion(v.n)}
                    title="Open this version (read-only)"
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 12,
                      color: viewVersion === v.n ? "#0052CC" : "#6B778C",
                      fontWeight: viewVersion === v.n ? 700 : 400,
                      textDecoration: "underline",
                    }}
                  >
                    {v.label}
                    {viewVersion === v.n ? " · viewing" : ""}
                  </button>
                )
              )}
              {versionLines(sub).length > VERSION_LINES_VISIBLE && (
                <button
                  onClick={() => setShowAllVersions((s) => !s)}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#0052CC",
                  }}
                >
                  {showAllVersions
                    ? "Hide previous versions"
                    : `Display previous versions (${versionLines(sub).length - VERSION_LINES_VISIBLE})`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Past-version banner */}
        {viewingPast && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", backgroundColor: "#FFFAE6", border: "1px solid #FFC400", borderRadius: 4, padding: "8px 10px", marginBottom: 20 }}>
            <span style={{ fontSize: 13, flexShrink: 0 }}>🕘</span>
            <p style={{ margin: 0, fontSize: 12, color: "#6B4E00", lineHeight: 1.5, flex: 1 }}>
              Viewing <strong>version-{viewVersion}</strong> (read-only) with the annotations made on it.
            </p>
            <button
              onClick={() => setViewVersion(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: 600,
                color: "#0052CC",
                whiteSpace: "nowrap",
                padding: "2px 4px",
                flexShrink: 0,
              }}
            >
              Back to current version
            </button>
          </div>
        )}

        {/* Excused notice — no submission required */}
        {!viewingPast && excused && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", backgroundColor: "#EAE6FF", border: "1px solid #998DD9", borderRadius: 4, padding: "8px 10px", marginBottom: 20 }}>
            <span style={{ fontSize: 13, flexShrink: 0, lineHeight: 1.4 }}>✓</span>
            <p style={{ margin: 0, fontSize: 12, color: "#403294", lineHeight: 1.5, flex: 1 }}>
              You have been excused from this assignment — you don't need to submit.
            </p>
          </div>
        )}

        {/* Awaiting-review notice */}
        {!viewingPast && sub.assessmentStatus === "not_assessed" && sub.deliveryStatus === "submitted" && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", backgroundColor: "#EAE6FF", border: "1px solid #998DD9", borderRadius: 4, padding: "8px 10px", marginBottom: 20 }}>
            <span style={{ fontSize: 13, flexShrink: 0, lineHeight: 1.4 }}>⏳</span>
            <p style={{ margin: 0, fontSize: 12, color: "#403294", lineHeight: 1.5, flex: 1 }}>
              Your submission is awaiting review by your teacher.
            </p>
          </div>
        )}

        {/* Resubmission notice — action required, so danger colors */}
        {!viewingPast && sub.assessmentStatus === "resubmission_requested" && (
          <div
            style={{
              backgroundColor: "#FFEBE6",
              border: "1px solid #FF8F73",
              borderRadius: 4,
              padding: "10px 14px",
              marginBottom: 16,
              fontSize: 13,
              color: "#BF2600",
              display: "flex",
              gap: 8,
            }}
          >
            <span>↩</span>
            <div style={{ flex: 1 }}>
              <div>Your teacher has requested a resubmission. Please revise your work and resubmit.</div>
              {sub.resubmissionMessage && (
                <p style={{ margin: "6px 0 0", fontWeight: 600, lineHeight: 1.5 }}>
                  "{sub.resubmissionMessage}"
                </p>
              )}
            </div>
          </div>
        )}

        {viewingPast ? (
          /* ── Archived version (read-only) ── */
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#42526E", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              Your submission — version-{viewVersion}
            </div>
            <div
              style={{
                backgroundColor: "#fff",
                border: "1px solid #DFE1E6",
                borderRadius: 4,
                padding: 24,
              }}
            >
              <AnnotatedText text={shownBody} anns={subAnns} onAnnClick={focusAnn} />
            </div>
          </div>
        ) : showEditor ? (
          /* ── Editor mode ── */
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#42526E", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              {revising ? "Your revised submission" : "Your submission"}
            </div>
            {revising && (
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "#6B778C", lineHeight: 1.5 }}>
                The teacher's annotations are embedded in your text — hover one to read the note.
                Edit the text directly; the marks disappear on resubmission.
              </p>
            )}
            {revising ? (
              /* Editable copy of the submission with the teacher's annotations
                 embedded as styled spans. Seeded once (see effect above) so the
                 caret is never reset while typing; plain text is read back from
                 the DOM on every input. */
              <div
                ref={reviseEditorRef}
                contentEditable
                onInput={(e) => setDraft((e.currentTarget as HTMLElement).innerText)}
                style={{
                  width: "100%",
                  minHeight: 320,
                  border: "2px solid #DFE1E6",
                  borderRadius: 3,
                  padding: "14px 16px",
                  fontSize: 15,
                  fontFamily: "inherit",
                  lineHeight: 1.75,
                  color: "#172B4D",
                  outline: "none",
                  boxSizing: "border-box",
                  backgroundColor: "#fff",
                  overflowY: "auto",
                }}
                onFocus={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "#4C9AFF")}
                onBlur={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "#DFE1E6")}
              />
            ) : (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write your reflection here…"
                style={{
                  width: "100%",
                  minHeight: 320,
                  border: "2px solid #DFE1E6",
                  borderRadius: 3,
                  padding: "14px 16px",
                  fontSize: 15,
                  resize: "vertical",
                  fontFamily: "inherit",
                  lineHeight: 1.75,
                  color: "#172B4D",
                  outline: "none",
                  boxSizing: "border-box",
                  backgroundColor: "#fff",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#4C9AFF")}
                onBlur={(e) => (e.target.style.borderColor = "#DFE1E6")}
              />
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 12, color: "#6B778C" }}>
                {wordCount} words{" "}
                {wordCount < 400 && (
                  <span style={{ color: "#FF991F" }}>· {400 - wordCount} more to reach minimum</span>
                )}
              </span>
              <Btn
                variant="primary"
                onClick={() => {
                  if (!draft.trim()) return;
                  if (sub.assessmentStatus === "resubmission_requested") {
                    onResubmit(sub.id, draft);
                  } else {
                    onSubmit(sub.id, draft);
                  }
                }}
              >
                {sub.assessmentStatus === "resubmission_requested" ? "↩ Resubmit" : "Submit"}
              </Btn>
            </div>
          </div>
        ) : excused && !sub.body.trim() ? null : (
          /* ── Read-only submission text ── */
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#42526E", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              Your submission
            </div>
            <div
              style={{
                backgroundColor: "#fff",
                border: "1px solid #DFE1E6",
                borderRadius: 4,
                padding: 24,
              }}
            >
              <AnnotatedText text={sub.body} anns={annsVisible} onAnnClick={focusAnn} />
            </div>
            {resubmissionOpen && (
              <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
                <Btn variant="primary" onClick={() => setRevising(true)}>
                  ↩ Revise &amp; resubmit
                </Btn>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right: feedback sidebar ── */}
      <FeedbackSidebar
        sub={sub}
        subAnns={annsVisible}
        subComs={subComs}
        released={feedVisible}
        focusedAnnId={focusedAnnId}
        registerCard={registerCard}
        onAnnEditStart={revising && !viewingPast ? handleAnnEditStart : undefined}
        onAnnEditSave={revising && !viewingPast ? handleAnnEditSave : undefined}
      />
    </div>
  );
}

// ─── Supervisor View ──────────────────────────────────────────────────────────
function SupervisorView({
  submissionId,
  submissions,
  annotations,
  comments,
  onChangeSubmission,
}: {
  submissionId: string;
  submissions: Submission[];
  annotations: Annotation[];
  comments: Comment[];
  onChangeSubmission: (id: string) => void;
}) {
  const sub = submissions.find((s) => s.id === submissionId)!;
  // Which version is on screen: null = current, otherwise an archived one.
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const viewingPast = viewVersion !== null && viewVersion !== sub.version;
  const shownVersion = viewingPast ? viewVersion! : sub.version;
  const shownBody = viewingPast
    ? sub.pastVersions.find((p) => p.n === viewVersion)?.body ?? sub.body
    : sub.body;
  // Annotations are scoped to the version on screen.
  const subAnns = annotations.filter(
    (a) => a.submissionId === submissionId && a.version === shownVersion
  );
  const subComs = comments.filter((c) => c.submissionId === submissionId);
  const [showAllVersions, setShowAllVersions] = useState(false);
  // A new resubmission arrived — jump back to the current version.
  useEffect(() => {
    setViewVersion(null);
  }, [sub.version]);
  // Clicking an annotated span focuses its card in the feedback sidebar.
  const { focusedAnnId, focusAnn, registerCard } = useAnnCardFocus();

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* ── Main: submission text ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24, minWidth: 0 }}>
        {/* Info card — mirrors student view task card */}
        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #DFE1E6",
            borderRadius: 4,
            padding: "16px 20px",
            marginBottom: 20,
            borderLeft: "4px solid #6554C0",
          }}
        >
          {/* Task title */}
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#172B4D", marginBottom: 6 }}>
            {TASK.title}
          </h2>

          {/* Meta row */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            {versionLines(sub).length === 0 ? (
              <Lozenge status={sub.deliveryStatus} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-start" }}>
                {(showAllVersions
                  ? versionLines(sub)
                  : versionLines(sub).slice(0, VERSION_LINES_VISIBLE)
                ).map((v) =>
                  v.isCurrent ? (
                    <div key={v.n} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "#172B4D", fontWeight: 600 }}>{v.label}</span>
                      <Lozenge status={deliveryChipStatus(sub)} />
                      <Lozenge status={sub.assessmentStatus === "not_assessed" ? "not_graded" : sub.assessmentStatus} />
                    </div>
                  ) : (
                    <button
                      key={v.n}
                      onClick={() => setViewVersion(v.n)}
                      title="Open this version (read-only)"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: 12,
                        color: viewVersion === v.n ? "#0052CC" : "#6B778C",
                        fontWeight: viewVersion === v.n ? 700 : 400,
                        textDecoration: "underline",
                      }}
                    >
                      {v.label}
                      {viewVersion === v.n ? " · viewing" : ""}
                    </button>
                  )
                )}
                {versionLines(sub).length > VERSION_LINES_VISIBLE && (
                  <button
                    onClick={() => setShowAllVersions((s) => !s)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#0052CC",
                    }}
                  >
                    {showAllVersions
                      ? "Hide previous versions"
                      : `Display previous versions (${versionLines(sub).length - VERSION_LINES_VISIBLE})`}
                  </button>
                )}
              </div>
            )}
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#403294", backgroundColor: "#EAE6FF", border: "1px solid #998DD9", borderRadius: 3, padding: "2px 8px", fontWeight: 600, flexShrink: 0 }}>
              👁 Read-only — Supervisor view
            </span>
          </div>
        </div>

        {/* Past-version banner */}
        {viewingPast && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", backgroundColor: "#FFFAE6", border: "1px solid #FFC400", borderRadius: 4, padding: "8px 10px", marginBottom: 20 }}>
            <span style={{ fontSize: 13, flexShrink: 0 }}>🕘</span>
            <p style={{ margin: 0, fontSize: 12, color: "#6B4E00", lineHeight: 1.5, flex: 1 }}>
              Viewing <strong>version-{viewVersion}</strong> (read-only) with the annotations made on it.
            </p>
            <button
              onClick={() => setViewVersion(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: 600,
                color: "#0052CC",
                whiteSpace: "nowrap",
                padding: "2px 4px",
                flexShrink: 0,
              }}
            >
              Back to current version
            </button>
          </div>
        )}

        {/* Submission text */}
        <div style={{ backgroundColor: "#fff", border: "1px solid #DFE1E6", borderRadius: 4, padding: 24 }}>
          <AnnotatedText text={shownBody} anns={subAnns} onAnnClick={focusAnn} />
        </div>
      </div>

      {/* ── Right: feedback sidebar ── */}
      <FeedbackSidebar sub={sub} subAnns={subAnns} subComs={subComs} focusedAnnId={focusedAnnId} registerCard={registerCard} />
    </div>
  );
}

// ─── App root ────────────────────────────────────────────────────────────────
export default function App() {
  const [role, setRole] = useState<Role>("teacher");
  const [selectedSubId, setSelectedSubId] = useState("sub1");
  const studentAs = "student1";
  const [supervisorSubId, setSupervisorSubId] = useState("sub1");
  const [supDropOpen, setSupDropOpen] = useState(false);
  const [teacherDropOpen, setTeacherDropOpen] = useState(false);
  const [studentDropOpen, setStudentDropOpen] = useState(false);
  const [showAnnHint, setShowAnnHint] = useState(true);
  const [submissions, setSubmissions] = useState<Submission[]>(SUBS_INIT);
  const [annotations, setAnnotations] = useState<Annotation[]>(ANNS_INIT);
  const [comments, setComments] = useState<Comment[]>(COMS_INIT);
  const [events, setEvents] = useState<GradingEvent[]>(EVENTS_INIT);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (type: Toast["type"], message: string) => {
    const id = uid();
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  };

  const addEvent = (
    submissionId: string,
    actorId: string,
    action: GradingEventAction,
    note: string | null = null
  ) => {
    setEvents((ev) => [
      ...ev,
      { id: uid(), submissionId, actorId, action, note, createdAt: new Date().toISOString() },
    ]);
  };

  const handleAnnotationAdd = (ann: Omit<Annotation, "id">) => {
    setAnnotations((a) => [...a, { ...ann, id: uid() }]);
    addToast("success", "Annotation added");
  };

  const handleAnnotationEdit = (id: string, note: string) => {
    setAnnotations((a) => a.map((x) => (x.id === id ? { ...x, note } : x)));
    addToast("success", "Annotation updated");
  };

  const handleAnnotationDelete = (id: string) => {
    setAnnotations((a) => a.filter((x) => x.id !== id));
    addToast("info", "Annotation deleted");
  };

  const handleCommentAdd = (com: Omit<Comment, "id">) => {
    setComments((c) => [...c, { ...com, id: uid() }]);
    addToast("success", com.kind === "audio" ? "Audio comment added" : "Comment added");
  };

  const handleCommentEdit = (id: string, text: string) => {
    setComments((c) => c.map((x) => (x.id === id ? { ...x, text } : x)));
    addToast("success", "Comment updated");
  };

  const handleCommentDelete = (id: string) => {
    setComments((c) => c.filter((x) => x.id !== id));
    addToast("info", "Comment deleted");
  };

  const handleDeliveryStatusChange = (subId: string, status: DeliveryStatus) => {
    setSubmissions((subs) =>
      subs.map((s) => (s.id === subId ? { ...s, deliveryStatus: status } : s))
    );
    addToast("info", `Status set to ${LOZENGE_CFG[status]?.label ?? status}`);
  };

  const handleAssessAction = (
    subId: string,
    action: "approve" | "reject" | "resubmit",
    fc?: string
  ) => {
    const target = submissions.find((s) => s.id === subId);
    // Approve/Reject are final and one-time; ignore once already graded.
    // (Request resubmission is not final — it reopens the options.)
    const isFinal =
      target?.assessmentStatus === "approved" ||
      target?.assessmentStatus === "not_approved";
    if ((action === "approve" || action === "reject") && isFinal) return;

    setSubmissions((subs) =>
      subs.map((s) => {
        if (s.id !== subId) return s;
        if (action === "approve")
          return { ...s, assessmentStatus: "approved", finalComment: fc ?? null, resubmissionMessage: null };
        if (action === "reject")
          return { ...s, assessmentStatus: "not_approved", finalComment: fc ?? null, resubmissionMessage: null };
        if (action === "resubmit")
          return { ...s, assessmentStatus: "resubmission_requested", finalComment: null, resubmissionMessage: fc ?? null };
        return s;
      })
    );
    const msgs = {
      approve: "✓ Submission approved",
      reject: "Submission marked Not Approved",
      resubmit: "Resubmission requested",
    };
    addToast("success", msgs[action]);
    const eventAction: GradingEventAction =
      action === "approve" ? "approved" : action === "reject" ? "rejected" : "resubmission_requested";
    addEvent(subId, "teacher1", eventAction, fc ?? null);
  };

  // Reverses a final grade: the submission returns to "not assessed" so the
  // teacher can grade again (approve, reject, or request resubmission).
  const handleUndoGrading = (subId: string) => {
    setSubmissions((subs) =>
      subs.map((s) =>
        s.id !== subId ? s : { ...s, assessmentStatus: "not_assessed", finalComment: null }
      )
    );
    addToast("info", "Grading undone — the submission can be assessed again");
    addEvent(subId, "teacher1", "grading_undone");
  };

  const handleNavigate = (dir: "prev" | "next") => {
    const idx = submissions.findIndex((s) => s.id === selectedSubId);
    const newIdx = dir === "prev" ? idx - 1 : idx + 1;
    if (newIdx >= 0 && newIdx < submissions.length)
      setSelectedSubId(submissions[newIdx].id);
  };

  const handleStudentSubmit = (id: string, body: string) => {
    const sub = submissions.find((s) => s.id === id)!;
    const isLate = new Date() > new Date(sub.deadline);
    setSubmissions((subs) =>
      subs.map((s) =>
        s.id !== id
          ? s
          : { ...s, body, deliveryStatus: isLate ? "late" : "submitted", submittedAt: new Date().toISOString() }
      )
    );
    addToast("success", "Submission sent successfully!");
    addEvent(id, sub.studentId, "submitted");
  };

  const handleStudentResubmit = (id: string, body: string) => {
    const sub = submissions.find((s) => s.id === id)!;
    setSubmissions((subs) =>
      subs.map((s) =>
        s.id !== id
          ? s
          : {
              ...s,
              body,
              deliveryStatus: "submitted",
              assessmentStatus: "not_assessed",
              submittedAt: new Date().toISOString(),
              resubmissionMessage: null,
              version: s.version + 1,
              pastVersions: [
                ...s.pastVersions,
                {
                  n: s.version,
                  body: s.body,
                  submittedAt: s.submittedAt,
                  outcome: s.assessmentStatus === "not_approved" ? "rejected" : "resubmission_requested",
                },
              ],
            }
      )
    );
    addToast("success", "Resubmission sent!");
    addEvent(id, sub.studentId, "resubmitted");
  };

  const studentSub = submissions.find((s) => s.studentId === studentAs)!;
  const ROLE_ACCENT: Record<Role, string> = {
    teacher: "#0052CC",
    student: "#36B37E",
    supervisor: "#6554C0",
  };

  return (
    <div
      className="print-flow"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        backgroundColor: "#F4F5F7",
        fontSize: 14,
      }}
    >
      {/* Print layout ("Download PDF" = window.print()): hide app chrome,
          linearize the scroll containers, and reveal the print-only summary
          (grading, annotations, history stacked after the text). */}
      <style>{`
        .print-only { display: none; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .print-flow {
            display: block !important;
            height: auto !important;
            overflow: visible !important;
          }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {/* ── Top navigation ── */}
      <nav
        className="no-print"
        style={{
          backgroundColor: "#0747A6",
          color: "#fff",
          height: 56,
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: 16,
          flexShrink: 0,
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          zIndex: 100,
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              backgroundColor: "#0065FF",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: "-0.5px",
            }}
          >
            M
          </div>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.2px" }}>
            MOSO InPraxis
          </span>
          <span style={{ color: "rgba(179,212,255,0.7)", fontSize: 12, marginLeft: 2 }}>
            / Supervision
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Role switcher */}
        <div
          style={{
            display: "flex",
            gap: 2,
            backgroundColor: "rgba(0,0,0,0.25)",
            padding: 3,
            borderRadius: 6,
          }}
        >
          {(["teacher", "student", "supervisor"] as Role[]).map((r) => (
            <button
              key={r}
              onClick={() => {
                setRole(r);
                setTeacherDropOpen(false);
                setSupDropOpen(false);
                setStudentDropOpen(false);
              }}
              style={{
                padding: "4px 14px",
                borderRadius: 4,
                border: "none",
                cursor: "pointer",
                backgroundColor: role === r ? "#fff" : "transparent",
                color: role === r ? ROLE_ACCENT[r] : "rgba(255,255,255,0.75)",
                fontWeight: role === r ? 700 : 400,
                fontSize: 13,
                textTransform: "capitalize",
                transition: "all 0.15s",
                fontFamily: "inherit",
              }}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Current user avatar */}
        <Avatar
          userId={
            role === "teacher"
              ? "teacher1"
              : role === "supervisor"
              ? "supervisor1"
              : studentAs
          }
          size={30}
        />
      </nav>

      {/* ── Page header ── */}
      <div
        className="no-print"
        style={{
          backgroundColor: "#fff",
          borderBottom: "1px solid #DFE1E6",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        {/* Student switcher dropdown (all roles) */}
        {(() => {
            const isTeacher = role === "teacher";
            const activeSubId = isTeacher
              ? selectedSubId
              : role === "supervisor"
              ? supervisorSubId
              : studentSub.id;
            const setActiveSubId = isTeacher
              ? (id: string) => { setSelectedSubId(id); setTeacherDropOpen(false); }
              : role === "supervisor"
              ? (id: string) => { setSupervisorSubId(id); setSupDropOpen(false); }
              : () => setStudentDropOpen(false);
            const dropOpen = isTeacher ? teacherDropOpen : role === "supervisor" ? supDropOpen : studentDropOpen;
            const setDropOpen = isTeacher ? setTeacherDropOpen : role === "supervisor" ? setSupDropOpen : setStudentDropOpen;

            const activeSub = submissions.find((s) => s.id === activeSubId)!;
            const activeStudent = getUser(activeSub.studentId);

            return (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "#6B778C", fontWeight: 500, whiteSpace: "nowrap" }}>
                  {isTeacher ? "Assessing:" : "Viewing:"}
                </span>

                <div style={{ position: "relative" }}>
                  {/* Trigger */}
                  <button
                    onClick={() => setDropOpen((o: boolean) => !o)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 10px 5px 8px",
                      border: `2px solid ${dropOpen ? "#4C9AFF" : "#DFE1E6"}`,
                      borderRadius: 3,
                      backgroundColor: "#fff",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      minWidth: 180,
                    }}
                  >
                    <Avatar userId={activeStudent.id} size={24} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#172B4D", flex: 1, textAlign: "left" }}>
                      {activeStudent.name}
                    </span>
                    <span style={{ fontSize: 10, color: "#42526E", flexShrink: 0 }}>
                      {dropOpen ? "▲" : "▼"}
                    </span>
                  </button>

                  {/* Panel */}
                  {dropOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 4px)",
                        left: 0,
                        zIndex: 400,
                        backgroundColor: "#fff",
                        border: "1px solid #DFE1E6",
                        borderRadius: 4,
                        boxShadow: "0 4px 20px rgba(9,30,66,0.15)",
                        minWidth: 240,
                        overflow: "hidden",
                      }}
                    >
                      {submissions.map((s) => {
                        const st = getUser(s.studentId);
                        const isSelected = s.id === activeSubId;
                        return (
                          <button
                            key={s.id}
                            onClick={() => setActiveSubId(s.id)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              width: "100%",
                              padding: "9px 12px",
                              border: "none",
                              borderBottom: "1px solid #F4F5F7",
                              backgroundColor: isSelected ? "#F4F9FF" : "#fff",
                              cursor: "pointer",
                              textAlign: "left",
                              fontFamily: "inherit",
                            }}
                          >
                            <Avatar userId={st.id} size={28} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: isSelected ? 600 : 400, color: isSelected ? "#0052CC" : "#172B4D" }}>
                                {st.name}
                              </div>
                              {s.assessmentStatus === "not_assessed" && (
                                <div style={{ marginTop: 3 }}>
                                  <Lozenge status="not_assessed" />
                                </div>
                              )}
                            </div>
                            {isSelected && (
                              <span style={{ color: "#0052CC", fontSize: 14, flexShrink: 0 }}>✓</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
        })()}
        <div style={{ flex: 1 }} />
        {role === "teacher" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Btn variant="default" small onClick={() => window.print()}>↓ Download PDF</Btn>
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div
        className="print-flow"
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {role === "teacher" && (
            <TeacherDetail
              key={selectedSubId}
              submissionId={selectedSubId}
              submissions={submissions}
              annotations={annotations}
              comments={comments}
              onAnnotationAdd={handleAnnotationAdd}
              onAnnotationEdit={handleAnnotationEdit}
              onAnnotationDelete={handleAnnotationDelete}
              onCommentAdd={handleCommentAdd}
              onCommentEdit={handleCommentEdit}
              onCommentDelete={handleCommentDelete}
              onAssessAction={handleAssessAction}
              onUndoGrading={handleUndoGrading}
              onDeliveryStatusChange={handleDeliveryStatusChange}
              events={events}
              onNavigate={handleNavigate}
              showAnnHint={showAnnHint}
              onDismissAnnHint={() => setShowAnnHint(false)}
              onToast={addToast}
            />
        )}

        {role === "student" && (
          <StudentView
            key={studentAs}
            submissionId={studentSub.id}
            submissions={submissions}
            annotations={annotations}
            comments={comments}
            onSubmit={handleStudentSubmit}
            onResubmit={handleStudentResubmit}
          />
        )}

        {role === "supervisor" && (
          <SupervisorView
            submissionId={supervisorSubId}
            submissions={submissions}
            annotations={annotations}
            comments={comments}
            onChangeSubmission={setSupervisorSubId}
          />
        )}
      </div>

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
