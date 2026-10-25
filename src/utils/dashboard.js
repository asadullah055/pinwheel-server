const DAY = 86_400_000;
const OFFSET = 6 * 60 * 60 * 1000;
const TIMEZONE = "Asia/Dhaka";
const EXCLUDED_STATUSES = [
  "Cancelled",
  "Returned",
  "Refunded",
  "Failed",
  "Awaiting Payment",
];

const dateKey = (date) =>
  new Date(date.getTime() + OFFSET).toISOString().slice(0, 10);

const getDashboardPeriod = (range = "7d", now = new Date()) => {
  if (!["today", "7d", "30d", "month"].includes(range)) {
    throw Object.assign(new Error("Choose today, 7d, 30d or month"), {
      status: 400,
    });
  }
  const local = new Date(now.getTime() + OFFSET);
  const midnight =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
    OFFSET;
  const start =
    range === "month"
      ? new Date(
          Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - OFFSET,
        )
      : new Date(
          midnight - (range === "30d" ? 29 : range === "7d" ? 6 : 0) * DAY,
        );
  const previousStart =
    range === "month"
      ? new Date(
          Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1) - OFFSET,
        )
      : new Date(
          start.getTime() -
            (range === "30d" ? 30 : range === "7d" ? 7 : 1) * DAY,
        );
  // Compare the same elapsed portion of the previous period; clip shorter months.
  const previousEnd = new Date(
    Math.min(
      start.getTime(),
      previousStart.getTime() + now.getTime() - start.getTime(),
    ),
  );
  return {
    range,
    start,
    end: now,
    previousStart,
    previousEnd,
    timezone: TIMEZONE,
  };
};

const fillDailySales = (rows, period) => {
  const byDay = new Map(rows.map((row) => [row._id, row]));
  const result = [];
  for (
    let cursor = period.start.getTime();
    cursor <= period.end.getTime();
    cursor += DAY
  ) {
    const date = dateKey(new Date(cursor));
    const row = byDay.get(date);
    result.push({ date, sales: row?.sales || 0, orders: row?.orders || 0 });
  }
  return result;
};

const emptyMetrics = () => ({
  orders: 0,
  sales: 0,
  recordedPayments: 0,
  outstanding: 0,
  salesOrders: 0,
});

module.exports = {
  DAY,
  TIMEZONE,
  EXCLUDED_STATUSES,
  getDashboardPeriod,
  fillDailySales,
  emptyMetrics,
};
