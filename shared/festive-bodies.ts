import type { MascotBody } from "./mascot-bodies.ts";

export const FESTIVE_BODY_IDS = ["bauble", "gift", "bell", "tree", "gingerbread", "stocking", "santa"] as const;
export type FestiveBodyId = (typeof FESTIVE_BODY_IDS)[number];
type FestiveBody = Omit<MascotBody, "id"> & { id: FestiveBodyId; outline: string };

function body(id: FestiveBodyId, name: string, outline: string, decoration: string, anchor: MascotBody["anchor"]): FestiveBody {
  return {
    id, name, outline,
    fit: "scale(1.142705)",
    body: `<path d="${outline}" fill="{{GRADIENT}}"/>${decoration}`,
    clip: `<path d="${outline}"/>`,
    anchor,
  };
}

const detail = (markup: string) => `<g fill="var(--omarchy-mascot-ink, #ffffff)" opacity=".45">${markup}</g>`;

export const FESTIVE_BODIES: Record<FestiveBodyId, FestiveBody> = {
  santa: body("santa", "Santa",
    "M32 86Q22 139 44 166L62 165L75 186L88 180L100 199L112 180L125 186L138 165L156 166Q178 139 168 86L160 66Q142 7 99 8Q67 8 44 29L23 49Q2 46 3 65Q4 83 23 79L36 74Z",
    '<path d="M39 83Q100 66 161 83L162 136Q145 177 100 193Q55 177 38 136Z" fill="#f4f0e8"/><path d="M48 88Q100 76 152 88L147 127Q100 150 53 127Z" fill="{{GRADIENT}}"/><path d="M38 69Q100 53 162 69L168 90Q100 76 32 90Z" fill="#fffaf0"/><circle cx="19" cy="64" r="16" fill="#fffaf0"/><path d="M76 150Q100 164 124 150" fill="none" stroke="#d9d4cc" stroke-width="4" stroke-linecap="round"/>',
    { x: 114.27, y: 124, scale: .43 }),
  bauble: body("bauble", "Bauble",
    "M180 116C180 160.183 144.183 196 100 196C55.817 196 20 160.183 20 116C20 71.817 55.817 36 100 36C144.183 36 180 71.817 180 116ZM80 24H120V42H80ZM92 6H108V28H92Z",
    detail('<path d="M84 24H116V30H84Z"/><path d="M43 84C46 72 53 63 63 57L67 63C58 70 53 78 50 88Z"/>'),
    { x: 114.27, y: 132.55, scale: .73 }),
  gift: body("gift", "Gift",
    "M14 72H186V186C186 192 182 196 176 196H24C18 196 14 192 14 186ZM6 48H194V80H6ZM98 48C67 48 32 39 32 22C32 2 68 3 100 40C132 3 168 2 168 22C168 39 133 48 102 48ZM94 48H106V60H94Z",
    detail('<path d="M155 80H168V196H155ZM6 67H194V75H6Z"/>'),
    { x: 105, y: 157, scale: .64 }),
  bell: body("bell", "Bell",
    "M40 130V88C40 50 67 26 100 26C133 26 160 50 160 88V130L184 162C188 168 185 174 176 174H24C15 174 12 168 16 162ZM86 18C86 10 92 6 100 6C108 6 114 10 114 18V30H86ZM86 174H114V183C114 191 108 197 100 197C92 197 86 191 86 183Z",
    detail('<path d="M29 157H171L177 166H23Z"/>'),
    { x: 114.27, y: 118, scale: .65 }),
  tree: body("tree", "Tree",
    "M100 6L144 56H128L170 106H150L194 170H122V196H78V170H6L50 106H30L72 56H56Z",
    detail('<circle cx="62" cy="94" r="6"/><circle cx="158" cy="146" r="7"/><circle cx="42" cy="149" r="6"/><path d="M87 174H113V182H87Z"/>'),
    { x: 114.27, y: 145, scale: .58 }),
  gingerbread: body("gingerbread", "Gingerbread",
    "M136 42C136 62 120 78 100 78C80 78 64 62 64 42C64 22 80 6 100 6C120 6 136 22 136 42ZM72 69H128L178 90C191 96 197 106 191 117C185 128 175 129 163 122L139 109L132 139L154 171C164 185 160 197 148 199C137 201 132 193 125 183L100 155L75 183C68 193 63 201 52 199C40 197 36 185 46 171L68 139L61 109L37 122C25 129 15 128 9 117C3 106 9 96 22 90Z",
    detail('<circle cx="100" cy="104" r="6"/><circle cx="100" cy="126" r="6"/><path d="M21 99L27 95L40 117L34 121ZM160 117L173 95L179 99L166 121ZM47 180L55 169L71 184L66 190ZM129 184L145 169L153 180L134 190Z"/>'),
    { x: 114.27, y: 47, scale: .37 }),
  stocking: body("stocking", "Stocking",
    "M74 32H170V126C193 147 191 166 172 182C157 195 140 198 118 196L42 200C21 201 10 191 10 177C10 163 18 152 32 144L74 120ZM66 6H178V40H66Z",
    detail('<path d="M66 27H178V40H66Z"/><path d="M17 161C33 158 47 169 50 197L37 199C20 197 10 190 10 177C10 170 12 165 17 161ZM163 138C175 142 182 150 181 162L168 161C168 153 165 150 158 147Z"/>'),
    { x: 139, y: 95, scale: .48 }),
};

export function isFestiveBody(value: unknown): value is FestiveBodyId {
  return typeof value === "string" && Object.hasOwn(FESTIVE_BODIES, value);
}
