import { useEffect, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useMeter } from "../hooks.js";
import type { MeterEvent } from "../types.js";
import { buildOverlayState } from "./state.js";

declare const __DEV__: boolean | undefined;

function getDevDefault(): boolean {
  return typeof __DEV__ !== "undefined" ? Boolean(__DEV__) : true;
}

export interface MeterOverlayProps {
  enabled?: boolean;
  recentLimit?: number;
  initialPosition?: { x: number; y: number };
}

export function MeterOverlay(props: MeterOverlayProps = {}) {
  const {
    enabled = getDevDefault(),
    recentLimit = 10,
    initialPosition = { x: 20, y: 80 },
  } = props;

  const meter = useMeter();
  const [events, setEvents] = useState<MeterEvent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  const pan = useRef(new Animated.ValueXY(initialPosition)).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.extractOffset();
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    }),
  ).current;

  useEffect(() => {
    if (!enabled) return;
    const refresh = async () => {
      const list = await meter.getEvents();
      setEvents(list);
    };
    void refresh();
    return meter.subscribe(() => {
      void refresh();
    });
  }, [enabled, meter]);

  if (!enabled) return null;

  const state = buildOverlayState(events, { limit: recentLimit });
  const selectedEvent = selectedRequestId
    ? state.recentEvents.find((e) => e.requestId === selectedRequestId)
    : null;

  return (
    <Animated.View
      style={[styles.container, pan.getLayout()]}
      {...panResponder.panHandlers}
      testID="meter-overlay"
    >
      <Pressable onPress={() => setExpanded((v) => !v)} testID="meter-overlay-header">
        <Text style={styles.headerText}>
          ${state.todaySpend.toFixed(4)} • {state.todayCount}
        </Text>
      </Pressable>

      {expanded ? (
        <ScrollView style={styles.body} testID="meter-overlay-body">
          <Text style={styles.section}>By model (today)</Text>
          {Object.keys(state.byModel).length === 0 ? (
            <Text style={styles.row}>no events yet</Text>
          ) : (
            Object.entries(state.byModel).map(([model, summary]) => (
              <Text key={model} style={styles.row}>
                {model}: ${summary.costUsd.toFixed(4)} ({summary.count})
              </Text>
            ))
          )}

          <Text style={styles.section}>Recent</Text>
          {state.recentEvents.length === 0 ? (
            <Text style={styles.row}>no events yet</Text>
          ) : (
            state.recentEvents.map((event) => (
              <Pressable
                key={event.requestId}
                onPress={() =>
                  setSelectedRequestId(
                    event.requestId === selectedRequestId ? null : event.requestId,
                  )
                }
                testID={`meter-overlay-row-${event.requestId}`}
              >
                <Text style={styles.row}>
                  {event.model} {event.inputTokens}→{event.outputTokens} ·{" "}
                  {event.latencyMs}ms
                </Text>
              </Pressable>
            ))
          )}

          {selectedEvent ? (
            <View style={styles.details} testID="meter-overlay-details">
              <Text style={styles.row}>request: {selectedEvent.requestId}</Text>
              <Text style={styles.row}>provider: {selectedEvent.provider}</Text>
              <Text style={styles.row}>cost: ${selectedEvent.costUsd.toFixed(6)}</Text>
              <Text style={styles.row}>
                tokens: {selectedEvent.inputTokens} in / {selectedEvent.outputTokens} out
              </Text>
              <Text style={styles.row}>latency: {selectedEvent.latencyMs}ms</Text>
              <Text style={styles.row}>
                at: {new Date(selectedEvent.timestamp).toISOString()}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: 8,
    padding: 8,
    minWidth: 140,
    maxWidth: 260,
  },
  headerText: {
    color: "#0f0",
    fontFamily: "monospace",
    fontSize: 12,
  },
  body: {
    maxHeight: 280,
    marginTop: 8,
  },
  section: {
    color: "#9aa",
    fontSize: 11,
    marginTop: 8,
    marginBottom: 4,
    fontFamily: "monospace",
  },
  row: {
    color: "#eee",
    fontSize: 10,
    fontFamily: "monospace",
    paddingVertical: 1,
  },
  details: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#333",
  },
});
