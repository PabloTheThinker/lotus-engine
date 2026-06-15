/** Wave 87 (v4.74–v4.78) — itch.io embed widget: changelog + achievement trophies. */

import { achievementsForPack, type AchievementDef } from './exportAchievements'
import { buildPackChangelogHtml, PACK_CHANGELOG_CSS } from './packChangelogHtml'
import { miniGamePackTitle } from './miniGameExportPack'
import type { MiniGameMode } from './starterMiniGames'

export const ITCH_EMBED_WIDGET_FILENAME = 'embed-widget.html'

/** Trophy list styles for itch.io page embed + zip sidecar. */
export const ACHIEVEMENT_TROPHY_CSS = `
  .lotus-pack-achievements {
    font: 500 14px/1.55 system-ui, -apple-system, Segoe UI, sans-serif;
    color: #e8edf4;
    background: linear-gradient(180deg, #12151c 0%, #0d0f12 100%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 20px 24px 18px;
    max-width: 720px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    margin-top: 18px;
  }
  .lotus-pack-achievements h2 {
    margin: 0 0 12px;
    font-size: 15px;
    font-weight: 700;
    color: #ffd76a;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .lotus-pack-achievements ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .lotus-pack-achievements li {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  .lotus-pack-achievements .lotus-trophy-icon {
    font-size: 22px;
    line-height: 1;
    flex-shrink: 0;
  }
  .lotus-pack-achievements .lotus-trophy-body {
    min-width: 0;
  }
  .lotus-pack-achievements .lotus-trophy-title {
    margin: 0 0 2px;
    font-size: 14px;
    font-weight: 700;
    color: #fff;
  }
  .lotus-pack-achievements .lotus-trophy-desc {
    margin: 0;
    font-size: 13px;
    color: #aeb8c6;
  }
`

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function resolvePackId(packId: string): MiniGameMode | null {
  const id = String(packId ?? '')
    .trim()
    .toLowerCase()
  if (id === 'platformer' || id === 'rpg' || id === 'fps') return id
  return null
}

function renderAchievementItem(achievement: AchievementDef): string {
  const icon = achievement.icon ?? '🏆'
  return `<li>
  <span class="lotus-trophy-icon" aria-hidden="true">${escapeHtml(icon)}</span>
  <div class="lotus-trophy-body">
    <p class="lotus-trophy-title">${escapeHtml(achievement.title)}</p>
    <p class="lotus-trophy-desc">${escapeHtml(achievement.description)}</p>
  </div>
</li>`
}

/** Styled achievement trophy list for itch.io page template embed. */
export function renderAchievementsHtml(packId: MiniGameMode | string): string {
  const mode = resolvePackId(packId)
  const achievements = mode ? achievementsForPack(mode) : []
  const items = achievements.map(renderAchievementItem).join('\n')
  return `<section class="lotus-pack-achievements">
<style>${ACHIEVEMENT_TROPHY_CSS}</style>
<h2>Achievements</h2>
<ul>
${items}
</ul>
</section>`
}

/** Combined changelog + achievements sections for itch.io page paste. */
export function buildItchEmbedWidgetSections(packId: MiniGameMode | string): string {
  const mode = resolvePackId(packId)
  if (!mode) return ''
  const changelog = buildPackChangelogHtml(mode)
  const achievements = renderAchievementsHtml(mode)
  return `${changelog}\n${achievements}`
}

/** Full standalone embed-widget.html document for itch zip sidecar. */
export function buildItchEmbedWidget(packId: MiniGameMode | string): string {
  const mode = resolvePackId(packId)
  if (!mode) return ''
  const title = miniGamePackTitle(mode)
  const sections = buildItchEmbedWidgetSections(mode)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — Lotus Embed Widget</title>
<style>
  html, body { margin: 0; min-height: 100%; background: #0d0f12; }
  body {
    display: flex; flex-direction: column; align-items: center;
    gap: 0; padding: 24px 16px 40px;
  }
  ${PACK_CHANGELOG_CSS}
  ${ACHIEVEMENT_TROPHY_CSS}
</style>
</head>
<body>
${sections}
</body>
</html>`
}

export function serializeItchEmbedWidgetForExport(packId: MiniGameMode): string {
  return JSON.stringify(buildItchEmbedWidgetSections(packId)).replace(/</g, '\\u003c')
}