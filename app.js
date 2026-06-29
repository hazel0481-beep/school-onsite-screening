const BUILDING_ORDER = ["본관", "신관", "별관"];
const STATUS_LABELS = {
  pending: "검진 전",
  in_progress: "검진 중",
  complete: "완료",
};
const STATUS_SHORT_LABELS = {
  pending: "전",
  in_progress: "중",
  complete: "완",
};

const viewState = {
  server: null,
  filterGrade: "all",
  hideCompleted: false,
  connectionState: "connecting",
  setupOpen: false,
  setupRows: [],
  setupFloorsByBuilding: createEmptyFloorsByBuilding(),
  metaDraft: null,
};

const elements = {
  schoolName: document.querySelector("#schoolName"),
  boardTitle: document.querySelector("#boardTitle"),
  liveStatus: document.querySelector("#liveStatus"),
  eventDateInput: document.querySelector("#eventDateInput"),
  totalClassesValue: document.querySelector("#totalClassesValue"),
  totalClassesNote: document.querySelector("#totalClassesNote"),
  completeCountValue: document.querySelector("#completeCountValue"),
  completeCountNote: document.querySelector("#completeCountNote"),
  inProgressCountValue: document.querySelector("#inProgressCountValue"),
  inProgressCountNote: document.querySelector("#inProgressCountNote"),
  pendingCountValue: document.querySelector("#pendingCountValue"),
  pendingCountNote: document.querySelector("#pendingCountNote"),
  gradeFilters: document.querySelector("#gradeFilters"),
  hideCompletedInput: document.querySelector("#hideCompletedInput"),
  setupToggleButton: document.querySelector("#setupToggleButton"),
  closeSetupButton: document.querySelector("#closeSetupButton"),
  progressFill: document.querySelector("#progressFill"),
  progressCopy: document.querySelector("#progressCopy"),
  buildingBoard: document.querySelector("#buildingBoard"),
  currentLocationCard: document.querySelector("#currentLocationCard"),
  buildingProgressList: document.querySelector("#buildingProgressList"),
  recentUpdatesList: document.querySelector("#recentUpdatesList"),
  setupSection: document.querySelector("#setupSection"),
  metaForm: document.querySelector("#metaForm"),
  schoolNameDraftInput: document.querySelector("#schoolNameDraftInput"),
  boardTitleDraftInput: document.querySelector("#boardTitleDraftInput"),
  sortClassesButton: document.querySelector("#sortClassesButton"),
  restoreSampleButton: document.querySelector("#restoreSampleButton"),
  saveLayoutButton: document.querySelector("#saveLayoutButton"),
  layoutEditor: document.querySelector("#layoutEditor"),
};

initialize();

async function initialize() {
  bindEvents();
  await loadState();
  connectLiveUpdates();
}

function bindEvents() {
  elements.eventDateInput.addEventListener("change", async (event) => {
    if (!viewState.server) {
      return;
    }

    await postJson("/api/meta", {
      schoolName: viewState.server.meta.schoolName,
      boardTitle: viewState.server.meta.boardTitle,
      eventDate: event.target.value,
    });
  });

  elements.hideCompletedInput.addEventListener("change", (event) => {
    viewState.hideCompleted = event.target.checked;
    render();
  });

  elements.gradeFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-grade-filter]");
    if (!button) {
      return;
    }

    viewState.filterGrade = button.getAttribute("data-grade-filter") || "all";
    render();
  });

  elements.setupToggleButton.addEventListener("click", () => {
    openSetup();
  });

  elements.closeSetupButton.addEventListener("click", () => {
    closeSetup();
  });

  elements.buildingBoard.addEventListener("click", async (event) => {
    const classWindow = event.target.closest("[data-class-window]");
    if (classWindow) {
      await postJson("/api/class-status", {
        classId: classWindow.getAttribute("data-class-id"),
        status: getNextStatus(classWindow.getAttribute("data-current-status")),
        updatedBy: "담임",
      });
      return;
    }

    const button = event.target.closest("[data-status-button]");
    if (!button) {
      return;
    }

    await postJson("/api/class-status", {
      classId: button.getAttribute("data-class-id"),
      status: button.getAttribute("data-status-value"),
      updatedBy: "담임",
    });
  });

  elements.metaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!viewState.metaDraft || !viewState.server) {
      return;
    }

    await postJson("/api/meta", {
      schoolName: viewState.metaDraft.schoolName,
      boardTitle: viewState.metaDraft.boardTitle,
      eventDate: viewState.server.meta.eventDate,
    });
  });

  elements.schoolNameDraftInput.addEventListener("input", (event) => {
    if (!viewState.metaDraft) {
      return;
    }
    viewState.metaDraft.schoolName = event.target.value;
  });

  elements.boardTitleDraftInput.addEventListener("input", (event) => {
    if (!viewState.metaDraft) {
      return;
    }
    viewState.metaDraft.boardTitle = event.target.value;
  });

  elements.sortClassesButton.addEventListener("click", () => {
    if (!viewState.setupOpen) {
      return;
    }

    viewState.setupRows = sortClasses(viewState.setupRows);
    viewState.setupFloorsByBuilding = normalizeSetupFloorsByBuilding(viewState.setupFloorsByBuilding, viewState.setupRows);
    renderLayoutEditor();
  });

  elements.restoreSampleButton.addEventListener("click", () => {
    if (!confirm("샘플 배치를 다시 불러올까요? 저장 전인 설정은 사라집니다.")) {
      return;
    }

    viewState.setupRows = createSampleClasses();
    viewState.setupFloorsByBuilding = createSampleFloorsByBuilding();
    renderLayoutEditor();
  });

  elements.saveLayoutButton.addEventListener("click", async () => {
    const cleanedRows = sanitizeDraftRows(viewState.setupRows);
    const cleanedFloorsByBuilding = sanitizeFloorsByBuilding(viewState.setupFloorsByBuilding, cleanedRows);
    const duplicateKey = findDuplicateClassKey(cleanedRows);

    if (duplicateKey) {
      alert(`${duplicateKey}이 중복되어 있어요. 학년과 반 조합을 확인해 주세요.`);
      return;
    }

    if (!cleanedRows.length) {
      alert("최소 한 개 학급은 필요해요.");
      return;
    }

    await postJson("/api/classes", {
      classes: cleanedRows,
      floorsByBuilding: cleanedFloorsByBuilding,
    });
  });

  elements.layoutEditor.addEventListener("input", (event) => {
    const target = event.target.closest("[data-class-field]");
    if (!target) {
      return;
    }

    const row = target.closest("[data-row-id]");
    if (!row) {
      return;
    }

    updateDraftRow(row.getAttribute("data-row-id"), target.getAttribute("data-class-field"), target.value);

    const nextRow = viewState.setupRows.find((item) => item.id === row.getAttribute("data-row-id"));
    const title = row.querySelector(".setup-class-card__title");
    if (nextRow && title) {
      title.textContent = formatClassLabel(nextRow);
    }
  });

  elements.layoutEditor.addEventListener("click", (event) => {
    const addFloorButton = event.target.closest("[data-add-floor-building]");
    if (addFloorButton) {
      addSetupFloor(addFloorButton.getAttribute("data-add-floor-building"));
      return;
    }

    const removeFloorButton = event.target.closest("[data-remove-floor]");
    if (removeFloorButton) {
      removeSetupFloor(
        removeFloorButton.getAttribute("data-remove-floor"),
        removeFloorButton.getAttribute("data-floor-label"),
      );
      return;
    }

    const addClassButton = event.target.closest("[data-add-class-floor]");
    if (addClassButton) {
      addSetupClass(
        addClassButton.getAttribute("data-add-class-floor"),
        addClassButton.getAttribute("data-floor-label"),
      );
      return;
    }

    const removeButton = event.target.closest("[data-remove-row]");
    if (!removeButton) {
      return;
    }

    const rowId = removeButton.getAttribute("data-remove-row");
    viewState.setupRows = viewState.setupRows.filter((item) => item.id !== rowId);
    renderLayoutEditor();
  });
}

async function loadState() {
  try {
    setConnectionState("connecting", "불러오는 중");
    const response = await fetch("/api/state");
    const payload = await response.json();
    viewState.server = payload;
    render();
  } catch (error) {
    console.error(error);
    setConnectionState("error", "불러오기 실패");
  }
}

function connectLiveUpdates() {
  const stream = new EventSource("/api/events");

  stream.onopen = () => {
    setConnectionState("connected", "실시간 연결됨");
  };

  stream.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.state) {
        viewState.server = payload.state;
        render();
      }
    } catch (error) {
      console.error("Failed to parse event stream payload.", error);
    }
  };

  stream.onerror = () => {
    setConnectionState("error", "재연결 중");
  };
}

function render() {
  if (!viewState.server) {
    return;
  }

  renderHeader();
  renderMetrics();
  renderFilters();
  renderBoard();
  renderCurrentLocation();
  renderBuildingProgress();
  renderRecentUpdates();
  renderSetup();
}

function renderHeader() {
  elements.schoolName.textContent = viewState.server.meta.schoolName;
  elements.boardTitle.textContent = viewState.server.meta.boardTitle;
  elements.eventDateInput.value = viewState.server.meta.eventDate || "";
}

function renderMetrics() {
  const classes = viewState.server.classes;
  const completeCount = classes.filter((item) => item.status === "complete").length;
  const inProgressCount = classes.filter((item) => item.status === "in_progress").length;
  const pendingCount = classes.filter((item) => item.status === "pending").length;
  const completionRate = classes.length ? Math.round((completeCount / classes.length) * 100) : 0;

  elements.totalClassesValue.textContent = String(classes.length);
  elements.totalClassesNote.textContent = `${BUILDING_ORDER.length}개 건물 기준`;
  elements.completeCountValue.textContent = String(completeCount);
  elements.completeCountNote.textContent = `${completionRate}% 완료`;
  elements.inProgressCountValue.textContent = String(inProgressCount);
  elements.inProgressCountNote.textContent = inProgressCount ? "현재 진행 중 표시됨" : "현재 지정 없음";
  elements.pendingCountValue.textContent = String(pendingCount);
  elements.pendingCountNote.textContent = pendingCount ? `${pendingCount}개 학급 남음` : "모든 학급 완료";

  elements.progressFill.style.width = `${completionRate}%`;
  elements.progressCopy.textContent = `${completeCount} / ${classes.length} 학급 완료`;
}

function renderFilters() {
  Array.from(elements.gradeFilters.querySelectorAll("[data-grade-filter]")).forEach((button) => {
    button.setAttribute("data-active", String(button.getAttribute("data-grade-filter") === viewState.filterGrade));
  });
}

function renderBoard() {
  const visibleClasses = getVisibleClasses();
  const groupedBuildings = BUILDING_ORDER.map((building) => {
    const buildingClasses = visibleClasses.filter((item) => item.building === building);
    const floorLabels = getBuildingFloorLabels(viewState.server.floorsByBuilding, building, buildingClasses);
    return {
      building,
      classes: buildingClasses,
      floors: groupByFloor(buildingClasses, floorLabels).sort((left, right) => compareFloorLabel(right.floor, left.floor)),
    };
  });

  if (!visibleClasses.length) {
    elements.buildingBoard.innerHTML = '<div class="empty-state">현재 필터에서 보이는 학급이 없어요.</div>';
    return;
  }

  elements.buildingBoard.innerHTML = groupedBuildings
    .map(({ building, classes, floors }) => {
      const completeCount = classes.filter((item) => item.status === "complete").length;
      const inProgressCount = classes.filter((item) => item.status === "in_progress").length;

      return `
        <article class="building-tower" data-building="${escapeAttribute(building)}">
          <div class="building-tower__roof">
            <div>
              <p class="building-tower__title">${escapeHtml(building)}</p>
              <p class="building-tower__meta">완료 ${completeCount}개 · 진행 중 ${inProgressCount}개</p>
            </div>
            <div class="building-tower__ratio">${completeCount}/${classes.length || 0}</div>
          </div>
          <div class="building-tower__body">
            ${
              floors.length
                ? floors.map(renderTowerFloor).join("")
                : '<div class="empty-state empty-state--tower">표시할 학급이 없어요.</div>'
            }
            <div class="building-tower__base" aria-hidden="true"></div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTowerFloor(floor) {
  return `
    <section class="tower-floor">
      <div class="tower-floor__label">
        <span>${escapeHtml(floor.floor)}</span>
      </div>
      <div class="tower-floor__windows">
        ${floor.classes.map(renderWindowUnit).join("")}
      </div>
    </section>
  `;
}

function renderWindowUnit(classItem) {
  const locationText = `${classItem.building} ${classItem.floor} · ${classItem.roomLabel}`;
  const metaText = classItem.updatedAt ? `${formatTime(classItem.updatedAt)} 업데이트` : "아직 표시 없음";
  const buttonTitle = `${formatClassLabel(classItem)} · ${locationText} · ${STATUS_LABELS[classItem.status]} · ${metaText}`;

  return `
    <button
      class="window-unit"
      type="button"
      data-class-window
      data-class-id="${classItem.id}"
      data-current-status="${classItem.status}"
      data-status="${classItem.status}"
      aria-label="${escapeAttribute(buttonTitle)}"
      title="${escapeAttribute(buttonTitle)}"
    >
      <span class="window-unit__status" data-status="${classItem.status}">${STATUS_SHORT_LABELS[classItem.status]}</span>
      <span class="window-unit__label">${formatCompactClassLabel(classItem)}</span>
      <span class="window-unit__room">${escapeHtml(formatCompactRoomLabel(classItem.roomLabel))}</span>
    </button>
  `;
}

function renderStatusButton(classItem, status) {
  return `
    <button
      class="status-button"
      type="button"
      data-status-button
      data-class-id="${classItem.id}"
      data-status-value="${status}"
      data-active="${String(classItem.status === status)}"
    >
      ${STATUS_LABELS[status]}
    </button>
  `;
}

function renderCurrentLocation() {
  const inProgress = viewState.server.classes.find((item) => item.status === "in_progress");
  const latest = viewState.server.history[0];

  if (inProgress) {
    elements.currentLocationCard.innerHTML = `
      <p class="current-location__label">지금 검진 중</p>
      <p class="current-location__value">${formatClassLabel(inProgress)}</p>
      <p class="current-location__detail">${escapeHtml(
        `${inProgress.building} ${inProgress.floor} · ${inProgress.roomLabel}`,
      )}</p>
      <p class="current-location__detail">${escapeHtml(formatUpdateTime(inProgress.updatedAt))}</p>
    `;
    return;
  }

  if (latest) {
    elements.currentLocationCard.innerHTML = `
      <p class="current-location__label">마지막 업데이트</p>
      <p class="current-location__value">${escapeHtml(latest.label)}</p>
      <p class="current-location__detail">${escapeHtml(STATUS_LABELS[latest.status])}</p>
      <p class="current-location__detail">${escapeHtml(formatUpdateTime(latest.updatedAt))}</p>
    `;
    return;
  }

  elements.currentLocationCard.innerHTML = `
    <p class="current-location__label">아직 시작 전</p>
    <p class="current-location__value">현재 위치가 표시되지 않았어요.</p>
    <p class="current-location__detail">어느 반에서 시작했는지 한 번 눌러 주면 바로 공유됩니다.</p>
  `;
}

function renderBuildingProgress() {
  elements.buildingProgressList.innerHTML = BUILDING_ORDER.map((building) => {
    const classes = viewState.server.classes.filter((item) => item.building === building);
    const completeCount = classes.filter((item) => item.status === "complete").length;
    const inProgressCount = classes.filter((item) => item.status === "in_progress").length;
    return `
      <div class="building-progress-item">
        <div>
          <p>${escapeHtml(building)}</p>
          <p class="building-progress-item__meta">완료 ${completeCount}개 · 진행 중 ${inProgressCount}개</p>
        </div>
        <strong>${completeCount}/${classes.length || 0}</strong>
      </div>
    `;
  }).join("");
}

function renderRecentUpdates() {
  if (!viewState.server.history.length) {
    elements.recentUpdatesList.innerHTML = '<div class="empty-state">아직 업데이트 기록이 없어요.</div>';
    return;
  }

  elements.recentUpdatesList.innerHTML = viewState.server.history
    .slice(0, 8)
    .map((item) => {
      return `
        <div class="recent-update-item">
          <div>
            <p>${escapeHtml(item.label)}</p>
            <p class="recent-update-item__meta">${escapeHtml(formatUpdateTime(item.updatedAt))}</p>
          </div>
          <span class="recent-update-item__status" data-status="${item.status}">${STATUS_LABELS[item.status]}</span>
        </div>
      `;
    })
    .join("");
}

function renderSetup() {
  elements.setupSection.hidden = !viewState.setupOpen;
  if (!viewState.setupOpen) {
    return;
  }

  if (!viewState.metaDraft) {
    viewState.metaDraft = {
      schoolName: viewState.server.meta.schoolName,
      boardTitle: viewState.server.meta.boardTitle,
    };
  }

  elements.schoolNameDraftInput.value = viewState.metaDraft.schoolName || "";
  elements.boardTitleDraftInput.value = viewState.metaDraft.boardTitle || "";
  renderLayoutEditor();
}

function renderLayoutEditor() {
  elements.layoutEditor.innerHTML = BUILDING_ORDER.map((building) => {
    const floors = sortFloorLabels(viewState.setupFloorsByBuilding[building] || []);

    return `
      <article class="setup-building">
        <div class="setup-building__header">
          <div>
            <p class="setup-building__title">${escapeHtml(building)}</p>
            <p class="setup-building__meta">${floors.length}개 층</p>
          </div>
          <div class="setup-building__actions">
            <button
              class="secondary-button"
              type="button"
              data-add-floor-building="${building}"
            >
              층 추가
            </button>
          </div>
        </div>
        <div class="setup-floor-list">
          ${floors.map((floor) => renderSetupFloor(building, floor)).join("")}
        </div>
      </article>
    `;
  }).join("");
}

function renderSetupFloor(building, floor) {
  const floorClasses = sortClasses(viewState.setupRows.filter((item) => item.building === building && item.floor === floor));

  return `
    <section class="setup-floor">
      <div class="setup-floor__header">
        <div>
          <p class="setup-floor__title">${escapeHtml(floor)}</p>
          <p class="setup-floor__meta">${floorClasses.length}개 학급</p>
        </div>
        <div class="setup-floor__actions">
          <button
            class="secondary-button"
            type="button"
            data-add-class-floor="${building}"
            data-floor-label="${floor}"
          >
            학급 추가
          </button>
          <button
            class="secondary-button"
            type="button"
            data-remove-floor="${building}"
            data-floor-label="${floor}"
          >
            층 삭제
          </button>
        </div>
      </div>
      <div class="setup-class-grid">
        ${
          floorClasses.length
            ? floorClasses.map((row) => renderSetupClassCard(row)).join("")
            : '<div class="empty-state empty-state--setup">아직 학급이 없어요. 이 층에 학급을 추가할 수 있어요.</div>'
        }
      </div>
    </section>
  `;
}

function renderSetupClassCard(row) {
  return `
    <article class="setup-class-card" data-row-id="${row.id}">
      <div class="setup-class-card__header">
        <p class="setup-class-card__title">${formatClassLabel(row)}</p>
        <button class="remove-button" type="button" data-remove-row="${row.id}">×</button>
      </div>
      <div class="setup-class-card__fields">
        <label>
          <span>학년</span>
          <input data-class-field="grade" type="number" min="1" max="6" value="${row.grade}" />
        </label>
        <label>
          <span>반</span>
          <input data-class-field="classNo" type="number" min="1" max="20" value="${row.classNo}" />
        </label>
        <label class="setup-class-card__wide">
          <span>표시 이름</span>
          <input data-class-field="roomLabel" type="text" maxlength="30" value="${escapeAttribute(row.roomLabel)}" />
        </label>
      </div>
    </article>
  `;
}

function openSetup() {
  if (!viewState.server) {
    return;
  }

  viewState.setupOpen = true;
  viewState.setupRows = clone(viewState.server.classes).map((item) => ({
    id: item.id,
    grade: item.grade,
    classNo: item.classNo,
    building: item.building,
    floor: item.floor,
    roomLabel: item.roomLabel,
  }));
  viewState.setupFloorsByBuilding = normalizeSetupFloorsByBuilding(viewState.server.floorsByBuilding, viewState.setupRows);
  viewState.metaDraft = {
    schoolName: viewState.server.meta.schoolName,
    boardTitle: viewState.server.meta.boardTitle,
  };
  render();
}

function closeSetup() {
  viewState.setupOpen = false;
  viewState.setupRows = [];
  viewState.setupFloorsByBuilding = createEmptyFloorsByBuilding();
  viewState.metaDraft = null;
  render();
}

function updateDraftRow(rowId, field, value) {
  viewState.setupRows = viewState.setupRows.map((row) => {
    if (row.id !== rowId) {
      return row;
    }

    if (field === "grade" || field === "classNo") {
      return { ...row, [field]: Number(value) || 1 };
    }

    return { ...row, [field]: value };
  });
}

function addSetupFloor(building) {
  if (!BUILDING_ORDER.includes(building)) {
    return;
  }

  const currentFloors = viewState.setupFloorsByBuilding[building] || [];
  const nextFloor = getNextFloorLabel(currentFloors);
  viewState.setupFloorsByBuilding = {
    ...viewState.setupFloorsByBuilding,
    [building]: sortFloorLabels([...currentFloors, nextFloor]),
  };
  renderLayoutEditor();
}

function removeSetupFloor(building, floor) {
  if (!BUILDING_ORDER.includes(building)) {
    return;
  }

  const currentFloors = viewState.setupFloorsByBuilding[building] || [];
  if (currentFloors.length <= 1) {
    alert("각 건물에는 최소 1개 층이 필요해요.");
    return;
  }

  const floorClasses = viewState.setupRows.filter((item) => item.building === building && item.floor === floor);
  const confirmMessage = floorClasses.length
    ? `${building} ${floor}을 삭제할까요? 이 층의 ${floorClasses.length}개 학급도 함께 삭제됩니다.`
    : `${building} ${floor}을 삭제할까요?`;

  if (!confirm(confirmMessage)) {
    return;
  }

  viewState.setupRows = viewState.setupRows.filter((item) => !(item.building === building && item.floor === floor));
  viewState.setupFloorsByBuilding = {
    ...viewState.setupFloorsByBuilding,
    [building]: currentFloors.filter((item) => item !== floor),
  };
  renderLayoutEditor();
}

function addSetupClass(building, floor) {
  if (!BUILDING_ORDER.includes(building)) {
    return;
  }

  const nextSlot = findNextAvailableClassSlot(viewState.setupRows);
  viewState.setupRows = sortClasses([
    ...viewState.setupRows,
    {
      id: createClientId(),
      grade: nextSlot.grade,
      classNo: nextSlot.classNo,
      building,
      floor,
      roomLabel: `${nextSlot.grade}-${nextSlot.classNo} 교실`,
    },
  ]);
  renderLayoutEditor();
}

function getVisibleClasses() {
  return sortClasses(viewState.server.classes).filter((item) => {
    const matchesGrade = viewState.filterGrade === "all" || String(item.grade) === viewState.filterGrade;
    const matchesCompletion = !viewState.hideCompleted || item.status !== "complete";
    return matchesGrade && matchesCompletion;
  });
}

function groupByFloor(classes, floorLabels = []) {
  const floorMap = new Map();

  classes.forEach((item) => {
    if (!floorMap.has(item.floor)) {
      floorMap.set(item.floor, []);
    }
    floorMap.get(item.floor).push(item);
  });

  const orderedFloors = sortFloorLabels([...floorLabels, ...Array.from(floorMap.keys())]);

  return orderedFloors
    .map((floor) => ({
      floor,
      classes: sortClasses(floorMap.get(floor) || []),
    }))
    .sort((left, right) => compareFloorLabel(left.floor, right.floor));
}

function sanitizeDraftRows(rows) {
  return sortClasses(
    rows.map((row) => ({
      id: row.id || createClientId(),
      grade: clampNumber(row.grade, 1, 6),
      classNo: clampNumber(row.classNo, 1, 20),
      building: BUILDING_ORDER.includes(row.building) ? row.building : "본관",
      floor: (row.floor || "1층").trim() || "1층",
      roomLabel: (row.roomLabel || "").trim() || `${clampNumber(row.grade, 1, 6)}학년 ${clampNumber(row.classNo, 1, 20)}반`,
    })),
  );
}

function findDuplicateClassKey(rows) {
  const seen = new Set();

  for (const row of rows) {
    const key = `${row.grade}학년 ${row.classNo}반`;
    if (seen.has(key)) {
      return key;
    }
    seen.add(key);
  }

  return "";
}

function sanitizeFloorsByBuilding(floorsByBuilding, rows) {
  const result = createEmptyFloorsByBuilding();

  BUILDING_ORDER.forEach((building) => {
    const inputFloors = Array.isArray(floorsByBuilding?.[building]) ? floorsByBuilding[building] : [];
    const floorsFromRows = rows.filter((item) => item.building === building).map((item) => item.floor);
    const nextFloors = sortFloorLabels([
      ...inputFloors.map((item) => sanitizeFloorLabel(item)).filter(Boolean),
      ...floorsFromRows.map((item) => sanitizeFloorLabel(item)).filter(Boolean),
    ]);
    result[building] = nextFloors.length ? nextFloors : ["1층"];
  });

  return result;
}

function sortClasses(classes) {
  return [...classes].sort((left, right) => {
    if (left.grade !== right.grade) {
      return left.grade - right.grade;
    }
    if (left.classNo !== right.classNo) {
      return left.classNo - right.classNo;
    }
    return left.roomLabel.localeCompare(right.roomLabel, "ko");
  });
}

function createSampleClasses() {
  const sample = [];
  const floorTemplate = [
    { grade: 1, building: "본관", floor: "1층" },
    { grade: 2, building: "본관", floor: "2층" },
    { grade: 3, building: "신관", floor: "1층" },
    { grade: 4, building: "신관", floor: "2층" },
    { grade: 5, building: "별관", floor: "1층" },
    { grade: 6, building: "별관", floor: "2층" },
  ];

  floorTemplate.forEach((entry) => {
    for (let classNo = 1; classNo <= 4; classNo += 1) {
      sample.push({
        id: createClientId(),
        grade: entry.grade,
        classNo,
        building: entry.building,
        floor: entry.floor,
        roomLabel: `${entry.grade}-${classNo} 교실`,
      });
    }
  });

  return sample;
}

function createSampleFloorsByBuilding() {
  return {
    본관: ["1층", "2층"],
    신관: ["1층", "2층"],
    별관: ["1층", "2층"],
  };
}

function createEmptyFloorsByBuilding() {
  return {
    본관: [],
    신관: [],
    별관: [],
  };
}

function normalizeSetupFloorsByBuilding(floorsByBuilding, rows) {
  return sanitizeFloorsByBuilding(floorsByBuilding, rows);
}

function getBuildingFloorLabels(floorsByBuilding, building, buildingClasses) {
  return sortFloorLabels([
    ...(Array.isArray(floorsByBuilding?.[building]) ? floorsByBuilding[building] : []),
    ...buildingClasses.map((item) => item.floor),
  ]);
}

function sortFloorLabels(floorLabels) {
  return Array.from(new Set(floorLabels.map((item) => sanitizeFloorLabel(item)).filter(Boolean))).sort(compareFloorLabel);
}

function sanitizeFloorLabel(value) {
  return String(value || "").trim().slice(0, 10);
}

function getNextFloorLabel(floorLabels) {
  const floorNumbers = floorLabels
    .map((item) => {
      const match = String(item).match(/(\d+)/);
      return match ? Number(match[1]) : 0;
    })
    .filter((item) => item > 0);

  const nextNumber = floorNumbers.length ? Math.max(...floorNumbers) + 1 : 1;
  return `${nextNumber}층`;
}

function findNextAvailableClassSlot(rows) {
  const usedKeys = new Set(rows.map((item) => `${item.grade}-${item.classNo}`));

  for (let grade = 1; grade <= 6; grade += 1) {
    for (let classNo = 1; classNo <= 20; classNo += 1) {
      const key = `${grade}-${classNo}`;
      if (!usedKeys.has(key)) {
        return { grade, classNo };
      }
    }
  }

  return { grade: 1, classNo: 1 };
}

function setConnectionState(state, label) {
  viewState.connectionState = state;
  elements.liveStatus.textContent = label;
  elements.liveStatus.setAttribute("data-state", state);
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    alert("저장 중 문제가 생겼어요. 한 번 더 시도해 주세요.");
    throw new Error(`Request failed: ${response.status}`);
  }

  const nextState = await response.json();
  viewState.server = nextState;

  if (viewState.setupOpen) {
    viewState.setupRows = clone(nextState.classes).map((item) => ({
      id: item.id,
      grade: item.grade,
      classNo: item.classNo,
      building: item.building,
      floor: item.floor,
      roomLabel: item.roomLabel,
    }));
    viewState.setupFloorsByBuilding = normalizeSetupFloorsByBuilding(nextState.floorsByBuilding, viewState.setupRows);
    viewState.metaDraft = {
      schoolName: nextState.meta.schoolName,
      boardTitle: nextState.meta.boardTitle,
    };
  }

  render();
  return nextState;
}

function formatClassLabel(classItem) {
  return `${classItem.grade}학년 ${classItem.classNo}반`;
}

function formatCompactClassLabel(classItem) {
  return `${classItem.grade}-${classItem.classNo}`;
}

function formatCompactRoomLabel(roomLabel) {
  const label = String(roomLabel || "").trim();
  if (!label) {
    return "교실";
  }

  return label.length > 8 ? `${label.slice(0, 7)}…` : label;
}

function formatUpdateTime(updatedAt) {
  const time = updatedAt ? formatTime(updatedAt) : "시간 없음";
  return `${time} 업데이트`;
}

function getNextStatus(status) {
  if (status === "pending") {
    return "in_progress";
  }

  if (status === "in_progress") {
    return "complete";
  }

  return "pending";
}

function formatTime(isoString) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function compareFloorLabel(left, right) {
  const leftMatch = String(left).match(/(\d+)/);
  const rightMatch = String(right).match(/(\d+)/);

  if (leftMatch && rightMatch && Number(leftMatch[1]) !== Number(rightMatch[1])) {
    return Number(leftMatch[1]) - Number(rightMatch[1]);
  }

  return String(left).localeCompare(String(right), "ko");
}

function clampNumber(value, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return min;
  }
  return Math.min(Math.max(Math.round(numericValue), min), max);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createClientId() {
  return `client-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
