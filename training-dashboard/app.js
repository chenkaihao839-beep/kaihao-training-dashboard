let trainingData = window.TRAINING_DATA || null;

async function loadTrainingData() {
  if (location.protocol === "file:") return;

  try {
    const response = await fetch("./data/training-data.json", { cache: "no-store" });
    if (response.ok) {
      trainingData = await response.json();
    }
  } catch {
    // The local file version uses data/training-data.js as a no-server fallback.
  }
}

const colors = {
  bench: "#087f73",
  squat: "#d65d40",
  pulldown: "#2f6fbe",
  shoulderPress: "#c28b22",
  bodyweight: "#087f73",
  grid: "#dfe4dc",
  text: "#68706a"
};

let selectedExercise = "bench";
let currentCycleFilter = "all";
const chartStore = {};
const CYCLE_DAYS = [
  { key: "chest", label: "胸日" },
  { key: "back", label: "背日" },
  { key: "shoulderLeg", label: "肩腿日" }
];

function defaultMetricForExercise(key) {
  return key === "pullup" ? "reps" : "load";
}

function estimateOneRm(load, reps, key) {
  if (key === "pullup") return reps;
  return Math.round((load * (1 + reps / 30)) * 10) / 10;
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

function latestSession() {
  return trainingData.sessions[trainingData.sessions.length - 1];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function classifyCycleDay(day) {
  if (day.includes("胸")) return "chest";
  if (day.includes("背")) return "back";
  if (day.includes("肩") || day.includes("腿")) return "shoulderLeg";
  return "other";
}

function latestCycleName() {
  const namedCycles = trainingData.sessions
    .map((session) => session.cycle)
    .filter((cycle) => /^Cycle\s+\d+$/i.test(cycle));
  if (namedCycles.length) return namedCycles.at(-1);
  return latestSession().cycle;
}

function getCycleSessions(cycle) {
  return trainingData.sessions.filter((session) => session.cycle === cycle);
}

function getCycleReviewKey(cycle) {
  return `kaihao-cycle-review-${cycle}`;
}

function getStoredCycleReview(cycle) {
  try {
    return JSON.parse(localStorage.getItem(getCycleReviewKey(cycle)) || "{}");
  } catch {
    return {};
  }
}

function storeCycleReview(cycle, review) {
  localStorage.setItem(getCycleReviewKey(cycle), JSON.stringify(review));
}

function cycleProgress(cycle) {
  const sessions = getCycleSessions(cycle);
  const completedKeys = new Set(sessions.map((session) => classifyCycleDay(session.day)));
  const completedDays = CYCLE_DAYS.filter((day) => completedKeys.has(day.key));
  const missingDays = CYCLE_DAYS.filter((day) => !completedKeys.has(day.key));
  return {
    cycle,
    sessions,
    completedDays,
    missingDays,
    isComplete: missingDays.length === 0
  };
}

function cycleSummary(progress) {
  const weights = progress.sessions
    .map((session) => session.bodyweight)
    .filter((weight) => Number.isFinite(weight));
  const durations = progress.sessions
    .map((session) => session.duration)
    .filter((duration) => Number.isFinite(duration));
  const firstWeight = weights.at(0);
  const latestWeight = weights.at(-1);
  const weightChange = Number.isFinite(firstWeight) && Number.isFinite(latestWeight)
    ? Math.round((latestWeight - firstWeight) * 100) / 100
    : null;
  const avgDuration = durations.length
    ? Math.round(durations.reduce((total, value) => total + value, 0) / durations.length)
    : null;

  return {
    weightChange,
    avgDuration,
    latestSummaries: progress.sessions.slice(-3).map((session) => session.summary)
  };
}

function latestCycleRecord(key, cycle) {
  return getRecords(key).filter((record) => record.cycle === cycle).at(-1);
}

function generateCycleAdvice(progress, review) {
  const recovery = Number(review.recovery || 3);
  const effort = Number(review.effort || 3);
  const pain = Number(review.pain || 1);
  const summary = cycleSummary(progress);
  const advice = [];
  const bench = latestCycleRecord("bench", progress.cycle);
  const pullup = latestCycleRecord("pullup", progress.cycle);
  const squat = latestCycleRecord("squat", progress.cycle);

  if (!progress.isComplete) {
    advice.push(`当前 ${progress.cycle} 还差 ${progress.missingDays.map((day) => day.label).join("、")}，先把这个 Cycle 练完整，再最终确定下轮加重量。`);
  }

  if (pain >= 4 || recovery <= 2) {
    advice.push("下一个 Cycle 先保守：主项保持当前重量，少做力竭组，把动作速度和恢复感拉回来。");
  } else if (effort <= 3 && recovery >= 4 && progress.isComplete) {
    advice.push("下一个 Cycle 可以小幅推进：稳定完成的主项加 2.5kg，或者在同重量下先补 1-2 次。");
  } else {
    advice.push("下一个 Cycle 维持渐进：主项先按本轮重量开局，只有当天热身和第一组都顺，再加一点。");
  }

  if (bench) {
    advice.push(`卧推参考：本轮最新是 ${bench.load}×${bench.reps}。如果第二组仍有明显粘滞，继续稳 60kg；如果很干净，再安排 62.5kg 上探。`);
  }
  if (pullup) {
    advice.push(`引体参考：本轮最新是 ${pullup.reps} 次。下一轮优先把总次数补回来，不急着给下拉加重量。`);
  }
  if (squat) {
    advice.push(`深蹲参考：本轮最新是 ${squat.load}×${squat.reps}。腰背感觉正常再推进，否则保持并提高动作质量。`);
  }
  if (summary.weightChange !== null) {
    advice.push(`体重参考：本轮记录变化 ${summary.weightChange >= 0 ? "+" : ""}${summary.weightChange}kg。训练表现上升时，这个方向是可以接受的。`);
  }

  return advice;
}

function renderMetrics() {
  const latest = latestSession();
  const benchLatest = getRecords("bench").at(-1);
  const squatBest = bestRecord("squat");
  const pullupLatest = getRecords("pullup").at(-1);
  const metrics = [
    { id: "bodyweight", label: "最新体重", value: `${latest.bodyweight}kg`, note: "5.25 记录" },
    { id: "bench", label: "卧推状态", value: `${benchLatest.load}×${benchLatest.reps}`, note: "回归后已恢复到工作组" },
    { id: "squat", label: "深蹲峰值", value: `${squatBest.load}×${squatBest.reps}`, note: "Cycle 8 达成" },
    { id: "pullup", label: "引体回归", value: `${pullupLatest.reps}/6/6`, note: "下一目标回到 8/8/8" }
  ];

  document.getElementById("metricGrid").innerHTML = metrics.map((metric) => `
    <button class="stat-card" type="button" data-metric-detail="${metric.id}">
      <p class="label">${metric.label}</p>
      <div>
        <strong>${metric.value}</strong>
        <span>${metric.note}</span>
      </div>
    </button>
  `).join("");
}

function getRecords(key) {
  return trainingData.exercises[key].records.map(([date, cycle, load, reps, note]) => ({
    date,
    cycle,
    load,
    reps,
    note,
    estimated: estimateOneRm(load, reps, key)
  }));
}

function bestRecord(key) {
  return getRecords(key).reduce((best, item) => item.estimated > best.estimated ? item : best, getRecords(key)[0]);
}

function metricValue(record, metric) {
  if (metric === "load") return record.load;
  if (metric === "reps") return record.reps;
  return record.estimated;
}

function metricLabel(record, metric, key = selectedExercise) {
  if (metric === "reps" || key === "pullup") return `${record.reps} 次`;
  if (metric === "load") return `${record.load}kg`;
  return String(record.estimated);
}

function filteredSessions() {
  if (currentCycleFilter === "return") return trainingData.sessions.filter((item) => item.cycle === "回归");
  if (currentCycleFilter === "latest") return trainingData.sessions.filter((item) => item.cycle === "Cycle 10" || item.cycle === "回归");
  return trainingData.sessions;
}

function toTimestamp(date) {
  return new Date(`${date}T00:00:00`).getTime();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function niceNumber(value) {
  if (Math.abs(value) >= 100) return Math.round(value);
  if (Math.abs(value) >= 10) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

function normalizeChartSeries(series) {
  return series.map((line) => ({
    ...line,
    points: line.points
      .filter((point) => point.y !== null && Number.isFinite(point.y))
      .map((point) => ({ ...point, x: toTimestamp(point.date) }))
      .sort((a, b) => a.x - b.x)
  }));
}

function chooseDateTicks(dates, scale, ctx, plot) {
  if (dates.length <= 1) {
    return dates.map((date) => ({ date, label: formatDate(date), x: scale.toX(toTimestamp(date)) }));
  }

  const maxLabels = clamp(Math.floor(plot.width / 64) + 1, 2, 6);
  const step = Math.max(1, Math.ceil((dates.length - 1) / Math.max(1, maxLabels - 1)));
  const candidateIndexes = [];

  for (let index = 0; index < dates.length; index += step) {
    candidateIndexes.push(index);
  }
  if (candidateIndexes.at(-1) !== dates.length - 1) {
    candidateIndexes.push(dates.length - 1);
  }

  const candidates = [...new Set(candidateIndexes)].map((index) => {
    const date = dates[index];
    const label = formatDate(date);
    return {
      date,
      label,
      x: scale.toX(toTimestamp(date)),
      width: ctx.measureText(label).width
    };
  });

  const selected = [];
  const hasRoomAfter = (left, right) => right.x - left.x >= (left.width + right.width) / 2 + 12;

  candidates.forEach((tick) => {
    const previous = selected.at(-1);
    if (!previous || hasRoomAfter(previous, tick)) {
      selected.push(tick);
      return;
    }

    if (tick.date === dates.at(-1)) {
      const beforePrevious = selected.at(-2);
      if (!beforePrevious || hasRoomAfter(beforePrevious, tick)) {
        selected[selected.length - 1] = tick;
      }
    }
  });

  return selected;
}

function getChartExtents(series) {
  const allPoints = series.flatMap((line) => line.points);
  const xValues = allPoints.map((point) => point.x);
  const yValues = allPoints.map((point) => point.y);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMinRaw = Math.min(...yValues);
  const yMaxRaw = Math.max(...yValues);
  const ySpread = Math.max(1, yMaxRaw - yMinRaw);

  return {
    xMin,
    xMax,
    yMin: Math.floor((yMinRaw - ySpread * 0.12) * 10) / 10,
    yMax: Math.ceil((yMaxRaw + ySpread * 0.12) * 10) / 10
  };
}

function applyYDomain(extents, options) {
  if (options.yDomain) {
    return { ...extents, yMin: options.yDomain[0], yMax: options.yDomain[1] };
  }

  const span = Math.max(1, extents.yMax - extents.yMin);
  const paddedMin = extents.yMin - span * 0.08;
  const paddedMax = extents.yMax + span * 0.08;
  const step = options.yStep || 2.5;

  return {
    ...extents,
    yMin: Math.floor(paddedMin / step) * step,
    yMax: Math.ceil(paddedMax / step) * step
  };
}

function latestXView(extents, options) {
  const fullSpan = Math.max(1, extents.xMax - extents.xMin);
  const requestedSpan = (options.xWindowDays || 28) * 24 * 60 * 60 * 1000;
  const xSpan = Math.min(fullSpan, requestedSpan);

  return {
    xMin: extents.xMax - xSpan,
    xMax: extents.xMax
  };
}

function getChartState(canvasId, series, extents, options) {
  const signature = JSON.stringify(series.map((line) => [
    line.label,
    line.points.map((point) => [point.date, point.y])
  ])) + JSON.stringify([options.yDomain || null, options.xWindowDays || 28]);
  const existing = chartStore[canvasId];
  const xView = latestXView(extents, options);

  if (!existing || existing.signature !== signature) {
    chartStore[canvasId] = {
      signature,
      view: { ...extents, ...xView },
      extents,
      xWindowSpan: xView.xMax - xView.xMin,
      hover: null,
      drag: null,
      drawnPoints: [],
      render: null
    };
  } else {
    existing.extents = extents;
    existing.xWindowSpan = xView.xMax - xView.xMin;
    if (existing.view.xMin < extents.xMin) {
      existing.view.xMin = extents.xMin;
      existing.view.xMax = extents.xMin + existing.xWindowSpan;
    }
    if (existing.view.xMax > extents.xMax) {
      existing.view.xMax = extents.xMax;
      existing.view.xMin = extents.xMax - existing.xWindowSpan;
    }
  }

  return chartStore[canvasId];
}

function panChart(state, delta) {
  const span = state.view.xMax - state.view.xMin;
  let nextXMin = state.view.xMin + delta;
  let nextXMax = state.view.xMax + delta;

  if (span >= state.extents.xMax - state.extents.xMin) {
    state.view.xMin = state.extents.xMin;
    state.view.xMax = state.extents.xMax;
    return;
  }

  if (nextXMin < state.extents.xMin) {
    nextXMin = state.extents.xMin;
    nextXMax = state.extents.xMin + span;
  }
  if (nextXMax > state.extents.xMax) {
    nextXMax = state.extents.xMax;
    nextXMin = state.extents.xMax - span;
  }

  state.view.xMin = nextXMin;
  state.view.xMax = nextXMax;
}

function bindCanvasInteractions(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas.dataset.interactive === "true") return;
  canvas.dataset.interactive = "true";
  canvas.title = "左右拖动查看历史，双击回到最新";

  canvas.addEventListener("wheel", (event) => {
    const state = chartStore[canvasId];
    if (!state || !state.plot) return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) && !event.shiftKey) return;
    event.preventDefault();
    const direction = event.shiftKey ? event.deltaY : event.deltaX;
    const span = state.view.xMax - state.view.xMin;
    panChart(state, direction > 0 ? span * 0.18 : -span * 0.18);
    state.hover = null;
    state.render?.();
  }, { passive: false });

  canvas.addEventListener("pointerdown", (event) => {
    const state = chartStore[canvasId];
    if (!state || !state.plot) return;
    canvas.setPointerCapture(event.pointerId);
    state.drag = {
      x: event.clientX,
      xMin: state.view.xMin,
      xMax: state.view.xMax
    };
  });

  canvas.addEventListener("pointermove", (event) => {
    const state = chartStore[canvasId];
    if (!state || !state.plot) return;

    if (state.drag) {
      const { plot } = state;
      const dx = event.clientX - state.drag.x;
      const xSpan = state.drag.xMax - state.drag.xMin;
      let nextXMin = state.drag.xMin - (dx / Math.max(1, plot.width)) * xSpan;
      let nextXMax = state.drag.xMax - (dx / Math.max(1, plot.width)) * xSpan;

      if (xSpan <= state.extents.xMax - state.extents.xMin) {
        if (nextXMin < state.extents.xMin) {
          nextXMin = state.extents.xMin;
          nextXMax = state.extents.xMin + xSpan;
        }
        if (nextXMax > state.extents.xMax) {
          nextXMax = state.extents.xMax;
          nextXMin = state.extents.xMax - xSpan;
        }
      }

      state.view = { ...state.view, xMin: nextXMin, xMax: nextXMax };
      state.render?.();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const visiblePoints = state.drawnPoints.filter((point) => point.visible);
    if (!visiblePoints.length) return;

    const nearest = visiblePoints.reduce((best, point) => {
      const distance = Math.hypot(point.px - mouse.x, point.py - mouse.y);
      return distance < best.distance ? { point, distance } : best;
    }, { point: null, distance: Infinity });

    state.hover = nearest.distance < 42 ? nearest.point : null;
    state.render?.();
  });

  canvas.addEventListener("pointerup", (event) => {
    const state = chartStore[canvasId];
    if (!state) return;
    state.drag = null;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  });

  canvas.addEventListener("pointerleave", () => {
    const state = chartStore[canvasId];
    if (!state) return;
    state.hover = null;
    state.drag = null;
    state.render?.();
  });

  canvas.addEventListener("dblclick", () => {
    const state = chartStore[canvasId];
    if (!state) return;
    state.view = { ...state.extents };
    state.hover = null;
    state.render?.();
  });
}

function applyChartAction(canvasId, action) {
  const state = chartStore[canvasId];
  if (!state) return;

  if (action === "latest") {
    state.view.xMax = state.extents.xMax;
    state.view.xMin = state.extents.xMax - state.xWindowSpan;
    state.hover = null;
    state.render?.();
    return;
  }

  if (action === "panLeft" || action === "panRight") {
    const span = state.view.xMax - state.view.xMin;
    panChart(state, action === "panLeft" ? -span * 0.45 : span * 0.45);
    state.hover = null;
  }

  state.render?.();
}

function drawLineChart(canvasId, series, options = {}) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");
  const normalizedSeries = normalizeChartSeries(series);
  const allPoints = normalizedSeries.flatMap((line) => line.points);
  if (!allPoints.length) return;

  const extents = applyYDomain(getChartExtents(normalizedSeries), options);
  const state = getChartState(canvasId, normalizedSeries, extents, options);
  state.render = () => drawLineChart(canvasId, series, options);
  state.view.yMin = extents.yMin;
  state.view.yMax = extents.yMax;
  state.view.xMax = state.view.xMin + state.xWindowSpan;
  bindCanvasInteractions(canvasId);

  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, rect.width) * ratio;
  canvas.height = (options.height || Number(canvas.getAttribute("height")) || 240) * ratio;
  ctx.scale(ratio, ratio);

  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const pad = { top: 18, right: 18, bottom: 34, left: 42 };
  const plot = {
    left: pad.left,
    top: pad.top,
    right: width - pad.right,
    bottom: height - pad.bottom,
    width: width - pad.left - pad.right,
    height: height - pad.top - pad.bottom
  };
  const view = state.view;
  const scale = {
    toX: (value) => plot.left + ((value - view.xMin) / Math.max(1, view.xMax - view.xMin)) * plot.width,
    toY: (value) => plot.top + ((view.yMax - value) / Math.max(0.0001, view.yMax - view.yMin)) * plot.height,
    toDataX: (value) => view.xMin + ((value - plot.left) / Math.max(1, plot.width)) * (view.xMax - view.xMin)
  };
  state.plot = plot;
  state.scale = scale;
  state.drawnPoints = [];
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillStyle = colors.text;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i < 4; i += 1) {
    const gy = plot.top + (i / 3) * plot.height;
    ctx.beginPath();
    ctx.moveTo(plot.left, gy);
    ctx.lineTo(plot.right, gy);
    ctx.stroke();
    const label = view.yMax - (i / 3) * (view.yMax - view.yMin);
    ctx.fillText(niceNumber(label), plot.left - 8, gy);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.left, plot.top, plot.width, plot.height);
  ctx.clip();

  normalizedSeries.forEach((line) => {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let started = false;
    line.points.forEach((point) => {
      const px = scale.toX(point.x);
      const py = scale.toY(point.y);
      const visible = px >= plot.left - 12 && px <= plot.right + 12 && py >= plot.top - 12 && py <= plot.bottom + 12;
      state.drawnPoints.push({ ...point, px, py, visible, lineLabel: line.label, color: line.color });
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      }
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    line.points.forEach((point) => {
      const px = scale.toX(point.x);
      const py = scale.toY(point.y);
      if (px < plot.left - 12 || px > plot.right + 12 || py < plot.top - 12 || py > plot.bottom + 12) return;
      ctx.fillStyle = state.hover?.date === point.date && state.hover?.lineLabel === line.label ? line.color : "#fff";
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  });

  if (state.hover) {
    ctx.strokeStyle = "rgba(34, 37, 34, 0.36)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(state.hover.px, plot.top);
    ctx.lineTo(state.hover.px, plot.bottom);
    ctx.moveTo(plot.left, state.hover.py);
    ctx.lineTo(plot.right, state.hover.py);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const visibleDates = Array.from(new Set(allPoints
    .filter((point) => point.x >= view.xMin && point.x <= view.xMax)
    .map((point) => point.date)))
    .sort((a, b) => toTimestamp(a) - toTimestamp(b));
  chooseDateTicks(visibleDates, scale, ctx, plot).forEach((tick) => {
    ctx.fillStyle = colors.text;
    ctx.fillText(tick.label, tick.x, height - 22);
  });

  if (options.legend) {
    let offset = pad.left;
    normalizedSeries.forEach((line) => {
      ctx.fillStyle = line.color;
      ctx.fillRect(offset, 0, 10, 10);
      ctx.fillStyle = colors.text;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(line.label, offset + 16, 0);
      offset += ctx.measureText(line.label).width + 42;
    });
  }

  if (state.hover) {
    const rows = [
      `${state.hover.lineLabel}`,
      `${formatDate(state.hover.date)} · ${niceNumber(state.hover.y)}`
    ];
    ctx.font = "12px Inter, system-ui, sans-serif";
    const boxWidth = Math.max(...rows.map((row) => ctx.measureText(row).width)) + 22;
    const boxHeight = 50;
    const boxX = state.hover.px + boxWidth + 14 > width ? state.hover.px - boxWidth - 14 : state.hover.px + 14;
    const boxY = clamp(state.hover.py - boxHeight - 12, 8, height - boxHeight - 8);
    ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    ctx.strokeStyle = "rgba(34, 37, 34, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = state.hover.color;
    ctx.fillRect(boxX + 10, boxY + 13, 8, 8);
    ctx.fillStyle = "#222522";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    ctx.fillText(rows[0], boxX + 24, boxY + 9);
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.fillStyle = colors.text;
    ctx.fillText(rows[1], boxX + 10, boxY + 29);
  }
}

function renderMainLiftChart() {
  const mode = document.getElementById("mainChartMode").value;
  const keys = ["bench", "squat", "pulldown", "shoulderPress"];
  const series = keys.map((key) => ({
    label: trainingData.exercises[key].name,
    color: colors[key],
    points: getRecords(key).map((record) => ({
      date: record.date,
      y: mode === "load" ? record.load : record.estimated
    }))
  }));
  drawLineChart("mainLiftChart", series, {
    height: 240,
    legend: true,
    xWindowDays: 30,
    yDomain: mode === "load" ? [15, 75] : [20, 90]
  });
}

function renderBodyweightChart() {
  const points = trainingData.sessions
    .filter((session) => session.bodyweight)
    .map((session) => ({ date: session.date, y: session.bodyweight }));
  drawLineChart("bodyweightChart", [{ label: "体重", color: colors.bodyweight, points }], {
    height: 240,
    xWindowDays: 30,
    yDomain: [66, 69]
  });
}

function renderWatchList() {
  const items = [
    {
      id: "chest",
      tone: "positive",
      title: "胸日恢复最快",
      text: "5.25 卧推回到 60×8×2，上斜 22.5×10×3，下一步重点是稳住而不是急冲 62.5。",
      sections: [
        { title: "判断", text: "胸日已经从停练后的回归状态切回稳定推进期。卧推工作组恢复到 60kg 两组 8 次，上斜哑铃也能在 22.5kg 做满 10 次，说明基础力量和动作节奏都回来了。" },
        { title: "依据", text: "5.21 回归胸日是 60×6 / 57.5×8×2 / 55×8；5.25 已经回到 60×8×2 / 57.5×8×2。这个变化不是单组爆发，而是整个卧推结构恢复。" },
        { title: "建议", text: "下一次胸日先继续用 60 / 60 / 57.5 / 57.5，不急着把 62.5kg 放回常规模板。只有当 60kg 第二组最后 1 次不再明显没力，再考虑上探。" }
      ]
    },
    {
      id: "pullup",
      tone: "coral",
      title: "引体是当前短板",
      text: "停练后从 8×3 掉到 7/6/6，背日先把自重质量拉回去。",
      sections: [
        { title: "判断", text: "背日整体没有崩，但引体向上最明显掉速。下拉、划船、绳索三头都还能完成，说明不是背日全线退步，而是自重垂直拉的启动能力和连续组耐力下降。" },
        { title: "依据", text: "Cycle 8 引体是 8×3 且主观很轻松；Cycle 9 也是 8×3 但最后两个力竭；回归后变成 7/6/6，并备注拉不动了。" },
        { title: "建议", text: "下一次背日不要先加下拉重量。引体目标只设 8/7/7 或 8/8/7，质量到顶优先。高位下拉保持 50-53kg 区间，不要为了补偿引体下降去硬冲。" }
      ]
    },
    {
      id: "press",
      tone: "gold",
      title: "推肩不要硬顶",
      text: "5.23 坐姿 20×10×3 已经蛮吃力，建议先把 20kg 做满 12 次。",
      sections: [
        { title: "判断", text: "肩腿日的下肢恢复比肩推快。深蹲和 RDL 都能回到相对稳定的工作重量，但坐姿哑铃推肩在 20kg 就已经吃力，不适合马上回 22.5kg 常规组。" },
        { title: "依据", text: "停练前 22.5kg 曾做到 12/12/10，但当时已经备注第一组就能量不够。回归后 20×10×3 仍然蛮吃力，说明肩推恢复不如胸日。" },
        { title: "建议", text: "肩腿日先把推肩写成 20kg 三组 10-12 次。只要第三组不到 12，就不要上 22.5kg。当天如果深蹲/RDL 已经消耗明显，推肩宁可稳，不要硬顶。" }
      ]
    }
  ];

  document.getElementById("watchList").innerHTML = items.map((item) => `
    <button class="watch-item ${item.tone}" type="button" data-evaluation="${item.id}">
      <strong>${item.title}</strong>
      <p>${item.text}</p>
    </button>
  `).join("");
  window.evaluationItems = items;
}

function renderCycleReview() {
  const panel = document.getElementById("cycleReviewPanel");
  if (!panel) return;

  const progress = cycleProgress(latestCycleName());
  const review = getStoredCycleReview(progress.cycle);
  const summary = cycleSummary(progress);
  const statusText = progress.isComplete
    ? "Cycle 已结束"
    : `进行中 ${progress.completedDays.length}/${CYCLE_DAYS.length}`;
  const missingText = progress.isComplete
    ? "三天训练已完整记录，可以复盘并生成下一轮方向。"
    : `还差 ${progress.missingDays.map((day) => day.label).join("、")}。`;
  const summaryItems = [
    { label: "训练日", value: `${progress.completedDays.length}/${CYCLE_DAYS.length}` },
    { label: "平均时长", value: summary.avgDuration ? `${summary.avgDuration} 分钟` : "暂无" },
    {
      label: "体重变化",
      value: summary.weightChange === null ? "暂无" : `${summary.weightChange >= 0 ? "+" : ""}${summary.weightChange}kg`
    }
  ];
  const advice = review.generatedAt ? generateCycleAdvice(progress, review) : [];

  panel.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="label">Cycle 复盘</p>
        <h3>${escapeHtml(progress.cycle)} · ${statusText}</h3>
      </div>
      <span class="pill ${progress.isComplete ? "positive" : ""}">${progress.isComplete ? "可总结" : "未完成"}</span>
    </div>

    <div class="cycle-status">
      ${summaryItems.map((item) => `
        <div class="cycle-status-item">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
        </div>
      `).join("")}
    </div>

    <p class="cycle-note">${escapeHtml(missingText)}</p>

    <form class="cycle-form" id="cycleReviewForm">
      <div class="cycle-fields">
        <label>
          <span>恢复</span>
          <select name="recovery" aria-label="恢复">
            <option value="5" ${review.recovery === "5" ? "selected" : ""}>很好</option>
            <option value="4" ${review.recovery === "4" ? "selected" : ""}>不错</option>
            <option value="3" ${!review.recovery || review.recovery === "3" ? "selected" : ""}>一般</option>
            <option value="2" ${review.recovery === "2" ? "selected" : ""}>偏累</option>
            <option value="1" ${review.recovery === "1" ? "selected" : ""}>很差</option>
          </select>
        </label>
        <label>
          <span>难度</span>
          <select name="effort" aria-label="难度">
            <option value="1" ${review.effort === "1" ? "selected" : ""}>很轻松</option>
            <option value="2" ${review.effort === "2" ? "selected" : ""}>可控</option>
            <option value="3" ${!review.effort || review.effort === "3" ? "selected" : ""}>刚好</option>
            <option value="4" ${review.effort === "4" ? "selected" : ""}>偏难</option>
            <option value="5" ${review.effort === "5" ? "selected" : ""}>太难</option>
          </select>
        </label>
        <label>
          <span>不适</span>
          <select name="pain" aria-label="不适">
            <option value="1" ${!review.pain || review.pain === "1" ? "selected" : ""}>没有</option>
            <option value="2" ${review.pain === "2" ? "selected" : ""}>轻微</option>
            <option value="3" ${review.pain === "3" ? "selected" : ""}>明显</option>
            <option value="4" ${review.pain === "4" ? "selected" : ""}>影响训练</option>
            <option value="5" ${review.pain === "5" ? "selected" : ""}>需要停止</option>
          </select>
        </label>
      </div>
      <label class="cycle-textarea">
        <span>主观记录</span>
        <textarea name="notes" rows="3" placeholder="这一轮哪里顺、哪里卡、恢复怎么样">${escapeHtml(review.notes || "")}</textarea>
      </label>
      <button type="submit" class="primary-action">${review.generatedAt ? "更新下轮建议" : "生成下轮建议"}</button>
    </form>

    <div class="cycle-advice ${advice.length ? "" : "empty"}" id="cycleAdvice">
      ${advice.length ? `
        <p class="label">下轮方向</p>
        <ul>
          ${advice.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      ` : `<p>完成主观反馈后，这里会生成下一轮训练方向。</p>`}
    </div>
  `;
}

function openEvaluationDetail(id) {
  const item = window.evaluationItems?.find((entry) => entry.id === id);
  const modal = document.getElementById("evaluationModal");
  if (!item || !modal) return;

  document.getElementById("evaluationLabel").textContent = "训练评价";
  document.getElementById("evaluationTitle").textContent = item.title;
  document.getElementById("evaluationSummary").textContent = item.text;
  document.getElementById("evaluationSections").innerHTML = item.sections.map((section) => `
    <section class="detail-section">
      <h3>${section.title}</h3>
      <p>${section.text}</p>
    </section>
  `).join("");
  document.getElementById("detailChartWrap").style.display = "none";

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeEvaluationDetail() {
  const modal = document.getElementById("evaluationModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function detailExerciseConfig(key) {
  const configs = {
    bench: {
      title: "卧推状态",
      summary: "卧推是当前恢复最快的主项。停练后已经回到 60kg 工作组，但 62.5kg 还不适合常规化。",
      metric: "load",
      yDomain: [55, 65],
      sections: [
        { title: "趋势判断", text: "4 月中下旬卧推长期卡在 60kg 多组，5.5 上探到 62.5×7。回归后 5.21 降到 60×6，5.25 又恢复到 60×8×2，恢复速度很好。" },
        { title: "下一步", text: "继续把 60 / 60 / 57.5 / 57.5 做稳。等第二组 60×8 不再明显没力，再重新安排 62.5kg 上探。" }
      ]
    },
    squat: {
      title: "深蹲峰值",
      summary: "深蹲峰值来自 Cycle 8 的 67.5×8，回归后先降到 65kg 是合理处理。",
      metric: "load",
      yDomain: [57.5, 70],
      sections: [
        { title: "趋势判断", text: "深蹲从 60×8 稳定推进到 65×8，再到 67.5×8。这个进步路线比较干净，没有明显靠硬顶堆出来。" },
        { title: "下一步", text: "回归后先用 67.5 / 65 / 65 或 65 / 65 / 62.5 看状态。腰背和动作速度比单次重量更重要。" }
      ]
    },
    pullup: {
      title: "引体回归",
      summary: "引体是停练后掉得最明显的项目。当前重点不是加负重，而是回到 8/8/8。",
      metric: "reps",
      yDomain: [5, 9],
      sections: [
        { title: "趋势判断", text: "停练前引体多次做到 8×3，Cycle 8 主观很轻松。回归后掉到 7/6/6，说明连续组耐力还没回来。" },
        { title: "下一步", text: "下一次目标设为 8/7/7 或 8/8/7。高位下拉不要因为引体下降而过度补偿，先把引体动作质量拉回来。" }
      ]
    }
  };

  return configs[key];
}

function openMetricDetail(id) {
  const modal = document.getElementById("evaluationModal");
  if (!modal) return;

  let title = "";
  let summary = "";
  let sections = [];
  let chartSeries = [];
  let yDomain = null;

  if (id === "bodyweight") {
    const points = trainingData.sessions
      .filter((session) => session.bodyweight)
      .map((session) => ({ date: session.date, y: session.bodyweight }));
    title = "体重趋势";
    summary = "体重从 4.4 的 66.8kg 上升到 5.25 的 68.45kg，整体是增肌期需要的温和上行。";
    sections = [
      { title: "趋势判断", text: "中间有日波动，但大方向是上升。5.21 到 5.25 回归期体重也没有明显掉下去，说明停练期间饮食和恢复没有完全断。" },
      { title: "下一步", text: "继续看 7 日趋势，不要被单日体重影响。若训练表现上升但体重连续两周不动，再考虑小幅增加摄入。" }
    ];
    chartSeries = [{ label: "体重", color: colors.bodyweight, points }];
    yDomain = [66, 69];
  } else {
    const config = detailExerciseConfig(id);
    if (!config) return;
    const exercise = trainingData.exercises[id];
    title = config.title;
    summary = config.summary;
    sections = config.sections;
    chartSeries = [{
      label: exercise.name,
      color: colors[id] || colors.bench,
      points: getRecords(id).map((record) => ({
        date: record.date,
        y: metricValue(record, config.metric)
      }))
    }];
    yDomain = config.yDomain;
  }

  document.getElementById("evaluationLabel").textContent = "详细趋势";
  document.getElementById("evaluationTitle").textContent = title;
  document.getElementById("evaluationSummary").textContent = summary;
  document.getElementById("evaluationSections").innerHTML = sections.map((section) => `
    <section class="detail-section">
      <h3>${section.title}</h3>
      <p>${section.text}</p>
    </section>
  `).join("");
  document.getElementById("detailChartWrap").style.display = "block";

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    drawLineChart("detailTrendChart", chartSeries, {
      height: 260,
      xWindowDays: 45,
      yDomain
    });
  });
}

function renderSplitVisual() {
  const blocks = [
    { title: "胸日 + 二头", text: "卧推主线 · 上斜稳定 · 夹胸收缩 · 二头补充" },
    { title: "背日 + 三头", text: "引体质量 · 高位下拉 · 划船厚度 · 绳索三头" },
    { title: "肩腿日 + 腹", text: "深蹲/RDL · 单腿稳定 · 推肩保守 · 核心收尾" }
  ];

  document.getElementById("splitVisual").innerHTML = blocks.map((block) => `
    <div class="split-block">
      <strong>${block.title}</strong>
      <span>${block.text}</span>
    </div>
  `).join("");
}

function renderExerciseTabs() {
  const tabs = Object.entries(trainingData.exercises).map(([key, exercise]) => `
    <button type="button" class="${key === selectedExercise ? "active" : ""}" data-exercise="${key}">${exercise.name}</button>
  `).join("");
  document.getElementById("exerciseTabs").innerHTML = tabs;
}

function renderExerciseView() {
  const exercise = trainingData.exercises[selectedExercise];
  const records = getRecords(selectedExercise);
  const metric = document.getElementById("progressMetric").value;
  const latest = records.at(-1);
  const best = records.reduce((winner, item) => item.estimated > winner.estimated ? item : winner, records[0]);
  const points = records.map((record) => ({
    date: record.date,
    y: metric === "load" ? record.load : metric === "reps" ? record.reps : record.estimated
  }));
  const exerciseDomains = {
    bench: { estimated: [70, 85], load: [55, 65], reps: [5, 9] },
    incline: { estimated: [27, 36], load: [20, 27.5], reps: [7, 13] },
    squat: { estimated: [70, 90], load: [57.5, 70], reps: [6, 9] },
    rdl: { estimated: [57.5, 72.5], load: [45, 55], reps: [7, 10] },
    pullup: { estimated: [5, 9], load: [0, 1], reps: [5, 9] },
    pulldown: { estimated: [55, 80], load: [45, 55], reps: [9, 13] },
    shoulderPress: { estimated: [25, 34], load: [19, 24], reps: [7, 13] }
  };

  document.getElementById("exerciseDay").textContent = exercise.day;
  document.getElementById("exerciseTitle").textContent = exercise.name;
  document.getElementById("exerciseStatus").textContent = exercise.status;
  document.getElementById("latestSetTitle").textContent = selectedExercise === "pullup"
    ? `${latest.reps} 次`
    : `${latest.load} × ${latest.reps}`;
  document.getElementById("exerciseDetail").innerHTML = `
    <div class="detail-row"><span>最佳记录</span><strong>${selectedExercise === "pullup" ? `${best.reps} 次` : `${best.load} × ${best.reps}`}</strong></div>
    <div class="detail-row"><span>最新记录</span><strong>${formatDate(latest.date)} · ${latest.cycle}</strong></div>
    <div class="detail-row"><span>下一目标</span><strong>${exercise.goal}</strong></div>
    <div class="detail-row"><span>最近备注</span><strong>${latest.note}</strong></div>
  `;

  drawLineChart("exerciseChart", [{ label: exercise.name, color: colors[selectedExercise] || colors.bench, points }], {
    height: 300,
    xWindowDays: 35,
    yDomain: exerciseDomains[selectedExercise]?.[metric]
  });
  renderExerciseInsights(records, metric);
}

function renderExerciseInsights(records, metric) {
  const latest = records.at(-1);
  const previous = records.at(-2);
  const best = records.reduce((winner, item) => metricValue(item, metric) > metricValue(winner, metric) ? item : winner, records[0]);
  const isPullup = selectedExercise === "pullup";
  const latestText = isPullup ? `${latest.reps} 次` : `${latest.load} × ${latest.reps}`;
  const bestText = isPullup ? `${best.reps} 次` : `${best.load} × ${best.reps}`;
  const delta = previous ? Math.round((metricValue(latest, metric) - metricValue(previous, metric)) * 10) / 10 : 0;
  const unitText = metric === "load" ? "kg" : metric === "reps" ? "次" : "";
  const trendText = delta > 0 ? `比上次提高 ${delta}${unitText}` : delta < 0 ? `比上次回落 ${Math.abs(delta)}${unitText}` : "和上次基本持平";

  const items = [
    { label: "最新", title: `${formatDate(latest.date)} · ${latestText}`, text: latest.note },
    { label: "趋势", title: trendText, text: previous ? `上次是 ${formatDate(previous.date)} · ${metricLabel(previous, metric)}` : "暂无上一条记录" },
    { label: "最佳", title: `${formatDate(best.date)} · ${bestText}`, text: best.note }
  ];

  document.getElementById("exerciseInsights").innerHTML = items.map((item) => `
    <article class="insight-card">
      <p class="label">${item.label}</p>
      <strong>${item.title}</strong>
      <span>${item.text}</span>
    </article>
  `).join("");
}

function renderSessions() {
  const sessions = filteredSessions().slice().reverse();
  document.getElementById("sessionList").innerHTML = sessions.map((session) => `
    <article class="session-card">
      <div class="session-date">${formatDate(session.date)}</div>
      <div>
        <h3>${session.day}</h3>
        <p>${session.summary}</p>
      </div>
      <span class="tag">${session.cycle}</span>
    </article>
  `).join("");
}

function bindEvents() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-button").forEach((item) => {
        item.classList.toggle("active", item === button);
        item.setAttribute("aria-pressed", item === button ? "true" : "false");
      });
      document.querySelectorAll(".view").forEach((view) => {
        view.classList.toggle("active", view.id === button.dataset.view);
      });
      redrawCharts();
    });
  });

  document.querySelectorAll(".chip").forEach((button) => {
    button.addEventListener("click", () => {
      currentCycleFilter = button.dataset.cycle;
      document.querySelectorAll(".chip").forEach((item) => item.classList.toggle("active", item === button));
      renderSessions();
    });
  });

  document.getElementById("mainChartMode").addEventListener("change", renderMainLiftChart);
  document.getElementById("progressMetric").addEventListener("change", renderExerciseView);
  document.getElementById("exerciseTabs").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    selectedExercise = button.dataset.exercise;
    document.getElementById("progressMetric").value = defaultMetricForExercise(selectedExercise);
    renderExerciseTabs();
    renderExerciseView();
  });

  document.querySelectorAll(".chart-actions").forEach((group) => {
    group.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      applyChartAction(button.dataset.chart, button.dataset.action);
    });
  });

  document.getElementById("watchList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-evaluation]");
    if (!button) return;
    openEvaluationDetail(button.dataset.evaluation);
  });

  document.getElementById("cycleReviewPanel").addEventListener("submit", (event) => {
    if (event.target.id !== "cycleReviewForm") return;
    event.preventDefault();
    const cycle = latestCycleName();
    const formData = new FormData(event.target);
    storeCycleReview(cycle, {
      recovery: formData.get("recovery"),
      effort: formData.get("effort"),
      pain: formData.get("pain"),
      notes: formData.get("notes"),
      generatedAt: new Date().toISOString()
    });
    renderCycleReview();
  });

  document.getElementById("metricGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-metric-detail]");
    if (!button) return;
    openMetricDetail(button.dataset.metricDetail);
  });

  document.querySelectorAll("[data-close-evaluation]").forEach((item) => {
    item.addEventListener("click", closeEvaluationDetail);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeEvaluationDetail();
  });

  window.addEventListener("resize", () => {
    clearTimeout(window.__chartResizeTimer);
    window.__chartResizeTimer = setTimeout(redrawCharts, 120);
  });
}

function redrawCharts() {
  renderMainLiftChart();
  renderBodyweightChart();
  renderExerciseView();
}

async function init() {
  await loadTrainingData();
  if (!trainingData) return;
  document.getElementById("progressMetric").value = defaultMetricForExercise(selectedExercise);
  renderMetrics();
  renderWatchList();
  renderCycleReview();
  renderSplitVisual();
  renderExerciseTabs();
  renderSessions();
  bindEvents();
  redrawCharts();
}

init();
