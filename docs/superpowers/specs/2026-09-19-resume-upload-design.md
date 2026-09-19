# Resume Upload - Design

## Purpose

Replace the plain-text resume textarea with a file upload flow, so
users can submit a resume in the format they already have (PDF, Word,
plain text) instead of copy-pasting text by hand. This supersedes the
original design's non-goal of "no file upload / resume parsing" -
that constraint was set to minimize initial scope, not because upload
was undesirable.

## Non-goals

- No storage of uploaded files. Parsing is in-memory, per-request;
  nothing is written to disk or a database, consistent with the
  parent project's no-persistence design.
- No OCR / scanned-image resume support. Only resumes with a real
  text layer (native PDF/DOCX/DOC/TXT) are supported.
- No multi-file upload. One resume per search, same as today.

## Scope

Formats accepted: **PDF (.pdf), Word (.docx), legacy Word (.doc), and
plain text (.txt)**. The existing paste-as-text textarea is removed
entirely - upload is the only way to provide a resume.

## Architecture

Parsing happens server-side, in a new route handler
(`app/api/parse-resume/route.ts`), not in the browser. Two reasons:

1. The parent project's architecture keeps all non-trivial processing
   server-side, and the extracted text is sent to `/api/agent` (and
   the Anthropic API) regardless of where parsing happens, so
   client-side parsing buys no privacy benefit.
2. PDF/DOCX parsing libraries are heavy; keeping them server-only
   avoids growing the client JS bundle, and gives one consistent
   codepath instead of relying on browser-specific behavior.

Libraries (all pure-JS/Node, run fine in a Vercel serverless
function):

- `pdf-parse` for `.pdf`
- `mammoth` for `.docx`
- `word-extractor` for legacy `.doc`
- `.txt` is read directly as UTF-8 text, no library needed

Format is determined by file extension plus a MIME-type check as a
sanity guard (not a security boundary - content is never executed,
only parsed for text).

## Components

- `components/ResumeUpload.tsx` (new) - replaces the resume
  `<textarea>` block inside `SearchForm.tsx`. A drag-and-drop /
  click-to-browse dropzone that:
  - Accepts only `.pdf`, `.docx`, `.doc`, `.txt` (enforced via the
    file input's `accept` attribute and re-checked after selection).
  - Rejects files over 5 MB client-side before upload, with an inline
    error message.
  - On valid file selection, uploads immediately and shows a loading
    state while parsing is in flight.
  - On success, reveals an **editable** `<textarea>` pre-filled with
    the extracted text, so the user can review and fix parsing
    artifacts (e.g. broken line breaks from a PDF) before submitting.
    This textarea's value - not the file - is what gets submitted to
    `/api/agent`, so a failed or imperfect extraction is always
    recoverable by hand-editing rather than re-uploading.
  - Shows a "replace file" affordance to restart the flow with a
    different upload.
- `app/api/parse-resume/route.ts` (new) - accepts
  `multipart/form-data` with a single `file` field. Validates size
  (reject >5 MB, 413) and extension/MIME (reject unsupported, 400),
  dispatches to the matching parser, and returns `{ text }` on success
  or `{ error: string }` on failure (400/422 as appropriate - see
  Error handling).
- `lib/resume/parseResume.ts` (new) - pure function
  `parseResume(buffer: Buffer, filename: string): Promise<string>`
  that picks the parser by extension and returns extracted text or
  throws a typed `ResumeParseError`. Kept separate from the route
  handler so it's unit-testable without mocking HTTP.
- `SearchForm.tsx` - resume `<textarea>` block replaced by
  `<ResumeUpload>`; the rest of the form (keywords, location,
  remote-only toggle, submit) is unchanged. `onSubmit(resume,
  criteria)` still receives a plain resume string, so
  `ResultsPanel.tsx` and `/api/agent` need no changes at all.

## Data flow

1. User selects/drops a resume file in `ResumeUpload`.
2. Client-side check: extension allowed, size ≤ 5 MB. Reject
   immediately with an inline message if not.
3. Client `POST`s the file to `/api/parse-resume` as
   `multipart/form-data`.
4. Route re-validates size/extension server-side (never trust the
   client-side check alone), calls `parseResume`, and returns
   `{ text }` or `{ error }`.
5. On `{ text }`, the frontend fills the editable textarea with the
   extracted content; the user may edit it.
6. On `{ error }`, the dropzone shows the error message and lets the
   user pick a different file - no partial/broken state.
7. Existing flow resumes unchanged: user fills keywords/location/
   remote toggle, submits, `onSubmit(resume, criteria)` fires exactly
   as it does today.

## Error handling

- Oversized file (>5 MB): rejected client-side before upload where
  possible; re-checked server-side (413) in case client validation is
  bypassed.
- Unsupported extension/MIME: rejected client-side via `accept` and
  server-side (400) as a hard guard.
- Corrupt or unparsable file (e.g. password-protected PDF, malformed
  DOCX): parser throws `ResumeParseError`, route returns 422 with a
  plain-language message ("Couldn't read this file - it may be
  corrupted or password-protected. Try another file, or a plain text
  export."). No stack traces or internal errors surface to the user.
- Empty extraction (parser succeeds but yields blank/whitespace-only
  text, e.g. an image-only PDF with no text layer): treated as an
  error (422) with a message pointing at the OCR non-goal ("This file
  doesn't appear to contain selectable text.").
- Network/fetch failure during upload: same inline-error treatment as
  the existing auth-check/search-flow network handling already in
  `ResultsPanel.tsx`.

## Testing

- Unit tests for `parseResume`, one real sample file per supported
  format plus a corrupt-file case per format, following the existing
  `lib/tools/*.test.ts` pattern.
- Unit test for `app/api/parse-resume/route.ts`'s validation branching
  (oversized, wrong extension, parser throws) independent of real
  parsing, by mocking `parseResume`.
- Manual end-to-end pass through the real UI - upload a real PDF and a
  real DOCX resume, confirm extracted text renders correctly and the
  full search flow still completes - before considering the work
  done.

## Deployment

No new environment variables or infrastructure. `pdf-parse`,
`mammoth`, and `word-extractor` are added as regular npm dependencies;
no native binaries or build-step changes required.
