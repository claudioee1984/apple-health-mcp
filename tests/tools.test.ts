import { describe, it, expect } from "vitest";
import { makeTestDb } from "./helpers/db";
import { normalize } from "@/lib/ingest";
import { persist } from "@/lib/persist";
import { listMetrics } from "@/lib/tools/list-metrics";
import { queryMetric } from "@/lib/tools/query-metric";
import { listWorkouts } from "@/lib/tools/list-workouts";
import { queryEvents } from "@/lib/tools/query-events";

async function seeded() {
  const db = await makeTestDb();
  await persist(db, normalize({
    data: {
      metrics: [{ name: "heart_rate", units: "count/min", data: [
        { date: "2026-06-01 08:00:00 +0000", Avg: 60 },
        { date: "2026-06-01 09:00:00 +0000", Avg: 80 },
      ] }],
      workouts: [{ id: "w1", name: "Running", start: "2026-06-01 08:00:00 +0000", end: "2026-06-01 08:30:00 +0000", duration: 1800 }],
      ecg: [{ date: "2026-06-01 08:00:00 +0000", classification: "Sinus Rhythm" }],
      stateOfMind: [], symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [],
    },
  }));
  return db;
}

describe("tools", () => {
  it("list_metrics returns names, units, counts, range", async () => {
    const rows = await listMetrics(await seeded());
    expect(rows).toEqual([
      expect.objectContaining({ metricName: "heart_rate", units: "count/min", sampleCount: 2 }),
    ]);
  });

  it("query_metric avg aggregation averages avg column", async () => {
    const r = await queryMetric(await seeded(), {
      name: "heart_rate", start: "2026-06-01", end: "2026-06-02", aggregation: "avg",
    });
    expect(r.aggregate).toBeCloseTo(70); // (60+80)/2
  });

  it("query_metric raw returns both points", async () => {
    const r = await queryMetric(await seeded(), {
      name: "heart_rate", start: "2026-06-01", end: "2026-06-02", aggregation: "raw",
    });
    expect(r.points).toHaveLength(2);
  });

  it("list_workouts returns the workout in range", async () => {
    const rows = await listWorkouts(await seeded(), { start: "2026-06-01", end: "2026-06-02" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "w1", name: "Running" });
  });

  it("query_events returns ecg events", async () => {
    const rows = await queryEvents(await seeded(), { eventType: "ecg", start: "2026-06-01", end: "2026-06-02" });
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ classification: "Sinus Rhythm" });
  });
});

it("query_metric raw preserves sleep stages, times and device provenance", async () => {
  const { metricSamples } = await import("@/db/schema");
  const db = await makeTestDb();
  const extra = { totalSleep: 7.1, rem: 1.75, core: 4.1, deep: 1.25, awake: 0.025, sleepStart: "2026-09-09 22:40:55 -0300", sleepEnd: "2026-09-10 05:48:28 -0300" };
  await db.insert(metricSamples).values([
    { metricName: "sleep_analysis", date: new Date("2026-09-10T03:00:00Z"), units: "hr", source: "Apple Watch", extra },
    { metricName: "sleep_analysis", date: new Date("2026-09-10T03:00:00Z"), units: "hr", source: "Oura", extra: { totalSleep: 6.75 } },
  ]);
  const r = await queryMetric(db, { name: "sleep_analysis", start: "2026-09-10T00:00:00-03:00", end: "2026-09-11T00:00:00-03:00", aggregation: "raw" });
  expect(r.points).toHaveLength(2);
  expect(r.points).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: "Apple Watch", units: "hr", qty: null, extra }),
    expect.objectContaining({ source: "Oura", extra: { totalSleep: 6.75 } }),
  ]));
});
