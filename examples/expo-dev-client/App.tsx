import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  AsyncStorageAdapter,
  AsyncStorageBudgetState,
  Meter,
  MeterProvider,
  useBudget,
  useMetrics,
  type Provider,
} from "react-native-llm-meter";
import { MeterOverlay } from "react-native-llm-meter/overlay";

// Real provider wrapping (uncomment when you have keys):
//
// import Anthropic from "@anthropic-ai/sdk";
// const claude = meter.wrap(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
// const response = await claude.messages.create({
//   model: "claude-sonnet-4-6",
//   max_tokens: 1024,
//   messages: [{ role: "user", content: "Hi" }],
// });

const meter = new Meter({
  storage: new AsyncStorageAdapter({
    asyncStorage: AsyncStorage,
    retentionDays: 30,
  }),
});

meter.setBudget({
  daily: 1,
  state: new AsyncStorageBudgetState({ asyncStorage: AsyncStorage }),
  onCross: ({ period, threshold, spend }) => {
    Alert.alert(
      "Budget alert",
      `${period} spend $${spend.toFixed(4)} crossed $${threshold.toFixed(2)}`,
    );
  },
});

const SAMPLE_CALLS: Array<{
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> = [
  { provider: "anthropic", model: "claude-sonnet-4-6", inputTokens: 1200, outputTokens: 350, latencyMs: 820 },
  { provider: "anthropic", model: "claude-haiku-4-5", inputTokens: 500, outputTokens: 100, latencyMs: 240 },
  { provider: "openai", model: "gpt-4o", inputTokens: 800, outputTokens: 250, latencyMs: 1100 },
  { provider: "openai", model: "gpt-4o-mini", inputTokens: 400, outputTokens: 80, latencyMs: 320 },
  { provider: "google", model: "gemini-2.0-flash", inputTokens: 900, outputTokens: 200, latencyMs: 540 },
];

function Demo() {
  const { summary, byGroup } = useMetrics({ groupBy: "provider" });
  const budget = useBudget(1);
  const [seed, setSeed] = useState(0);

  const next = useMemo(() => SAMPLE_CALLS[seed % SAMPLE_CALLS.length], [seed]);

  const recordOne = () => {
    meter.record(next);
    setSeed((s) => s + 1);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>react-native-llm-meter</Text>
      <Text style={styles.subtitle}>Tap the button to simulate an API call.</Text>

      <Pressable style={styles.button} onPress={recordOne}>
        <Text style={styles.buttonText}>
          Record sample call ({next.provider} {next.model})
        </Text>
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Today</Text>
        <Text>Spend: ${budget.spend.toFixed(4)}</Text>
        <Text>Budget: ${budget.threshold.toFixed(2)}</Text>
        <Text>Remaining: ${budget.remaining.toFixed(4)}</Text>
        {budget.overBudget ? <Text style={styles.warn}>Over budget</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Summary</Text>
        <Text>Calls: {summary?.count ?? 0}</Text>
        <Text>Tokens in: {summary?.inputTokens ?? 0}</Text>
        <Text>Tokens out: {summary?.outputTokens ?? 0}</Text>
        <Text>p50 latency: {summary?.latencyP50 ?? 0}ms</Text>
        <Text>p95 latency: {summary?.latencyP95 ?? 0}ms</Text>
      </View>

      {byGroup ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>By provider</Text>
          {Object.entries(byGroup).map(([provider, s]) => (
            <Text key={provider}>
              {provider}: ${s.costUsd.toFixed(4)} ({s.count} calls)
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.hint}>
        The floating overlay (top left in dev) shows live spend and recent calls. Drag to
        reposition, tap to expand.
      </Text>
    </ScrollView>
  );
}

export default function App() {
  return (
    <MeterProvider meter={meter}>
      <Demo />
      <MeterOverlay />
      <StatusBar style="auto" />
    </MeterProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa" },
  content: { padding: 20, paddingTop: 60 },
  title: { fontSize: 22, fontWeight: "600", marginBottom: 4 },
  subtitle: { color: "#666", marginBottom: 16 },
  button: {
    backgroundColor: "#111",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  buttonText: { color: "#fff", fontWeight: "600" },
  card: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  cardTitle: { fontWeight: "600", marginBottom: 6 },
  warn: { color: "#c00", fontWeight: "600", marginTop: 4 },
  hint: { color: "#666", marginTop: 8, fontStyle: "italic" },
});
