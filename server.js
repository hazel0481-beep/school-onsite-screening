const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3100);
const HOST = "0.0.0.0";
const DEFAULT_DATA_DIR = path.join(__dirname, "data");
const CLOUD_RUN_DATA_DIR = "/tmp/oral-exam-board-data";
const DEFAULT_EVENT_DATE = "2026-07-02";
const SEED_DATA_PATH = path.join(DEFAULT_DATA_DIR, "state.json");
const DATA_DIR = resolveDataDir();
const DATA_PATH = path.join(DATA_DIR, "state.json");
const BUILDING_ORDER = ["본관", "별관", "신관"];
const STATUS_VALUES = new Set(["pending", "in_progress", "complete"]);
const STATIC_FILES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/app.js": "app.js",
};
const SSE_CLIENTS = new Set();
const SUPABASE_URL = sanitizeSupabaseUrl(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SUPABASE_TABLE = sanitizeSupabaseIdentifier(process.env.SUPABASE_TABLE) || "oral_exam_board_state";
const SUPABASE_ROW_ID = sanitizeString(process.env.SUPABASE_ROW_ID || "default", 80) || "default";
const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

let state = null;

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && requestUrl.pathname === "/api/state") {
      return sendJson(response, 200, state);
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/events") {
      return openEventStream(request, response);
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/meta") {
      const payload = await readJsonBody(request);
      state.meta = normalizeMeta({
        schoolName: payload.schoolName,
        boardTitle: payload.boardTitle,
        eventDate: payload.eventDate,
      });
      await persistState();
      broadcastState();
      return sendJson(response, 200, state);
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/classes") {
      const payload = await readJsonBody(request);
      state.classes = normalizeClasses(payload.classes, state.classes);
      state.floorsByBuilding = normalizeFloorsByBuilding(payload.floorsByBuilding, state.classes);
      await persistState();
      broadcastState();
      return sendJson(response, 200, state);
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/class-status") {
      const payload = await readJsonBody(request);
      const nextStatus = sanitizeStatus(payload.status);
      const targetId = String(payload.classId || "");
      const updatedBy = sanitizeString(payload.updatedBy, 30) || "담임";
      const target = state.classes.find((item) => item.id === targetId);

      if (!target) {
        return sendJson(response, 404, { message: "Class not found." });
      }

      const updatedAt = new Date().toISOString();
      state.classes = state.classes.map((item) =>
        item.id === targetId
          ? {
              ...item,
              status: nextStatus,
              updatedAt,
              updatedBy,
            }
          : item,
      );

      const updatedClass = state.classes.find((item) => item.id === targetId);
      state.history.unshift({
        classId: updatedClass.id,
        label: formatClassLabel(updatedClass),
        status: nextStatus,
        updatedAt,
        updatedBy,
      });
      state.history = normalizeHistory(state.history);

      await persistState();
      broadcastState();
      return sendJson(response, 200, state);
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/reset-statuses") {
      state.classes = state.classes.map((item) => ({
        ...item,
        status: "pending",
        updatedAt: "",
        updatedBy: "",
      }));
      state.history = [];
      await persistState();
      broadcastState();
      return sendJson(response, 200, state);
    }

    if (request.method === "GET" && STATIC_FILES[requestUrl.pathname]) {
      return sendStaticFile(response, STATIC_FILES[requestUrl.pathname]);
    }

    sendJson(response, 404, { message: "Not found." });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { message: "Internal server error." });
  }
});

boot().catch((error) => {
  console.error("Failed to boot oral exam board.", error);
  process.exitCode = 1;
});

async function boot() {
  state = await loadOrCreateState();
  server.listen(PORT, HOST, () => {
    console.log(`Oral exam board running at http://localhost:${PORT}`);
    console.log(`Using state file: ${DATA_PATH}`);
    if (HAS_SUPABASE) {
      console.log(`Using Supabase table: ${SUPABASE_TABLE}`);
    }
  });
}

async function loadOrCreateState() {
  if (HAS_SUPABASE) {
    const remoteState = await readSupabaseState();
    if (remoteState) {
      return remoteState;
    }
  }

  const existingState = readStateFile(DATA_PATH);
  if (existingState) {
    if (HAS_SUPABASE) {
      await writeSupabaseState(existingState);
    }
    return existingState;
  }

  const seededState =
    path.resolve(DATA_PATH) !== path.resolve(SEED_DATA_PATH) ? readStateFile(SEED_DATA_PATH) : null;
  const initialState = seededState || createDefaultState();
  writeStateFile(DATA_PATH, initialState);
  if (HAS_SUPABASE) {
    await writeSupabaseState(initialState);
  }
  return initialState;
}

function resolveDataDir() {
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR);
  }

  if (canWriteToDirectory(DEFAULT_DATA_DIR)) {
    return DEFAULT_DATA_DIR;
  }

  return CLOUD_RUN_DATA_DIR;
}

function canWriteToDirectory(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const probePath = path.join(dirPath, `.write-test-${process.pid}`);
    fs.writeFileSync(probePath, "ok");
    fs.unlinkSync(probePath);
    return true;
  } catch (error) {
    return false;
  }
}

function readStateFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    return null;
  }
}

function writeStateFile(filePath, nextState) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(nextState, null, 2));
}

function createDefaultState() {
  const classes = createSampleClasses();
  return {
    meta: {
      schoolName: "학교 건강검진일",
      boardTitle: "학생 구강검진 현황판",
      eventDate: DEFAULT_EVENT_DATE,
    },
    floorsByBuilding: createSampleFloorsByBuilding(),
    classes,
    history: [],
  };
}

function createSampleClasses() {
  return [
    { grade: 1, classNo: 2, building: "본관", floor: "1층" },
    { grade: 1, classNo: 1, building: "본관", floor: "1층" },
    { grade: 1, classNo: 3, building: "본관", floor: "2층" },
    { grade: 1, classNo: 4, building: "본관", floor: "2층" },
    { grade: 5, classNo: 1, building: "본관", floor: "2층" },
    { grade: 5, classNo: 2, building: "본관", floor: "2층" },
    { grade: 5, classNo: 3, building: "본관", floor: "2층" },
    { grade: 5, classNo: 4, building: "본관", floor: "2층" },
    { grade: 4, classNo: 1, building: "본관", floor: "3층" },
    { grade: 4, classNo: 2, building: "본관", floor: "3층" },
    { grade: 4, classNo: 3, building: "본관", floor: "3층" },
    { grade: 4, classNo: 4, building: "본관", floor: "3층" },
    { grade: 4, classNo: 5, building: "본관", floor: "3층" },
    { grade: 5, classNo: 5, building: "본관", floor: "3층" },
    { grade: 2, classNo: 4, building: "별관", floor: "2층" },
    { grade: 2, classNo: 3, building: "별관", floor: "2층" },
    { grade: 2, classNo: 2, building: "별관", floor: "2층" },
    { grade: 2, classNo: 1, building: "별관", floor: "2층" },
    { grade: 3, classNo: 4, building: "별관", floor: "3층" },
    { grade: 3, classNo: 1, building: "별관", floor: "4층" },
    { grade: 3, classNo: 2, building: "별관", floor: "4층" },
    { grade: 3, classNo: 3, building: "별관", floor: "4층" },
    { grade: 6, classNo: 1, building: "신관", floor: "3층" },
    { grade: 6, classNo: 2, building: "신관", floor: "3층" },
    { grade: 6, classNo: 3, building: "신관", floor: "4층" },
    { grade: 6, classNo: 4, building: "신관", floor: "4층" },
    { grade: 6, classNo: 5, building: "신관", floor: "4층" },
  ].map((entry) => ({
    id: createId(),
    ...entry,
    roomLabel: `${entry.grade}-${entry.classNo} 교실`,
    status: "pending",
    updatedAt: "",
    updatedBy: "",
  }));
}

function createSampleFloorsByBuilding() {
  return {
    본관: ["1층", "2층", "3층"],
    별관: ["2층", "3층", "4층"],
    신관: ["3층", "4층"],
  };
}

function normalizeState(input) {
  const classes = normalizeClasses(input && input.classes);
  return {
    meta: normalizeMeta(input && input.meta),
    floorsByBuilding: normalizeFloorsByBuilding(input && input.floorsByBuilding, classes),
    classes,
    history: normalizeHistory(input && input.history),
  };
}

function normalizeMeta(input) {
  return {
    schoolName: sanitizeString(input && input.schoolName, 40) || "학교 건강검진일",
    boardTitle: sanitizeString(input && input.boardTitle, 60) || "학생 구강검진 현황판",
    eventDate: sanitizeDate(input && input.eventDate) || DEFAULT_EVENT_DATE,
  };
}

function normalizeClasses(input, previousClasses = []) {
  const fallbackClasses = Array.isArray(input) ? input : createSampleClasses();
  const previousMap = new Map(previousClasses.map((item) => [item.id, item]));

  return [...fallbackClasses]
    .map((item) => {
      const previous = previousMap.get(String(item.id || ""));
      return {
        id: sanitizeString(item.id, 40) || createId(),
        grade: clampNumber(item.grade, 1, 6),
        classNo: clampNumber(item.classNo, 1, 20),
        building: BUILDING_ORDER.includes(item.building) ? item.building : "본관",
        floor: sanitizeString(item.floor, 10) || "1층",
        roomLabel:
          sanitizeString(item.roomLabel, 30) ||
          `${clampNumber(item.grade, 1, 6)}학년 ${clampNumber(item.classNo, 1, 20)}반`,
        status: previous ? previous.status : sanitizeStatus(item.status),
        updatedAt: previous ? previous.updatedAt : sanitizeIsoDate(item.updatedAt),
        updatedBy: previous ? previous.updatedBy : sanitizeString(item.updatedBy, 30),
      };
    })
    .sort(compareClasses);
}

function normalizeFloorsByBuilding(input, classes = []) {
  const result = {};

  BUILDING_ORDER.forEach((building) => {
    const storedFloors = Array.isArray(input && input[building]) ? input[building] : [];
    const floorsFromClasses = classes.filter((item) => item.building === building).map((item) => item.floor);
    const floorLabels = uniqueFloorLabels([
      ...storedFloors.map((item) => sanitizeString(item, 10)).filter(Boolean),
      ...floorsFromClasses.map((item) => sanitizeString(item, 10)).filter(Boolean),
    ]);
    result[building] = floorLabels.length ? floorLabels : ["1층"];
  });

  return result;
}

function normalizeHistory(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => ({
      classId: sanitizeString(item.classId, 40),
      label: sanitizeString(item.label, 40),
      status: sanitizeStatus(item.status),
      updatedAt: sanitizeIsoDate(item.updatedAt),
      updatedBy: sanitizeString(item.updatedBy, 30),
    }))
    .filter((item) => item.classId && item.label)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, 80);
}

function compareClasses(left, right) {
  if (left.grade !== right.grade) {
    return left.grade - right.grade;
  }
  if (left.classNo !== right.classNo) {
    return left.classNo - right.classNo;
  }
  return left.roomLabel.localeCompare(right.roomLabel, "ko");
}

function uniqueFloorLabels(labels) {
  return Array.from(new Set(labels)).sort(compareFloorLabels);
}

function compareFloorLabels(left, right) {
  const leftMatch = String(left).match(/(\d+)/);
  const rightMatch = String(right).match(/(\d+)/);

  if (leftMatch && rightMatch && Number(leftMatch[1]) !== Number(rightMatch[1])) {
    return Number(leftMatch[1]) - Number(rightMatch[1]);
  }

  return String(left).localeCompare(String(right), "ko");
}

async function persistState() {
  if (HAS_SUPABASE) {
    await writeSupabaseState(state);
    return;
  }

  writeStateFile(DATA_PATH, state);
}

async function readSupabaseState() {
  const url = new URL(`/rest/v1/${SUPABASE_TABLE}`, SUPABASE_URL);
  url.searchParams.set("id", `eq.${SUPABASE_ROW_ID}`);
  url.searchParams.set("select", "state");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    headers: buildSupabaseHeaders(),
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`Supabase read failed: ${response.status} ${detail}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0] || !rows[0].state) {
    return null;
  }

  return normalizeState(rows[0].state);
}

async function writeSupabaseState(nextState) {
  const url = new URL(`/rest/v1/${SUPABASE_TABLE}`, SUPABASE_URL);
  url.searchParams.set("on_conflict", "id");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildSupabaseHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([
      {
        id: SUPABASE_ROW_ID,
        state: nextState,
        updated_at: new Date().toISOString(),
      },
    ]),
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`Supabase write failed: ${response.status} ${detail}`);
  }
}

function buildSupabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

async function safeReadText(response) {
  try {
    return (await response.text()).slice(0, 400);
  } catch (error) {
    return "";
  }
}

function broadcastState() {
  const payload = `data: ${JSON.stringify({ state })}\n\n`;
  SSE_CLIENTS.forEach((client) => {
    client.write(payload);
  });
}

function openEventStream(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  response.write(`data: ${JSON.stringify({ state })}\n\n`);
  SSE_CLIENTS.add(response);

  request.on("close", () => {
    SSE_CLIENTS.delete(response);
  });
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
    const size = chunks.reduce((total, current) => total + current.length, 0);
    if (size > 1024 * 1024) {
      throw new Error("Request body too large.");
    }
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function sendStaticFile(response, filename) {
  const filePath = path.join(__dirname, filename);
  const contentType = filename.endsWith(".css")
    ? "text/css; charset=utf-8"
    : filename.endsWith(".js")
      ? "application/javascript; charset=utf-8"
      : "text/html; charset=utf-8";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      return sendJson(response, 404, { message: "File not found." });
    }

    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    });
    response.end(content);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  response.end(JSON.stringify(payload));
}

function sanitizeStatus(value) {
  return STATUS_VALUES.has(value) ? value : "pending";
}

function sanitizeString(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function sanitizeSupabaseUrl(value) {
  const stringValue = String(value || "").trim();
  if (!stringValue) {
    return "";
  }

  try {
    const url = new URL(stringValue);
    return url.origin;
  } catch (error) {
    return "";
  }
}

function sanitizeSupabaseIdentifier(value) {
  const stringValue = String(value || "").trim();
  return /^[a-zA-Z0-9_]+$/.test(stringValue) ? stringValue : "";
}

function sanitizeDate(value) {
  const stringValue = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(stringValue) ? stringValue : "";
}

function sanitizeIsoDate(value) {
  const stringValue = String(value || "");
  return stringValue && !Number.isNaN(Date.parse(stringValue)) ? stringValue : "";
}

function clampNumber(value, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return min;
  }
  return Math.min(Math.max(Math.round(numericValue), min), max);
}

function createId() {
  return `class-${Math.random().toString(36).slice(2, 11)}`;
}

function formatClassLabel(classItem) {
  return `${classItem.grade}학년 ${classItem.classNo}반`;
}

function formatDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
