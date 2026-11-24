const NAMES = [
  "Pip", "Fable", "Glitch", "Widget", "Gizmo", "Tinker", "Patch", "Toggle",
  "Bit", "Byte", "Bloop", "Beep", "Ping", "Blink", "Fizz", "Zest",
  "Zippy", "Dash", "Nudge", "Hunch", "Riddle", "Clue", "Doodle", "Scribble",
  "Inkwell", "Sonnet", "Verse", "Lyric", "Banjo", "Kazoo", "Tempo", "Cadence",
  "Radar", "Beacon", "Lantern", "Compass", "Meridian", "Solstice", "Aurora", "Halo",
  "Cinder", "Flint", "Copper", "Sterling", "Opal", "Jasper", "Topaz", "Quartz",
  "Acorn", "Fern", "Thistle", "Petal", "Dewdrop", "Sequoia", "Birch", "Cricket",
  "Badger", "Otter", "Puffin", "Gecko", "Quokka", "Wombat", "Bilby", "Kookaburra",
  "Wallaby", "Roo", "Crumpet", "Nugget", "Pretzel", "Truffle", "Wasabi", "Kimchi",
  "Gnocchi", "Tater", "Sprocket", "Rivet", "Velcro",
];

export function pickBotName(taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()));
  const free = NAMES.filter((n) => !used.has(n.toLowerCase()));
  if (free.length > 0) return free[Math.floor(Math.random() * free.length)];
  const base = NAMES[Math.floor(Math.random() * NAMES.length)];
  for (let i = 2; ; i++) {
    if (!used.has(`${base.toLowerCase()} ${i}`)) return `${base} ${i}`;
  }
}

const PICKED = new Set(NAMES.map((name) => name.toLowerCase()));

/** A name pickBotName could have given ("Pip", "Pip 2"): New bot sends one from /api/bot-defaults' suggestedName. */
export function isPickedBotName(name: string): boolean {
  return PICKED.has(name.trim().toLowerCase().replace(/ \d+$/, ""));
}
