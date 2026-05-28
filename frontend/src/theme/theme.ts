// Centralized theme tokens for Prayers Loft.
export const colors = {
  bgTop: "#0a0e1a",
  bgBottom: "#1a1f3a",
  ivory: "#faf8f3",
  gold: "#c9a84c",
  goldHover: "#b8973b",
  textPrimary: "#faf8f3",
  textSecondary: "rgba(250,248,243,0.7)",
  textMuted: "rgba(250,248,243,0.45)",
  onCard: "#0a0e1a",
  onCardMuted: "rgba(10,14,26,0.7)",
  glassBg: "rgba(255,255,255,0.05)",
  glassBorder: "rgba(255,255,255,0.1)",
  navBg: "rgba(10,14,26,0.92)",
  navBorder: "rgba(255,255,255,0.06)",
};

export const emotionColors: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  Grateful: { bg: "rgba(201,168,76,0.18)", border: "rgba(201,168,76,0.4)", text: "#e6c878" },
  Hopeful:  { bg: "rgba(138,180,248,0.18)", border: "rgba(138,180,248,0.4)", text: "#a8c8ff" },
  Anxious:  { bg: "rgba(248,138,138,0.18)", border: "rgba(248,138,138,0.4)", text: "#f8a8a8" },
  Peaceful: { bg: "rgba(138,248,180,0.18)", border: "rgba(138,248,180,0.4)", text: "#a8e8c0" },
  Confused: { bg: "rgba(180,138,248,0.18)", border: "rgba(180,138,248,0.4)", text: "#d4b4f8" },
  Joyful:   { bg: "rgba(248,212,138,0.18)", border: "rgba(248,212,138,0.4)", text: "#f8d48a" },
  Tired:    { bg: "rgba(168,168,168,0.18)", border: "rgba(168,168,168,0.4)", text: "#d4d4d4" },
  Seeking:  { bg: "rgba(248,168,212,0.18)", border: "rgba(248,168,212,0.4)", text: "#f8a8d4" },
};

export const fonts = {
  serif: "CrimsonText_400Regular",
  serifItalic: "CrimsonText_400Regular_Italic",
  serifBold: "CrimsonText_700Bold",
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemibold: "Inter_600SemiBold",
  sansBold: "Inter_700Bold",
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
