// RootErrorBoundary
// -----------------
// Catches any uncaught JS error during render/lifecycle in the React tree.
// Without this, an uncaught error in startup logic bubbles to the native
// Expo error-recovery queue and can SIGABRT the entire process on TestFlight
// release builds (the exact crash signature we saw on iOS 26.5).
// With this in place, the user sees a calm "Something went wrong" screen and
// can tap "Try Again" to remount the app, instead of the process dying.

import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to native console for Console.app / Sentry-style integrations later.
    // eslint-disable-next-line no-console
    console.error("[RootErrorBoundary] Uncaught error", error, info?.componentStack);
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>
            The app hit an unexpected error. Tap below to try again.
          </Text>
          <ScrollView style={styles.errorBox} contentContainerStyle={{ paddingVertical: 6 }}>
            <Text style={styles.errorText}>
              {error.name}: {error.message}
            </Text>
          </ScrollView>
          <Pressable style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0e1a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#161E36",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(200,169,107,0.28)",
    padding: 22,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#F5EDD8",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: "rgba(245,237,216,0.78)",
    marginBottom: 14,
    lineHeight: 20,
  },
  errorBox: {
    maxHeight: 140,
    backgroundColor: "rgba(0,0,0,0.28)",
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  errorText: {
    color: "rgba(245,237,216,0.7)",
    fontSize: 12,
    fontFamily: "monospace",
  },
  button: {
    backgroundColor: "#C8A96B",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: {
    color: "#0c1024",
    fontSize: 15,
    fontWeight: "700",
  },
});
