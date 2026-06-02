// Terms of Service screen. Lightweight, scrollable, copy-driven.
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme/theme";
import { TERMS_BODY, TERMS_LAST_UPDATED } from "@/src/content/terms";

export default function TermsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: "Terms of Service" }} />
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/settings"))}
          style={styles.back}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="terms-back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        testID="terms-scroll"
      >
        <Text style={styles.lastUpdated}>Last updated · {TERMS_LAST_UPDATED}</Text>
        {TERMS_BODY.map((section, idx) => (
          <View key={idx} style={styles.section}>
            <Text style={styles.h2}>{section.title}</Text>
            {section.paragraphs.map((p, i) => (
              <Text key={i} style={styles.p}>
                {p}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.serif, color: colors.text, fontSize: 18 },
  body: { paddingHorizontal: 24 },
  lastUpdated: {
    fontFamily: fonts.sans,
    color: colors.textTertiary,
    fontSize: 12,
    marginBottom: 18,
  },
  section: { marginBottom: 22 },
  h2: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 18,
    marginBottom: 8,
  },
  p: {
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 10,
  },
});
