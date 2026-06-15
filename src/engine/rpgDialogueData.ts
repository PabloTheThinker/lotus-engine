/** Wave 93 (v5.04–v5.08) — bundled RPG dialogue tree resources. */

import type { DialogueTree } from './rpgDialogue'

/** Quest-giver dialogue for the RPG pack village elder NPC. */
export const VILLAGE_ELDER_DIALOGUE: DialogueTree = {
  id: 'village_elder',
  title: 'Village Elder Quest',
  startId: 'greet',
  nodes: [
    {
      id: 'greet',
      speaker: 'Elder Maren',
      text: 'Welcome, traveler. Our village needs a brave soul.',
      choices: [
        { text: 'What happened?', nextId: 'quest' },
        { text: 'Maybe later.', nextId: 'bye' },
      ],
    },
    {
      id: 'quest',
      speaker: 'Elder Maren',
      text: 'Goblins stole the Sun Relic from the shrine. Recover it from the eastern ruins.',
      nextId: 'accept',
    },
    {
      id: 'accept',
      speaker: 'Elder Maren',
      text: 'Thank you! I have marked the quest on your map. May fortune favor you.',
    },
    {
      id: 'bye',
      speaker: 'Elder Maren',
      text: 'Return when you are ready to help.',
    },
  ],
}

/** Default dialogue catalog embedded in RPG pack exports. */
export const DEFAULT_DIALOGUE_TREES: DialogueTree[] = [VILLAGE_ELDER_DIALOGUE]