import type { MascotBody } from "./mascot-bodies.ts";

export const ANIMAL_BODY_IDS = ["kitten", "dog", "fox", "penguin"] as const;
export type AnimalBodyId = (typeof ANIMAL_BODY_IDS)[number];
type AnimalBody = Omit<MascotBody, "id"> & { id: AnimalBodyId; outline: string };

function body(id: AnimalBodyId, name: string, outline: string, decoration: string, anchor: MascotBody["anchor"]): AnimalBody {
  return {
    id, name, outline,
    fit: "scale(1.142705)",
    body: `<path d="${outline}" fill="{{GRADIENT}}"/>${decoration}`,
    clip: `<path d="${outline}"/>`,
    anchor,
  };
}

export const ANIMAL_BODIES: Record<AnimalBodyId, AnimalBody> = {
  kitten: body("kitten", "Kitten",
    "M22 76L18 12L70 43Q100 32 130 43L182 12L178 76Q194 96 190 127Q186 187 100 194Q14 187 10 127Q6 96 22 76Z",
    '<path d="M32 34L38 70L61 55ZM168 34L139 55L162 70Z" fill="var(--omarchy-mascot-ink, #ffffff)" opacity=".35"/><path d="M20 133L46 138M19 149L45 148M180 133L154 138M181 149L155 148" fill="none" stroke="var(--omarchy-mascot-ink, #ffffff)" stroke-width="4" stroke-linecap="round" opacity=".5"/>',
    { x: 114.27, y: 131, scale: .65 }),
  dog: body("dog", "Dog",
    "M53 48Q100 24 147 48Q173 30 186 61L198 121Q202 151 180 155L166 143Q158 193 100 196Q42 193 34 143L20 155Q-2 151 2 121L14 61Q27 30 53 48Z",
    '<path d="M47 54Q29 48 24 72L14 121Q9 145 21 143L34 127ZM153 54Q171 48 176 72L186 121Q191 145 179 143L166 127Z" fill="var(--omarchy-mascot-ink, #ffffff)" opacity=".3"/>',
    { x: 114.27, y: 133, scale: .65 }),
  fox: body("fox", "Fox",
    "M16 9L74 45Q100 36 126 45L184 9L174 87L196 119L165 165L100 198L35 165L4 119L26 87Z",
    '<path d="M29 32L38 76L61 57ZM171 32L139 57L162 76Z" fill="var(--omarchy-mascot-ink, #ffffff)" opacity=".45"/><path d="M14 122L53 142L70 174L38 157ZM186 122L147 142L130 174L162 157Z" fill="var(--omarchy-mascot-ink, #ffffff)" opacity=".55"/>',
    { x: 114.27, y: 128, scale: .61 }),
  penguin: body("penguin", "Penguin",
    "M47 76Q43 7 100 7Q157 7 153 76L187 124Q201 148 180 156L162 143L165 177L181 193L172 200H119L100 191L81 200H28L19 193L35 177L38 143L20 156Q-1 148 13 124Z",
    '<path d="M64 83Q100 63 136 83Q155 109 149 157Q145 184 100 187Q55 184 51 157Q45 109 64 83Z" fill="var(--omarchy-mascot-ink, #ffffff)" opacity=".18"/><path d="M37 184L76 187L81 197H31ZM163 184L124 187L119 197H169Z" fill="var(--omarchy-mascot-ink, #ffffff)" opacity=".45"/>',
    { x: 114.27, y: 133, scale: .56 }),
};

export function isAnimalBody(value: unknown): value is AnimalBodyId {
  return typeof value === "string" && Object.hasOwn(ANIMAL_BODIES, value);
}
