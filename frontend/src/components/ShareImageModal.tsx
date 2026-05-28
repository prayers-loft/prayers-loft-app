// Robust, polished share-card capture + share/save flow.
//
// Design notes:
//  - We host the full-resolution capture node inside an Expo `<Modal>` layer.
//    The Modal renders in its own root, so even when the capture node is
//    positioned at (-99999, -99999) it cannot push the underlying scroll view.
//  - We show the user a *scaled* preview of the same card so they get an
//    Apple-grade preview. Capture comes from the off-screen full-res node.
//  - Supports two card kinds: QA (Devotional / Theologian / Daily-verse) and
//    Prayer (first-person prayer card with dedicated templates).
//  - Three actions:
//      1. Share image (native share sheet)
//      2. Save to Photos (expo-media-library, contextual permission)
//      3. Copy full text (clipboard)
//
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { colors, fonts } from "@/src/theme/theme";
import {
  QA_FORMAT_SIZES,
  QAFormat,
  QAShareCard,
  QATemplate,
} from "./QAShareCard";
import {
  PRAYER_TEMPLATES,
  PrayerShareCard,
  PrayerTemplate,
} from "./PrayerShareCard";

export type ShareKind =
  | {
      kind: "qa";
      excerpt: string;
      fullText: string;
      reference: string;
      question?: string;
      style: "Devotional" | "Theologian";
      defaultTemplate?: QATemplate;
    }
  | {
      kind: "prayer";
      prayer: string;
      fullText: string;
      verseReference?: string;
      defaultTemplate?: PrayerTemplate;
    };

export type ShareImageModalProps = {
  visible: boolean;
  onClose: () => void;
  payload: ShareKind | null;
  format?: QAFormat;
};

const FORMAT_LABELS: Record<QAFormat, string> = {
  portrait: "Post",
  square: "Square",
  story: "Story",
};

const QA_TEMPLATE_LABELS_BY_STYLE: Record<
  "Devotional" | "Theologian",
  { value: QATemplate; label: string }[]
> = {
  Devotional: [
    { value: "centered", label: "Editorial" },
    { value: "reflection", label: "Reflection" },
    { value: "insight", label: "Quote" },
  ],
  Theologian: [
    { value: "insight", label: "Insight" },
    { value: "centered", label: "Editorial" },
    { value: "reflection", label: "Reflection" },
  ],
};

const PRAYER_TEMPLATE_LABELS: { value: PrayerTemplate; label: string }[] = [
  { value: "journal", label: "Journal" },
  { value: "centered", label: "Centered" },
  { value: "editorial", label: "Editorial" },
  { value: "candlelight", label: "Candlelight" },
];

export function ShareImageModal({
  visible,
  onClose,
  payload,
  format,
}: ShareImageModalProps) {
  const initialFormat: QAFormat = format ?? "portrait";

  const initialTemplate = useMemo<QATemplate | PrayerTemplate | null>(() => {
    if (!payload) return null;
    if (payload.kind === "qa") {
      return payload.defaultTemplate ?? (payload.style === "Theologian" ? "insight" : "centered");
    }
    return payload.defaultTemplate ?? PRAYER_TEMPLATES[0];
  }, [payload]);

  const [activeFormat, setActiveFormat] = useState<QAFormat>(initialFormat);
  const [activeTemplate, setActiveTemplate] = useState<QATemplate | PrayerTemplate>(
    (initialTemplate as QATemplate | PrayerTemplate) ?? "centered"
  );
  const [busy, setBusy] = useState<null | "share" | "save" | "copy">(null);
  const [toast, setToast] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const captureRefView = useRef<View>(null);

  // Reset whenever the modal opens with a fresh payload.
  useEffect(() => {
    if (visible && payload) {
      setActiveFormat(format ?? "portrait");
      if (payload.kind === "qa") {
        setActiveTemplate(
          payload.defaultTemplate ?? (payload.style === "Theologian" ? "insight" : "centered")
        );
      } else {
        setActiveTemplate(payload.defaultTemplate ?? PRAYER_TEMPLATES[0]);
      }
      setBusy(null);
      setToast(null);
    }
  }, [visible, payload, format]);

  // Toast animation
  const toastOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!toast) return;
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.delay(1600),
      Animated.timing(toastOpacity, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setToast(null);
    });
  }, [toast, toastOpacity]);

  const dims = QA_FORMAT_SIZES[activeFormat];
  const PREVIEW_TARGET_W = 240;
  const previewScale = PREVIEW_TARGET_W / dims.width;

  const templates: { value: QATemplate | PrayerTemplate; label: string }[] = useMemo(() => {
    if (!payload) return [];
    if (payload.kind === "qa") return QA_TEMPLATE_LABELS_BY_STYLE[payload.style];
    return PRAYER_TEMPLATE_LABELS;
  }, [payload]);

  const renderCard = (refForCapture?: React.RefObject<View | null>) => {
    if (!payload) return null;
    if (payload.kind === "qa") {
      return (
        <QAShareCard
          ref={refForCapture as unknown as React.Ref<View>}
          excerpt={payload.excerpt}
          reference={payload.reference}
          question={payload.question}
          style={payload.style}
          template={activeTemplate as QATemplate}
          format={activeFormat}
        />
      );
    }
    return (
      <PrayerShareCard
        ref={refForCapture as unknown as React.Ref<View>}
        prayer={payload.prayer}
        verseReference={payload.verseReference}
        template={activeTemplate as PrayerTemplate}
        format={activeFormat}
      />
    );
  };

  // ----- Actions ----------------------------------------------------------
  const captureToFile = async (): Promise<string | null> => {
    // Tiny wait so any template/format change paints.
    await new Promise((r) => setTimeout(r, 120));
    const uri = await captureRef(captureRefView, {
      format: "png",
      quality: 1,
      result: Platform.OS === "web" ? "data-uri" : "tmpfile",
    });
    return uri as string;
  };

  const handleShareImage = async () => {
    if (busy || !payload) return;
    setBusy("share");
    try {
      const uri = await captureToFile();
      if (!uri) throw new Error("capture failed");
      if (Platform.OS === "web") {
        try {
          // eslint-disable-next-line no-undef
          const a = document.createElement("a");
          a.href = uri;
          a.download = "prayers-loft.png";
          a.click();
          setToast({ text: "Downloaded", tone: "success" });
        } catch (e) {
          console.warn("web download failed", e);
          setToast({ text: "Unable to share", tone: "error" });
        }
        return;
      }
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          dialogTitle: "Share from Prayers Loft",
          UTI: "public.png",
        });
        // Close after share sheet returns.
        setTimeout(onClose, 200);
      } else {
        setToast({ text: "Sharing not available", tone: "error" });
      }
    } catch (e) {
      console.warn("share image failed", e);
      setToast({ text: "Unable to share image", tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const handleSaveToPhotos = async () => {
    if (busy || !payload) return;
    setBusy("save");
    try {
      if (Platform.OS === "web") {
        // On web, "Save to Photos" ≡ download.
        await handleShareImage();
        return;
      }
      // 1. Check existing permission.
      let perm = await MediaLibrary.getPermissionsAsync();
      // 2. If undetermined, ask now (contextual, after the user tapped Save).
      if (perm.status !== "granted" && perm.canAskAgain) {
        perm = await MediaLibrary.requestPermissionsAsync();
      }
      // 3. If denied and can't ask again, show settings fallback.
      if (perm.status !== "granted") {
        Alert.alert(
          "Allow photo access",
          "Prayers Loft needs photo access to save your share card. You can enable it in Settings.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
              onPress: () => Linking.openSettings().catch(() => {}),
            },
          ]
        );
        return;
      }
      // 4. Capture + persist.
      const uri = await captureToFile();
      if (!uri) throw new Error("capture failed");
      await MediaLibrary.saveToLibraryAsync(uri);
      setToast({ text: "Saved to Photos", tone: "success" });
    } catch (e) {
      console.warn("save to photos failed", e);
      setToast({ text: "Unable to save image", tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const handleCopyText = async () => {
    if (busy || !payload) return;
    setBusy("copy");
    try {
      let out: string;
      if (payload.kind === "qa") {
        out = `${payload.fullText}\n\n— ${payload.reference}\nShared from Prayers Loft`;
      } else {
        const ref = payload.verseReference ? `\n${payload.verseReference}\n` : "\n";
        out = `A Prayer\n\n${payload.fullText}${ref}\nShared from Prayers Loft`;
      }
      await Clipboard.setStringAsync(out);
      setToast({ text: "Copied", tone: "success" });
    } catch (e) {
      console.warn("copy failed", e);
      setToast({ text: "Unable to copy", tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet} pointerEvents="box-none">
        <View style={styles.sheetInner}>
          <View style={styles.handle} />
          <Text style={styles.title}>
            {payload?.kind === "prayer" ? "Share your prayer" : "Share moment"}
          </Text>
          <Text style={styles.subtitle}>Preview before sharing</Text>

          {/* Scaled preview */}
          <View style={styles.previewWrap}>
            <View
              style={[
                styles.previewBox,
                {
                  width: dims.width * previewScale,
                  height: dims.height * previewScale,
                },
              ]}
            >
              <View
                style={{
                  width: dims.width,
                  height: dims.height,
                  transform: [
                    { translateX: -(dims.width / 2) },
                    { translateY: -(dims.height / 2) },
                    { scale: previewScale },
                    { translateX: dims.width / 2 },
                    { translateY: dims.height / 2 },
                  ],
                }}
              >
                {renderCard()}
              </View>
            </View>
          </View>

          {/* Format selector */}
          <Text style={styles.sectionLabel}>Aspect</Text>
          <View style={styles.segment}>
            {(Object.keys(FORMAT_LABELS) as QAFormat[]).map((f) => (
              <Pressable
                key={f}
                onPress={() => setActiveFormat(f)}
                style={[styles.pill, activeFormat === f && styles.pillActive]}
              >
                <Text style={[styles.pillText, activeFormat === f && styles.pillTextActive]}>
                  {FORMAT_LABELS[f]}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Template selector */}
          <Text style={styles.sectionLabel}>Style</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.templateRow}
          >
            {templates.map((t) => (
              <Pressable
                key={t.value}
                onPress={() => setActiveTemplate(t.value)}
                style={[styles.tplPill, activeTemplate === t.value && styles.tplPillActive]}
              >
                <Text
                  style={[
                    styles.tplText,
                    activeTemplate === t.value && styles.tplTextActive,
                  ]}
                >
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            <ActionButton
              icon="copy-outline"
              label="Copy"
              onPress={handleCopyText}
              loading={busy === "copy"}
              disabled={!!busy}
              variant="ghost"
            />
            <ActionButton
              icon="download-outline"
              label={Platform.OS === "web" ? "Save" : "Save to Photos"}
              onPress={handleSaveToPhotos}
              loading={busy === "save"}
              disabled={!!busy}
              variant="secondary"
            />
            <ActionButton
              icon="share-outline"
              label="Share"
              onPress={handleShareImage}
              loading={busy === "share"}
              disabled={!!busy}
              variant="primary"
            />
          </View>

          <Pressable onPress={onClose} hitSlop={12} style={styles.cancelRow}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>

      {toast && (
        <Animated.View pointerEvents="none" style={[styles.toast, { opacity: toastOpacity }]}>
          <Ionicons
            name={toast.tone === "success" ? "checkmark-circle" : "alert-circle"}
            size={16}
            color={toast.tone === "success" ? "#A8D7B8" : "#E8B8B8"}
          />
          <Text style={styles.toastText}>{toast.text}</Text>
        </Animated.View>
      )}

      {/*
        Full-resolution off-screen capture node.
        Lives inside the Modal layer so it cannot leak into the underlying
        ScrollView. `pointerEvents="none"` keeps it inert.
      */}
      <View
        style={{
          position: "absolute",
          left: -99999,
          top: -99999,
          width: dims.width,
          height: dims.height,
          opacity: 0.99,
          pointerEvents: "none",
        }}
      >
        <View
          ref={captureRefView}
          collapsable={false}
          style={{ width: dims.width, height: dims.height }}
        >
          {renderCard()}
        </View>
      </View>
    </Modal>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  loading,
  disabled,
  variant,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant: "primary" | "secondary" | "ghost";
}) {
  const isPrimary = variant === "primary";
  const isGhost = variant === "ghost";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.actionBtn,
        isPrimary && styles.actionBtnPrimary,
        !isPrimary && !isGhost && styles.actionBtnSecondary,
        isGhost && styles.actionBtnGhost,
        disabled && { opacity: 0.55 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.textOnAccent : colors.accent} size="small" />
      ) : (
        <>
          <Ionicons name={icon} size={16} color={isPrimary ? colors.textOnAccent : colors.accent} />
          <Text
            style={[
              styles.actionText,
              isPrimary ? { color: colors.textOnAccent } : { color: colors.accent },
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7,12,28,0.7)",
  },
  sheet: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetInner: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 14,
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(248,250,252,0.18)",
    alignSelf: "center",
    marginBottom: 4,
  },
  title: {
    fontFamily: fonts.sansSemibold,
    color: colors.text,
    fontSize: 22,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: -8,
  },
  previewWrap: {
    alignItems: "center",
    paddingVertical: 10,
  },
  previewBox: {
    overflow: "hidden",
    borderRadius: 18,
    backgroundColor: "#0A1020",
  },
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginTop: 4,
  },
  segment: {
    flexDirection: "row",
    padding: 4,
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 14,
    gap: 4,
  },
  pill: { flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: "center" },
  pillActive: { backgroundColor: colors.accent },
  pillText: { fontFamily: fonts.sansMedium, color: colors.textSecondary, fontSize: 13 },
  pillTextActive: { color: colors.textOnAccent, fontFamily: fonts.sansSemibold },
  templateRow: { gap: 8, paddingRight: 8 },
  tplPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tplPillActive: {
    backgroundColor: colors.surface2,
    borderColor: colors.accent,
  },
  tplText: { fontFamily: fonts.sansMedium, color: colors.textSecondary, fontSize: 13 },
  tplTextActive: { color: colors.accent, fontFamily: fonts.sansSemibold },
  actions: { flexDirection: "row", gap: 8, marginTop: 8 },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 50,
  },
  actionBtnPrimary: {
    backgroundColor: colors.accent,
    flex: 1.3,
  },
  actionBtnSecondary: {
    backgroundColor: colors.surface2,
  },
  actionBtnGhost: {
    backgroundColor: colors.surface1,
  },
  actionText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
  },
  cancelRow: { alignSelf: "center", paddingVertical: 8 },
  cancelText: { fontFamily: fonts.sansMedium, color: colors.textTertiary, fontSize: 14 },
  toast: {
    position: "absolute",
    bottom: 110,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "rgba(15,23,42,0.95)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  toastText: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 13,
  },
});

// Re-export keeping FileSystem import alive in case future versions need it.
export { FileSystem };
