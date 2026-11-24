import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { CHROME_EYES, CHROME_GRADIENT, OMAGENT_COLORS, type OmagentColor, type OmagentMotion, type OmagentState } from "@/lib/mascot";
import { CursorAvatar, type CursorAvatarHandle, type CursorSilhouette } from "./CursorAvatar";
import { avatarCropRadius, botAvatarProfile, clampAvatarFocus, clampAvatarZoom, mascotFaceInk, type BotAvatarCrop, type MascotFaceColor } from "../../shared/bot-avatar";
import { MASCOT_BODIES, botMascotBody } from "../../shared/mascot-bodies";
import { isHalloweenBody, type BotBodyId } from "../../shared/bot-body";
import { useHalloweenDressed, wornBody } from "@/lib/halloween-dress";
import { CarvedAvatar } from "./CarvedAvatar";
import { OMAGENT_CUSTOM_BODIES, OMARCHY_SILHOUETTE, isOmagentCustomBody } from "../../shared/omagent-bodies";
import { ANIMAL_BODIES, isAnimalBody } from "../../shared/animal-bodies";
import { FESTIVE_BODIES, isFestiveBody } from "../../shared/festive-bodies";
import { useFestiveDressed, festiveBody } from "@/lib/festive-dress";
import { steelBodyImage } from "@/lib/steel-body";

export const EYE_SCALE = 1.12;
export const MOUTH_WEIGHT = 11;

const POINTER_GAZE = { forward: 1, authored: 0.25 };


interface MotionFaces
  extends Partial<
    Record<Exclude<OmagentMotion, "none">, { state?: OmagentState; blink?: boolean; spin?: number }>
  > {}

const MOTION_FACE: MotionFaces = {
  arrive: { state: "spawning", spin: 900 },
  switch: { state: "waking", spin: 620 },
  customize: { state: "proud", blink: true },
  alert: { state: "alerting" },
  thinking: { state: "thinking" },
  working: { state: "working" },
  launch: { state: "loading" },
  success: { state: "happy", blink: true },
  celebrate: { state: "celebrate", spin: 700 },
  blink: { blink: true },
  surprise: { state: "surprised", blink: true },
  failure: { state: "sad" },
};

const MOTION_FACE_MS = 1400;

function mix(hex: string, toward: string, t: number): string {
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(toward.slice(1), 16);
  const channel = (shift: number) => {
    const va = (a >> shift) & 0xff;
    const vb = (b >> shift) & 0xff;
    return Math.round(va + (vb - va) * t);
  };
  return `#${[channel(16), channel(8), channel(0)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

const gradientFor = (color: OmagentColor): [string, string, string] => {
  if (color === "chrome") return CHROME_GRADIENT;
  const fill = `var(--identity-${color}, ${OMAGENT_COLORS[color] ?? OMAGENT_COLORS.green})`;
  return [`color-mix(in srgb, ${fill} 45%, #ffffff)`, fill, `color-mix(in srgb, ${fill} 58%, #000000)`];
};

export function mascotColorGradient(fill: string): [string, string, string] {
  return [mix(fill, "#ffffff", 0.55), fill, mix(fill, "#000000", 0.42)];
}

export function roomAvatarGradient(color: OmagentColor): [string, string, string] {
  const fill = `var(--identity-${color})`;
  return [
    `color-mix(in srgb, ${fill} 82%, #ffffff)`,
    fill,
    `color-mix(in srgb, ${fill} 82%, #000000)`,
  ];
}

export type OmagentAvatarHandle = CursorAvatarHandle;

export type OmagentAvatarProps = {
  color: OmagentColor;
  state?: OmagentState;
  expression?: number;
  size?: number;
  label?: string;
  motion?: OmagentMotion;
  motionKey?: number;
  turn?: number;
  gaze?: { x?: number; y?: number };
  spring?: number;
  eyeScale?: number;
  showMouth?: boolean;
  mouthStroke?: number;
  forward?: boolean;
  lookAround?: number;
  trackPointer?: boolean;
  animated?: boolean;
  bodyId?: BotBodyId;
  silhouette?: CursorSilhouette;
  gradient?: [string, string, string];
  faceColor?: MascotFaceColor | null;
};

function OmagentAvatarComponent(props: OmagentAvatarProps, ref: React.Ref<OmagentAvatarHandle>) {
  const { bodyId, color, size, state, motion, motionKey, gaze, trackPointer, animated, label } = props;
  if (isHalloweenBody(bodyId)) {
    return (
      <CarvedAvatar
        ref={ref}
        body={bodyId}
        color={color}
        faceColor={props.faceColor}
        size={size}
        state={state}
        motion={motion}
        motionKey={motionKey}
        gaze={gaze}
        trackPointer={trackPointer}
        animated={animated}
        label={label}
      />
    );
  }
  return <GradientAvatar ref={ref} {...props} />;
}

function GradientAvatarComponent(
  {
    color,
    state = "idle",
    expression,
    size = 44,
    label,
    motion = "none",
    motionKey = 0,
    turn,
    gaze,
    spring,
    eyeScale,
    showMouth,
    mouthStroke,
    forward = true,
    lookAround,
    trackPointer = true,
    animated = true,
    bodyId,
    silhouette: customSilhouette,
    gradient,
    faceColor,
  }: OmagentAvatarProps,
  ref: React.Ref<OmagentAvatarHandle>,
) {
  const silhouette = customSilhouette ?? (isAnimalBody(bodyId) ? ANIMAL_BODIES[bodyId] : isFestiveBody(bodyId) ? FESTIVE_BODIES[bodyId] : isOmagentCustomBody(bodyId) ? OMAGENT_CUSTOM_BODIES[bodyId] : bodyId ? MASCOT_BODIES[botMascotBody(bodyId)] : OMARCHY_SILHOUETTE);
  const chrome = color === "chrome";
  const faceInk = mascotFaceInk(faceColor);
  const inner = useRef<CursorAvatarHandle>(null);
  useImperativeHandle(ref, () => ({
    blink: () => inner.current?.blink(),
    spin: (durationMs?: number) => inner.current?.spin(durationMs),
    setExpression: (index: number) => inner.current?.setExpression(index),
  }));

  const [motionState, setMotionState] = useState<OmagentState | null>(null);
  useEffect(() => {
    if (motion === "none" || !animated) return;
    const beat = MOTION_FACE[motion];
    if (!beat) return;
    if (beat.blink) inner.current?.blink();
    if (beat.spin) inner.current?.spin(beat.spin);
    if (!beat.state) return;
    setMotionState(beat.state);
    const timer = setTimeout(() => setMotionState(null), MOTION_FACE_MS);
    return () => clearTimeout(timer);
  }, [motion, motionKey, animated]);

  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const range = forward ? POINTER_GAZE.forward : POINTER_GAZE.authored;
  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!trackPointer || !animated) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPointer({
      x: Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1)) * range,
      y: Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1)) * range,
    });
  };
  const onPointerLeave = () => setPointer({ x: 0, y: 0 });

  return (
    <span
      className="inline-flex shrink-0"
      onPointerMove={trackPointer && animated ? onPointerMove : undefined}
      onPointerLeave={trackPointer && animated ? onPointerLeave : undefined}
    >
      <CursorAvatar
        ref={inner}
        state={motionState ?? state}
        expression={expression}
        size={size}
        silhouette={silhouette}
        gradient={gradient ?? gradientFor(color)}
        picture={chrome && !faceInk && bodyId ? steelBodyImage(bodyId, size, globalThis.devicePixelRatio ?? 1) : null}
        eyeColor={faceInk ?? (chrome ? CHROME_EYES : (bodyId === "omarchy" || !bodyId) ? "var(--omarchy-mascot-ink, #ffffff)" : `var(--identity-${color}-ink, #ffffff)`)}
        title={label ?? null}
        lookAround={lookAround ?? (forward ? 0 : 1)}
        gaze={{ x: (gaze?.x ?? 0) + pointer.x, y: (gaze?.y ?? 0) + pointer.y }}
        turn={turn}
        spring={spring}
        eyeScale={eyeScale}
        showMouth={showMouth}
        mouthStroke={mouthStroke}
        paused={!animated}
      />
    </span>
  );
}

const GradientAvatar = forwardRef(GradientAvatarComponent);

export const OmagentAvatar = memo(forwardRef(OmagentAvatarComponent));

export type BotAvatarProps = Omit<OmagentAvatarProps, "color" | "gradient"> & {
  readable?: boolean;
  bot: {
    name?: string;
    color: OmagentColor;
    avatarUrl?: string | null;
    avatarCrop?: BotAvatarCrop;
    avatarZoom?: number;
    avatarFocusX?: number;
    avatarFocusY?: number;
    mascotBody?: BotBodyId | null;
    mascotFaceColor?: MascotFaceColor | null;
  };
};

export type BotAvatarOutcome = "flatImage" | "gradientMascot";

/** Mirrored name for name by resolveBotAvatarOutcome in ios/Sources/CompanionCore/BotAvatarRendering.swift. */
export function resolveBotAvatarOutcome(params: {
  avatarCrop: BotAvatarCrop;
  hasUrl: boolean;
  imageFailed: boolean;
}): BotAvatarOutcome {
  const { avatarCrop, hasUrl, imageFailed } = params;
  if (!hasUrl) return "gradientMascot";
  if (avatarCrop === "mascot") return "gradientMascot";
  if (imageFailed) return "gradientMascot";
  return "flatImage";
}

export function BotAvatar({ bot, size = 44, label, readable = false, ...mascotProps }: BotAvatarProps) {
  const profile = botAvatarProfile(bot);
  const dressed = useHalloweenDressed();
  const festive = useFestiveDressed();
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [profile.avatarUrl]);

  const outcome = resolveBotAvatarOutcome({
    avatarCrop: profile.avatarCrop,
    hasUrl: Boolean(profile.avatarUrl),
    imageFailed,
  });

  if (outcome !== "flatImage") {
    return (
      <OmagentAvatar
        bodyId={festive ? festiveBody(bot.mascotBody, bot.color, true) : wornBody(bot.mascotBody, bot.color, dressed)}
        {...mascotProps}
        color={bot.color}
        faceColor={bot.mascotFaceColor}
        gradient={readable ? roomAvatarGradient(bot.color) : undefined}
        size={size}
        label={label ?? bot.name}
      />
    );
  }

  const radius = avatarCropRadius(profile.avatarCrop);
  const zoom = clampAvatarZoom(bot.avatarZoom ?? 1);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? 0.5);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? 0.5);
  const origin = `${focusX * 100}% ${focusY * 100}%`;
  return (
    <span
      className="relative block shrink-0 overflow-hidden bg-raised"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <img
        src={profile.avatarUrl}
        alt={label ?? (bot.name ? `${bot.name} avatar` : "Bot avatar")}
        width={size}
        height={size}
        draggable={false}
        onError={() => setImageFailed(true)}
        className="block size-full max-w-none object-cover"
        style={{
          width: size,
          height: size,
          objectPosition: origin,
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: origin,
        }}
      />
    </span>
  );
}

export function InitialsAvatar({
  initials,
  avatarUrl,
  size = 32,
  fallback,
  fontSize,
  className,
}: {
  initials: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
  /** drawn instead of the initials, for a person with no name or email to take them from */
  fallback?: ReactNode;
  fontSize?: number;
}) {
  // A picture that is gone (a restored backup carries the address, not the file) falls back to the initials.
  const [failed, setFailed] = useState<string | null>(null);
  if (avatarUrl && failed !== avatarUrl) {
    return <img src={avatarUrl} alt="" onError={() => setFailed(avatarUrl)} className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  }
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary font-medium", className)}
      style={{ width: size, height: size, fontSize: fontSize ?? size * 0.38 }}
    >
      {fallback ?? initials}
    </div>
  );
}
