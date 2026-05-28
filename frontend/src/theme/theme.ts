// Prayers Loft — "Midnight Indigo + Warm Sand" design tokens (2026 refinement).
export const colors = {
  // Background
  bg: "#0F172A",
  bgDeep: "#0A1020",
  bgSecondary: "#1E293B",

  // Layered surfaces (soft tints, subtle)
  surface1: "rgba(255,255,255,0.04)",
  surface2: "rgba(255,255,255,0.05)",
  surface3: "rgba(255,255,255,0.07)",
  hairline: "rgba(255,255,255,0.08)",

  // Accent: warm sand gold (softer, more refined)
  accent: "#C8A96B",
  accentSoft: "rgba(200,169,107,0.14)",
  accentGlow: "rgba(200,169,107,0.06)",
  warmHighlight: "#E8DCCB",

  // Text
  text: "#F8FAFC",
  textSecondary: "rgba(248,250,252,0.68)",
  textTertiary: "rgba(248,250,252,0.4)",
  textOnAccent: "#0F172A",

  // Legacy aliases
  bgTop: "#0F172A",
  bgBottom: "#0F172A",
  ivory: "#E8DCCB",
  gold: "#C8A96B",
  goldHover: "#B89858",
  textPrimary: "#F8FAFC",
  textMuted: "rgba(248,250,252,0.4)",
  onCard: "#0F172A",
  onCardMuted: "rgba(15,23,42,0.65)",
  glassBg: "rgba(255,255,255,0.05)",
  glassBorder: "rgba(255,255,255,0.08)",
  navBg: "rgba(15,23,42,0.6)",
  navBorder: "rgba(255,255,255,0.06)",
};

export const emotionColors: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  Grateful: { bg: "rgba(200,169,107,0.14)", border: "rgba(200,169,107,0.3)", text: "#E0C089" },
  Hopeful:  { bg: "rgba(148,180,238,0.12)", border: "rgba(148,180,238,0.28)", text: "#B0CAEC" },
  Anxious:  { bg: "rgba(232,176,176,0.12)", border: "rgba(232,176,176,0.28)", text: "#E8B8B8" },
  Peaceful: { bg: "rgba(160,220,188,0.12)", border: "rgba(160,220,188,0.28)", text: "#B8E0C8" },
  Confused: { bg: "rgba(184,164,224,0.12)", border: "rgba(184,164,224,0.28)", text: "#CCB4E4" },
  Joyful:   { bg: "rgba(232,212,160,0.12)", border: "rgba(232,212,160,0.28)", text: "#E8D098" },
  Tired:    { bg: "rgba(172,180,196,0.12)", border: "rgba(172,180,196,0.28)", text: "#C8CCD4" },
  Seeking:  { bg: "rgba(228,176,208,0.12)", border: "rgba(228,176,208,0.28)", text: "#E4B8D0" },
};

export const fonts = {
  // Primary: Inter (premium system feel).
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemibold: "Inter_600SemiBold",
  sansBold: "Inter_700Bold",
  // Serif (Crimson Text) — reserved for verses and prayer body only.
  serif: "CrimsonText_400Regular",
  serifItalic: "CrimsonText_400Regular_Italic",
  serifBold: "CrimsonText_700Bold",
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };

export const radii = { sm: 12, md: 16, lg: 20, xl: 26, pill: 999 };
