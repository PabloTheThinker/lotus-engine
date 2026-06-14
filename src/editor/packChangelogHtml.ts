import { buildReleaseNotes } from './itchReleaseNotes'
import type { MiniGameMode } from './starterMiniGames'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Shared styles for itch.io page embed + pack boot changelog panel. */
export const PACK_CHANGELOG_CSS = `
  .lotus-pack-changelog {
    font: 500 14px/1.55 system-ui, -apple-system, Segoe UI, sans-serif;
    color: #e8edf4;
    background: linear-gradient(180deg, #12151c 0%, #0d0f12 100%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 20px 24px 18px;
    max-width: 720px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  }
  .lotus-pack-changelog h1 {
    margin: 0 0 10px;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #fff;
  }
  .lotus-pack-changelog h2 {
    margin: 18px 0 8px;
    font-size: 15px;
    font-weight: 700;
    color: #9fd3ff;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .lotus-pack-changelog h3 {
    margin: 14px 0 6px;
    font-size: 14px;
    font-weight: 700;
    color: #c8d0d8;
  }
  .lotus-pack-changelog p {
    margin: 0 0 10px;
    color: #b8c2ce;
  }
  .lotus-pack-changelog ul {
    margin: 0 0 12px;
    padding-left: 1.25rem;
    color: #aeb8c6;
  }
  .lotus-pack-changelog li {
    margin: 4px 0;
  }
  .lotus-pack-changelog code {
    font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace;
    background: rgba(255, 255, 255, 0.08);
    padding: 1px 5px;
    border-radius: 4px;
    color: #d6e4ff;
  }
`

/** Boot overlay shell — shown before first frame when pack changelog is enabled. */
export const PACK_CHANGELOG_BOOT_CSS = `
  #lotus-pack-changelog-boot {
    position: fixed; inset: 0; z-index: 35;
    display: flex; align-items: center; justify-content: center;
    background: rgba(13, 15, 18, 0.92);
    pointer-events: auto;
    padding: 16px;
    overflow: auto;
  }
  #lotus-pack-changelog-boot .lotus-pack-changelog-boot-inner {
    display: flex; flex-direction: column; gap: 14px;
    width: min(760px, 100%);
  }
  #lotus-pack-changelog-boot .lotus-pack-changelog-boot-actions {
    display: flex; justify-content: center;
  }
  #lotus-pack-changelog-boot .lotus-pack-changelog-play {
    min-width: 200px; padding: 11px 22px;
    border: none; border-radius: 8px;
    background: #2f80ed; color: #fff;
    font: 600 14px system-ui, sans-serif; cursor: pointer;
  }
  #lotus-pack-changelog-boot .lotus-pack-changelog-play:active { background: #2568c7; }
`

/** Convert release-notes markdown to HTML body fragments (headings, lists, paragraphs). */
export function markdownToHtmlBody(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let inList = false

  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }

  const inline = (text: string) =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      closeList()
      continue
    }
    const h1 = line.match(/^# (.+)/)
    if (h1) {
      closeList()
      out.push(`<h1>${inline(h1[1])}</h1>`)
      continue
    }
    const h2 = line.match(/^## (.+)/)
    if (h2) {
      closeList()
      out.push(`<h2>${inline(h2[1])}</h2>`)
      continue
    }
    const h3 = line.match(/^### (.+)/)
    if (h3) {
      closeList()
      out.push(`<h3>${inline(h3[1])}</h3>`)
      continue
    }
    const bullet = line.match(/^[-*] (.+)/)
    if (bullet) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}

/** Render styled HTML section for itch.io page template embed. */
export function renderReleaseNotesHtml(markdown: string): string {
  const body = markdownToHtmlBody(markdown)
  return `<section class="lotus-pack-changelog">\n<style>${PACK_CHANGELOG_CSS}</style>\n${body}\n</section>`
}

/** Full standalone CHANGELOG.html document for itch zip sidecar. */
export function renderPackChangelogDocument(markdown: string, title = 'Release Notes'): string {
  const section = renderReleaseNotesHtml(markdown)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — Lotus Engine</title>
<style>
  html, body { margin: 0; min-height: 100%; background: #0d0f12; }
  body { display: flex; align-items: flex-start; justify-content: center; padding: 24px 16px 40px; }
</style>
</head>
<body>
${section}
</body>
</html>`
}

/** Build itch embed HTML for a mini-game pack genre. */
export function buildPackChangelogHtml(mode: MiniGameMode): string {
  return renderReleaseNotesHtml(buildReleaseNotes(mode))
}

/** Build full CHANGELOG.html file contents for itch zip. */
export function buildPackChangelogDocument(mode: MiniGameMode): string {
  const notes = buildReleaseNotes(mode)
  const title = notes.match(/^# (.+)/m)?.[1] ?? 'Release Notes'
  return renderPackChangelogDocument(notes, title)
}