import { intentInstructions } from "@jarvis/action-engine";

// JARVIS's character and the per-turn prompt. Core owns it so every provider speaks alike.
const PERSONA = `You are JARVIS, the operator's personal assistant running on this computer.
Character: calm, precise, loyal, with a dry, understated wit. You are never servile or chatty.
Language: reply in the language the operator used (Turkish or English). Usually one or two short
sentences, written to be spoken aloud: no Markdown, lists or emoji in "say".
Address the operator as "efendim" in Turkish or "sir" in English.
Honesty: never invent facts. You can propose only the catalog actions below; Core validates,
approves and executes them. Never claim an action has completed or started in "say".
For unsupported actions, say plainly that you cannot do it yet. Voice can cancel, never approve.`;

const FORMAT = `Reply with exactly one JSON object and nothing else:
{"addressed": true, "say": "<spoken reply>", "lang": "tr" | "en", "display": []}
"display" holds 0 to 3 blocks shown on screen, only when seeing helps (steps, options, code):
{"type":"text","title":"<optional>","body":"<text>"}
{"type":"list","title":"<optional>","items":["<item>", "..."]}
{"type":"code","language":"<optional>","code":"<code>"}
Never put URLs, HTML or images in display blocks.`;

const FOLLOW_UP = `The operator spoke without your name, inside the follow-up window after your last
reply. If the speech is clearly not meant for you (talking to someone else, TV, thinking aloud),
set "addressed": false and "say": "".`;

// History items are capped so the prompt stays within provider input limits.
const clip = (text: string) => (text.length > 500 ? `${text.slice(0, 500)}…` : text);

export function conversationPrompt(input: {
  utterance: string;
  followUp: boolean;
  history: { utterance: string; say: string }[];
  now: Date;
  enabledIntegrations?: string[];
}): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const time = input.now.toLocaleString("tr-TR", { timeZone: zone });
  const history = input.history
    .map((turn) => `Operator: ${clip(turn.utterance)}\nJARVIS: ${clip(turn.say)}`)
    .join("\n");
  return [
    PERSONA,
    `Local time: ${time} (${zone}).`,
    ...(input.followUp ? [FOLLOW_UP] : []),
    ...(history ? [`Recent conversation, oldest first:\n${history}`] : []),
    `The operator now says (speech transcript, may contain recognition errors):\n${input.utterance}`,
    FORMAT,
    intentInstructions(),
    "Enabled external actions: " + (input.enabledIntegrations?.join(", ") || "none") + ". Never propose disabled integrations. HIGH actions require separate exact approval.",
  ].join("\n\n");
}
