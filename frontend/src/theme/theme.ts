// Prayers Loft — premium minimal design tokens (2026 refresh).
export const colors = {
  // Background
  bg: "#0B1020",
  bgDeep: "#070A16",

  // Layered surfaces (soft tints, no borders)
  surface1: "rgba(255,255,255,0.04)",
  surface2: "rgba(255,255,255,0.06)",
  surface3: "rgba(255,255,255,0.08)",
  hairline: "rgba(255,255,255,0.06)",

  // Accent: muted warm gold
  accent: "#D4B36A",
  accentSoft: "rgba(212,179,106,0.16)",
  accentGlow: "rgba(212,179,106,0.08)",

  // Text
  text: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.7)",
  textTertiary: "rgba(255,255,255,0.45)",
  textOnAccent: "#0B1020",

  // Legacy aliases (kept for components not yet migrated)
  bgTop: "#0B1020",
  bgBottom: "#0B1020",
  ivory: "#F6F4EE",
  gold: "#D4B36A",
  goldHover: "#C4A45A",
  textPrimary: "#FFFFFF",
  textMuted: "rgba(255,255,255,0.45)",
  onCard: "#0B1020",
  onCardMuted: "rgba(11,16,32,0.65)",
  glassBg: "rgba(255,255,255,0.04)",
  glassBorder: "rgba(255,255,255,0.06)",
  navBg: "rgba(11,16,32,0.78)",
  navBorder: "rgba(255,255,255,0.06)",
};

export const emotionColors: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  Grateful: { bg: "rgba(212,179,106,0.14)", border: "rgba(212,179,106,0.3)", text: "#E6C878" },
  Hopeful:  { bg: "rgba(138,180,248,0.14)", border: "rgba(138,180,248,0.3)", text: "#A8C8FF" },
  Anxious:  { bg: "rgba(248,168,168,0.14)", border: "rgba(248,168,168,0.3)", text: "#F8B8B8" },
  Peaceful: { bg: "rgba(138,224,180,0.14)", border: "rgba(138,224,180,0.3)", text: "#A8E0C0" },
  Confused: { bg: "rgba(180,148,228,0.14)", border: "rgba(180,148,228,0.3)", text: "#D4B4F0" },
  Joyful:   { bg: "rgba(248,212,138,0.14)", border: "rgba(248,212,138,0.3)", text: "#F8D48A" },
  Tired:    { bg: "rgba(168,168,180,0.14)", border: "rgba(168,168,180,0.3)", text: "#D0D0D8" },
  Seeking:  { bg: "rgba(248,168,212,0.14)", border: "rgba(248,168,212,0.3)", text: "#F8B8D4" },
};

export const fonts = {
  // Primary: Inter (clean, modern, premium).
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
