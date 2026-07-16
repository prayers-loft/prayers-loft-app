// Index entry — Walk is the product's primary home (Build 17+).
// Every cold start (guest or signed-in) lands here.
import { Redirect } from "expo-router";

export default function Index() {
  return <Redirect href="/(tabs)/walk" />;
}
