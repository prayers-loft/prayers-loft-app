// Index entry — Prayer is the app's default landing tab. Every cold
// start (guest or signed-in) lands here. Walk remains available as a
// tab but does not replace Prayer as the default. Reverted from the
// Walk-first experiment on 2026-07-16 per product direction.
import { Redirect } from "expo-router";

export default function Index() {
  return <Redirect href="/(tabs)/prayer" />;
}
