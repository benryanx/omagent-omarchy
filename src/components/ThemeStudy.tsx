import { useState, type CSSProperties } from "react";
import { mascotColorGradient, OmagentAvatar } from "./Avatar";
import type { OmagentState } from "@/lib/mascot";
import { OMARCHY_PALETTES } from "@/lib/omarchy-palettes";
import { OMAGENT_SHAPES } from "../../shared/omagent-bodies";
import { ANIMAL_BODIES, ANIMAL_BODY_IDS, isAnimalBody, type AnimalBodyId } from "../../shared/animal-bodies";
import { FESTIVE_BODIES, FESTIVE_BODY_IDS, isFestiveBody, type FestiveBodyId } from "../../shared/festive-bodies";
import "./theme-study.css";

type Palette = (typeof OMARCHY_PALETTES)[number];
type Channel = "blue" | "green" | "magenta" | "red" | "yellow" | "cyan";
type Shape = "omagent" | "circle" | "squircle" | "star" | keyof typeof OMAGENT_SHAPES | FestiveBodyId | AnimalBodyId;
const CHANNELS: Channel[] = ["blue", "green", "magenta", "red", "yellow", "cyan"];
const SHAPES: Shape[] = ["omagent", "circle", "squircle", "star", "step", "notch"];
const SHAPE_NAMES: Record<Shape, string> = { omagent: "Omarchy", circle: "Circle", squircle: "Square", star: "Star", step: "Step", notch: "Notch", ...Object.fromEntries(ANIMAL_BODY_IDS.map(id => [id, ANIMAL_BODIES[id].name])), ...Object.fromEntries(FESTIVE_BODY_IDS.map(id => [id, FESTIVE_BODIES[id].name])) } as Record<Shape, string>;
const STATES: OmagentState[] = ["idle", "working", "thinking", "happy", "sleeping"];
const COMPARE_IDS = ["tokyo-night", "catppuccin", "gruvbox", "everforest", "nord", "rose-pine"];

function faceInk(hex: string): "black" | "white" {
  const channels = [1, 3, 5].map(start => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? "black" : "white";
}

function paletteStyle(palette: Palette): CSSProperties {
  return {
    "--theme-bg": palette.background,
    "--theme-panel": palette.dark_background,
    "--theme-raised": palette.lighter_background,
    "--theme-ink": palette.foreground,
    "--theme-muted": palette.light_foreground,
    "--theme-accent": palette.accent,
    "--theme-line": palette.selection,
    colorScheme: palette.mode,
  } as CSSProperties;
}

function ThemedMascot({ palette, shape, channel, state, size, animated, shaded }: {
  palette: Palette; shape: Shape; channel: Channel; state: OmagentState; size: number; animated: boolean; shaded: boolean;
}) {
  const fill = palette[channel];
  const custom = shape === "step" || shape === "notch" ? OMAGENT_SHAPES[shape] : undefined;
  const bodyId = shape === "circle" || shape === "squircle" || shape === "star" || isFestiveBody(shape) || isAnimalBody(shape) ? shape : undefined;
  return <OmagentAvatar color="blue" bodyId={bodyId} silhouette={custom} state={state} size={size}
    gradient={shaded ? mascotColorGradient(fill) : [fill, fill, fill]}
    faceColor={shape === "omagent" ? palette.mode === "light" ? "black" : "white" : faceInk(fill)} animated={animated} trackPointer={animated} label={`${SHAPE_NAMES[shape]}, ${palette.name}, ${state}`} />;
}

export function ThemeStudy() {
  const [themeId, setThemeId] = useState<string>("tokyo-night");
  const [shape, setShape] = useState<Shape>("omagent");
  const [channel, setChannel] = useState<Channel>("blue");
  const [state, setState] = useState<OmagentState>("idle");
  const [animated, setAnimated] = useState(true);
  const [shaded, setShaded] = useState(true);
  const palette = OMARCHY_PALETTES.find(theme => theme.id === themeId) ?? OMARCHY_PALETTES[0];
  const mascot = (size: number, theme = palette, body = shape) => <ThemedMascot palette={theme} shape={body} channel={channel} state={state} size={size} animated={animated} shaded={shaded} />;

  return <section className="theme-study" style={paletteStyle(palette)} aria-labelledby="theme-study-title">
    <header className="theme-study-heading">
      <div><p className="theme-kicker">Omagent / Shape studies</p><h1 id="theme-study-title">A smaller cast. More character.</h1><p>The Omarchy mark, three familiar shapes, and two new originals.</p></div>
      <div className="theme-study-links"><a href="/omarchy-logo.svg" target="_blank" rel="noreferrer">Original Omarchy SVG ↗</a><a href="https://omarchy.org/manual/themes/" target="_blank" rel="noreferrer">Explore Omarchy themes ↗</a></div>
    </header>

    <div className="theme-workbench">
      <aside className="theme-selector" aria-label="Omarchy palette">
        <div className="theme-selector-heading"><h2>Themes</h2><span>{OMARCHY_PALETTES.length}</span></div>
        <div className="theme-options">
          {OMARCHY_PALETTES.map(theme => <button type="button" key={theme.id} aria-pressed={themeId === theme.id} onClick={() => setThemeId(theme.id)}>
            <span className="theme-sample" style={{ background: theme.background }}>{[theme.blue, theme.green, theme.magenta].map((color, i) => <i key={i} style={{ background: color }} />)}</span>
            <span>{theme.name}</span><small>{theme.mode === "light" ? "☀" : ""}</small>
          </button>)}
        </div>
      </aside>

      <div className="theme-main">
        <div className="theme-stage">
          <div className="theme-character"><span className="theme-kicker">{palette.name}</span>{mascot(212)}<span className="theme-character-label">{SHAPE_NAMES[shape]} / {state}</span></div>
          <div className="theme-context" aria-label="Workspace appearance sample">
            <div className="theme-context-bar"><span className="theme-status-dot" />Workspace<span>LOCAL</span></div>
            <div className="theme-context-message">Let’s make it feel at home.</div>
            <div className="theme-context-reply">{mascot(36)}<div><strong>Omagent</strong><p>Same familiar face.<br />A palette that belongs on your desktop.</p></div></div>
            <div className="theme-context-code"><span>~/omagent</span><code><b>✓</b> Ready when you are<span>▍</span></code></div>
            <div className="theme-context-composer">Ask Omagent anything<span>↑</span></div>
          </div>
        </div>

        <div className="theme-controls">
          <div className="theme-channels" role="group" aria-label="Mascot palette colour">{CHANNELS.map(color => <button type="button" key={color} aria-label={color} title={`${color} · ${palette[color]}`} aria-pressed={channel === color} onClick={() => setChannel(color)} style={{ "--swatch": palette[color] } as CSSProperties} />)}</div>
          <select aria-label="Mascot expression" value={state} onChange={e => setState(e.target.value as OmagentState)}>{STATES.map(value => <option key={value}>{value}</option>)}</select>
          <label><input type="checkbox" checked={animated} onChange={e => setAnimated(e.target.checked)} />Animate</label>
          <label><input type="checkbox" checked={shaded} onChange={e => setShaded(e.target.checked)} />Shading</label>
        </div>

        <div className="theme-shape-heading"><h2>The Omagent cast</h2><span>Six shapes · choose a character</span></div>
        <div className="theme-shapes" role="group" aria-label="Omagent mascot shapes">{SHAPES.map(body => <button type="button" key={body} aria-pressed={shape === body} onClick={() => setShape(body)}>{mascot(64, palette, body)}<span>{SHAPE_NAMES[body]}</span>{(body === "step" || body === "notch") && <small>NEW STUDY</small>}</button>)}</div>
        <div className="theme-shape-heading"><h2>Animals</h2><span>A few friendly faces</span></div>
        <div className="theme-shapes" role="group" aria-label="Animal mascot shapes">{ANIMAL_BODY_IDS.map(body => <button type="button" key={body} aria-pressed={shape === body} onClick={() => setShape(body)}>{mascot(64, palette, body)}<span>{SHAPE_NAMES[body]}</span></button>)}</div>
        <div className="theme-shape-heading"><h2>Festive looks</h2><span>A little end-of-year character</span></div>
        <div className="theme-shapes" role="group" aria-label="Festive mascot shapes">{FESTIVE_BODY_IDS.map(body => <button type="button" key={body} aria-pressed={shape === body} onClick={() => setShape(body)}>{mascot(64, palette, body)}<span>{SHAPE_NAMES[body]}</span></button>)}</div>
        <div className="theme-size-check"><span>Sidebar sizes</span>{[24, 32, 48].map(size => <div key={size}>{mascot(size)}<small>{size}px</small></div>)}<p>{shape === "step" ? "A stepped silhouette with a diagonal rhythm." : shape === "notch" ? "Offset openings cut into a solid tile." : "The familiar shapes, with the same face and shading."}</p></div>
        <div className="theme-palette-strip" aria-label="Selected theme palette">{["background", "foreground", ...CHANNELS].map(color => <div key={color}><i style={{ background: palette[color as keyof Palette] }} /><span>{palette[color as keyof Palette]}</span></div>)}</div>
      </div>
    </div>

    <div className="theme-comparison-heading"><h2>One character, different worlds.</h2><p>Same shape, expression and colour role across six palettes.</p></div>
    <div className="theme-comparison">{COMPARE_IDS.map(id => {
      const theme = OMARCHY_PALETTES.find(item => item.id === id)!;
      return <button type="button" key={id} style={paletteStyle(theme)} aria-pressed={themeId === id} onClick={() => setThemeId(id)}>{mascot(90, theme)}<strong>{theme.name}</strong><span>{theme.mode}</span></button>;
    })}</div>
    <footer className="theme-study-footer">Palettes from the installed Omarchy theme files. Preview only — choosing a theme here changes this study.</footer>
  </section>;
}
