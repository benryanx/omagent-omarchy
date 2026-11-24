import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot } from "@/state/store";
import { OMAGENT_BODY_IDS, OMAGENT_BODY_NAMES } from "../../shared/omagent-bodies";
import { HALLOWEEN_BODIES } from "../../shared/halloween-bodies";
import { BotProfileAvatarCard } from "./BotProfileAvatarCard";

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    threadId: "thread-1",
    name: "Omagent",
    title: "Omagent",
    description: "",
    notifications: false,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "local", model: "test-model" },
    messages: [],
    ...overrides,
  };
}

function renderCard(bot: Bot) {
  return renderToStaticMarkup(
    createElement(
      StoreProvider,
      null,
      createElement(BotProfileAvatarCard, {
        bot,
        activeState: "idle",
        mascotMotion: null,
        onPatch: vi.fn(),
      }),
    ),
  );
}

describe("BotProfileAvatarCard body picker", () => {
  it("renders one option per body catalog entry, labeled by name", () => {
    const markup = renderCard(makeBot());

    expect(markup).toContain(">Body<");
    for (const id of OMAGENT_BODY_IDS) {
      expect(markup).toContain(`aria-label="Use the ${OMAGENT_BODY_NAMES[id]} body"`);
    }
  });

  it("hides Halloween choices while preserving an existing Halloween body", () => {
    const markup = renderCard(makeBot({ mascotBody: "witch" }));

    expect(markup).not.toContain(">Halloween<");
    expect(markup).not.toContain('aria-label="Use the Pumpkin body"');
    expect(markup).toContain(">Festive looks<");
    expect(markup).toContain(`aria-pressed="true" aria-label="Use the ${HALLOWEEN_BODIES.witch.name} body"`);
  });

  it("marks the current body pressed and the rest unpressed, defaulting to Omarchy", () => {
    const markup = renderCard(makeBot());

    expect(markup).toContain(`aria-pressed="true" aria-label="Use the ${OMAGENT_BODY_NAMES.omarchy} body"`);
    expect(markup).toContain(`aria-pressed="false" aria-label="Use the ${OMAGENT_BODY_NAMES.star} body"`);
  });

  it("reflects an explicitly chosen body", () => {
    const markup = renderCard(makeBot({ mascotBody: "star" }));

    expect(markup).toContain(`aria-pressed="true" aria-label="Use the ${OMAGENT_BODY_NAMES.star} body"`);
    expect(markup).toContain(`aria-pressed="false" aria-label="Use the ${OMAGENT_BODY_NAMES.omarchy} body"`);
  });

  it("offers zoom and drag framing for a custom image", () => {
    const markup = renderCard(makeBot({
      avatarUrl: "/api/attachments/cat.webp",
      avatarCrop: "circle",
      avatarZoom: 1.5,
    }));
    expect(markup).toContain('aria-label="Zoom avatar"');
    expect(markup).toContain("Drag the picture to reposition it");
    expect(markup).toContain("150%");
    expect(markup).toContain("Reset framing");
  });

  it("hides zoom controls for the mascot", () => {
    const markup = renderCard(makeBot());
    expect(markup).not.toContain('aria-label="Zoom avatar"');
  });

  it("hides the body picker for flat crops that have no mascot to wear one", () => {
    const markup = renderCard(makeBot({ avatarCrop: "circle" }));

    expect(markup).not.toContain(">Body<");
    expect(markup).not.toContain(`aria-label="Use the ${OMAGENT_BODY_NAMES.omarchy} body"`);
  });

  it("hides the body picker for every flat crop, not just circle", () => {
    for (const crop of ["rounded", "square"] as const) {
      const markup = renderCard(makeBot({ avatarCrop: crop }));

      expect(markup).not.toContain(">Body<");
    }
  });
});
