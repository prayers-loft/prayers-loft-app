// Robust off-screen capture + share for branded PNG cards.
//
// Design notes (why this avoids the previous leak bug):
//   - We host the full-resolution card inside an Expo `<Modal>` overlay.
//     The Modal renders in its own root, so even when we position the card
//     at (-99999, -99999) it cannot push or leak into the underlying
//     scroll view (which was the failure mode of the previous attempt).
//   - We also show the user a *scaled-down preview* of the same card so
//     they get an Apple-grade pre-share preview. The capture is taken from
//     the off-screen full-res node, NOT the scaled preview.
//   - `react-native-view-shot` 4.x reliably captures off-screen nodes as
//     long as the parent is mounted and laid out (Modal satisfies this).
//
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { colors, fonts } from "@/src/theme/theme";
import {
  QA_FORMAT_SIZES,
  QAFormat,
  QAShareCard,
  QATemplate,
} from "./QAShareCard";

export type ShareImageModalProps = {
  visible: boolean;
  onClose: () => void;
  excerpt: string;
  fullText: string;
  reference: string;
  question?: string;
  style: "Devotional" | "Theologian";
  /** Optional preferred template; otherwise defaults by style. */
  template?: QATemplate;
  /** Optional preferred format; user can change in modal. */
  format?: QAFormat;
};

const FORMAT_LABELS: Record<QAFormat, string> = {
  portrait: "Post",
  square: "Square",
  story: "Story",
};

const TEMPLATE_LABELS_BY_STYLE: Record<
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

export function ShareImageModal({
  visible,
  onClose,
  excerpt,
  fullText,
  reference,
  question,
  style,
  template,
  format,
}: ShareImageModalProps) {
  const [activeFormat, setActiveFormat] = useState<QAFormat>(format ?? "portrait");
  const [activeTemplate, setActiveTemplate] = useState<QATemplate>(
    template ?? (style === "Theologian" ? "insight" : "centered")
  );
  const [busy, setBusy] = useState<null | "share" | "copy">(null);
  const captureRefView = useRef<View>(null);

  // Reset when reopened.
  useEffect(() => {
    if (visible) {
      setActiveFormat(format ?? "portrait");
      setActiveTemplate(template ?? (style === "Theologian" ? "insight" : "centered"));
      setBusy(null);
    }
  }, [visible, format, template, style]);

  const handleShareImage = async () => {
    if (busy) return;
    setBusy("share");
    try {
      // Tiny wait so any template/format change has painted.
      await new Promise((r) => setTimeout(r, 120));
      const uri = await captureRef(captureRefView, {
        format: "png",
        quality: 1,
        result: Platform.OS === "web" ? "data-uri" : "tmpfile",
      });
      if (Platform.OS === "web") {
        try {
          // eslint-disable-next-line no-undef
          const a = document.createElement("a");
          a.href = uri as string;
          a.download = "prayers-loft.png";
          a.click();
        } catch (e) {
          console.warn("web download failed", e);
        }
        onClose();
        return;
      }
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(uri as string, {
          mimeType: "image/png",
          dialogTitle: "Share from Prayers Loft",
          UTI: "public.png",
        });
      }
      onClose();
    } catch (e) {
      console.warn("share-image capture failed", e);
    } finally {
      setBusy(null);
    }
  };

  const handleCopyText = async () => {
    if (busy) return;
    setBusy("copy");
    try {
      const out = `${fullText}\n\n— ${reference}\nShared from Prayers Loft`;
      await Clipboard.setStringAsync(out);
      // Tiny confirmation pause then close.
      setTimeout(onClose, 350);
    } catch (e) {
      console.warn("copy failed", e);
    } finally {
      setBusy(null);
    }
  };

  const dims = QA_FORMAT_SIZES[activeFormat];
  // Scale to a portrait preview area roughly 240px wide.
  const PREVIEW_TARGET_W = 240;
  const previewScale = PREVIEW_TARGET_W / dims.width;

  const templates = TEMPLATE_LABELS_BY_STYLE[style];

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
          <Text style={styles.title}>Share moment</Text>
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
                <QAShareCard
                  excerpt={excerpt}
                  reference={reference}
                  question={question}
                  style={style}
                  template={activeTemplate}
                  format={activeFormat}
                />
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
            <Pressable
              onPress={handleCopyText}
              style={[styles.actionBtn, styles.actionBtnSecondary]}
              disabled={!!busy}
            >
              {busy === "copy" ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <>
                  <Ionicons name="copy-outline" size={18} color={colors.accent} />
                  <Text style={styles.actionTextSecondary}>Copy full text</Text>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={handleShareImage}
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              disabled={!!busy}
            >
              {busy === "share" ? (
                <ActivityIndicator color={colors.textOnAccent} />
              ) : (
                <>
                  <Ionicons name="share-outline" size={18} color={colors.textOnAccent} />
                  <Text style={styles.actionTextPrimary}>Share image</Text>
                </>
              )}
            </Pressable>
          </View>

          <Pressable onPress={onClose} hitSlop={12} style={styles.cancelRow}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>

      {/*
        Full-resolution off-screen capture node.
        Lives inside the Modal layer so it can't leak into the underlying
        ScrollView. `pointerEvents="none"` keeps it inert.
      */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: -99999,
          top: -99999,
          width: dims.width,
          height: dims.height,
          opacity: 0.99, // Keep non-zero so view-shot doesn't think it's hidden.
        }}
      >
        <View ref={captureRefView} collapsable={false} style={{ width: dims.width, height: dims.height }}>
          <QAShareCard
            excerpt={excerpt}
            reference={reference}
            question={question}
            style={style}
            template={activeTemplate}
            format={activeFormat}
          />
        </View>
      </View>
    </Modal>
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
  actions: { flexDirection: "row", gap: 10, marginTop: 8 },
  actionBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  actionBtnSecondary: {
    backgroundColor: colors.surface1,
  },
  actionBtnPrimary: {
    backgroundColor: colors.accent,
  },
  actionTextSecondary: {
    fontFamily: fonts.sansSemibold,
    color: colors.accent,
    fontSize: 14,
  },
  actionTextPrimary: {
    fontFamily: fonts.sansSemibold,
    color: colors.textOnAccent,
    fontSize: 14,
  },
  cancelRow: { alignSelf: "center", paddingVertical: 10 },
  cancelText: { fontFamily: fonts.sansMedium, color: colors.textTertiary, fontSize: 14 },
});
