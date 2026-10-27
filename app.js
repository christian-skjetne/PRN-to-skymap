(() => {
  "use strict";

  const SYSTEMS = {
    GPS: { name: "GPS", color: "#62d8ef", className: "GPS", prefix: "G" },
    GLO: { name: "GLONASS", color: "#ff9a6b", className: "GLO", prefix: "R" },
    GAL: { name: "Galileo", color: "#a78bfa", className: "GAL", prefix: "E" },
    BDS: { name: "BeiDou", color: "#f6c85f", className: "BDS", prefix: "C" },
    QZS: { name: "QZSS", color: "#68dda6", className: "QZS", prefix: "J" },
    SBAS: { name: "SBAS", color: "#ff75a0", className: "SBAS", prefix: "S" },
    IRNSS: { name: "NavIC", color: "#df8cff", className: "IRNSS", prefix: "I" }
  };
  const SYSTEM_BY_PREFIX = Object.fromEntries(Object.entries(SYSTEMS).map(([system, details]) => [details.prefix, system]));
  const SVG_NS = "http://www.w3.org/2000/svg";
  const center = { x: 380, y: 350 };
  const radius = 286;
  const state = {
    enabled: new Set(Object.keys(SYSTEMS)),
    observer: { latitude: 52.52, longitude: 13.405 },
    selectedNorad: null,
    counts: {},
    refreshing: false
  };
  const plot = document.getElementById("plot");
  const statusElement = document.getElementById("status");

  function setStatus(message, kind = "") {
    statusElement.textContent = message;
    statusElement.className = `status${kind ? ` ${kind}` : ""}`;
  }

  function svgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  function drawGrid() {
    plot.replaceChildren();
    plot.append(svgElement("circle", { cx: center.x, cy: center.y, r: radius, class: "sky-bg", fill: "url(#skyGradient)" }));
    plot.append(svgElement("circle", { cx: center.x, cy: center.y, r: radius, class: "sky-horizon" }));
    for (const elevation of [30, 60]) {
      const r = radius * (90 - elevation) / 90;
      plot.append(svgElement("circle", { cx: center.x, cy: center.y, r, class: "sky-grid" }));
      const label = svgElement("text", { x: center.x + 7, y: center.y - r + 12, class: "elevation-label" });
      label.textContent = `${elevation}°`;
      plot.append(label);
    }
    plot.append(svgElement("circle", { cx: center.x, cy: center.y, r: 2.5, fill: "rgba(165,190,220,.65)" }));
    plot.append(svgElement("line", { x1: center.x, y1: center.y - radius, x2: center.x, y2: center.y + radius, class: "sky-cross" }));
    plot.append(svgElement("line", { x1: center.x - radius, y1: center.y, x2: center.x + radius, y2: center.y, class: "sky-cross" }));
    for (const [text, x, y] of [
      ["N", center.x, center.y - radius - 14],
      ["E", center.x + radius + 16, center.y + 4],
      ["S", center.x, center.y + radius + 22],
      ["W", center.x - radius - 16, center.y + 4]
    ]) {
      const label = svgElement("text", { x, y, "text-anchor": "middle", class: "sky-label" });
      label.textContent = text;
      plot.append(label);
    }
  }

  function renderPlot(visible) {
    drawGrid();
    if (!visible.length) {
      const empty = svgElement("text", { x: center.x, y: center.y + 5, class: "empty-note" });
      empty.textContent = "No selected satellites above the horizon";
      plot.append(empty);
      return;
    }

    const placedLabels = [];
    const labelOffsets = [[0, -11], [14, -8], [-14, -8], [16, 5], [-16, 5], [0, 17]];
    for (const distance of [28, 40, 52, 64]) {
      for (let angle = 0; angle < 360; angle += 45) {
        const radians = angle * Math.PI / 180;
        labelOffsets.push([Math.cos(radians) * distance, Math.sin(radians) * distance]);
      }
    }
    for (const sat of visible) {
      const system = SYSTEM_BY_PREFIX[sat.PRN[0]];
      const azimuthRadians = sat.AZIMUTH * Math.PI / 180;
      const distance = radius * (90 - sat.ELEVATION) / 90;
      const x = center.x + Math.sin(azimuthRadians) * distance;
      const y = center.y - Math.cos(azimuthRadians) * distance;
      const group = svgElement("g", {
        "aria-label": `${sat.PRN} ${SYSTEMS[system].name}, azimuth ${sat.AZIMUTH.toFixed(1)} degrees, elevation ${sat.ELEVATION.toFixed(1)} degrees`
      });
      const labelWidth = Math.max(28, sat.PRN.length * 8 + 8);
      let placement = null;
      let labelBox = null;
      for (const [dx, dy] of labelOffsets) {
        const box = { left: x + dx - labelWidth / 2, right: x + dx + labelWidth / 2, top: y + dy - 12, bottom: y + dy + 5 };
        const overlaps = placedLabels.some(other => box.left < other.right + 4 && box.right + 4 > other.left && box.top < other.bottom + 4 && box.bottom + 4 > other.top);
        if (!overlaps) {
          placement = { x: x + dx, y: y + dy, box };
          break;
        }
      }
      if (!placement) {
        let dy = -30;
        do {
          labelBox = { left: x - labelWidth / 2, right: x + labelWidth / 2, top: y + dy - 12, bottom: y + dy + 5 };
          dy -= 12;
        } while (placedLabels.some(other => labelBox.left < other.right + 4 && labelBox.right + 4 > other.left && labelBox.top < other.bottom + 4 && labelBox.bottom + 4 > other.top));
        placement = { x, y: dy + 12, box: labelBox };
      }
      placedLabels.push(placement.box);
      if (Math.hypot(placement.x - x, placement.y - y) > 13) {
        group.append(svgElement("line", { x1: x, y1: y, x2: placement.x, y2: placement.y + 3, class: "sat-leader" }));
      }

      const circle = svgElement("circle", {
        cx: x,
        cy: y,
        r: sat.NORAD_ID === state.selectedNorad ? 7 : 5,
        fill: SYSTEMS[system].color,
        class: `sat-point${sat.NORAD_ID === state.selectedNorad ? " selected" : ""}`,
        tabindex: "0",
        role: "button",
        "data-norad": sat.NORAD_ID
      });
      const title = svgElement("title");
      title.textContent = `${sat.PRN} · Az ${sat.AZIMUTH.toFixed(1)}° · El ${sat.ELEVATION.toFixed(1)}° · NORAD ${sat.NORAD_ID}`;
      circle.append(title);
      circle.addEventListener("click", () => selectSatellite(sat.NORAD_ID));
      circle.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectSatellite(sat.NORAD_ID);
        }
      });
      group.append(circle);
      const label = svgElement("text", { x: placement.x, y: placement.y, class: "sat-label" });
      label.textContent = sat.PRN;
      group.append(label);
      plot.append(group);
    }
  }

  function renderTable(visible) {
    const tbody = document.getElementById("satellite-rows");
    tbody.replaceChildren();
    if (!visible.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.className = "empty-row";
      cell.colSpan = 5;
      cell.textContent = "No selected satellites are currently above the horizon.";
      row.append(cell);
      tbody.append(row);
      return;
    }
    for (const sat of visible) {
      const row = document.createElement("tr");
      row.addEventListener("click", () => selectSatellite(sat.NORAD_ID));
      const prn = document.createElement("td");
      prn.className = "prn";
      prn.textContent = sat.PRN;
      row.append(prn);
      const system = SYSTEM_BY_PREFIX[sat.PRN[0]];
      const constellation = document.createElement("td");
      const constellationLabel = document.createElement("span");
      constellationLabel.className = "constellation";
      const dot = document.createElement("i");
      dot.className = `legend-dot system-${SYSTEMS[system].className}`;
      constellationLabel.append(dot, document.createTextNode(SYSTEMS[system].name));
      constellation.append(constellationLabel);
      row.append(constellation);
      const azimuth = document.createElement("td");
      azimuth.textContent = `${sat.AZIMUTH.toFixed(1)}°`;
      row.append(azimuth);
      const elevation = document.createElement("td");
      elevation.textContent = `${sat.ELEVATION.toFixed(1)}°`;
      row.append(elevation);
      const norad = document.createElement("td");
      norad.textContent = String(sat.NORAD_ID);
      row.append(norad);
      tbody.append(row);
    }
  }

  function selectSatellite(norad) {
    state.selectedNorad = state.selectedNorad === norad ? null : norad;
    refresh();
  }

  async function refresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    const now = new Date();
    try {
      const positions = await GNSSSatelliteAPI.calculate({
        LAT: state.observer.latitude,
        LON: state.observer.longitude,
        "UTC-TIME": now
      });
      state.counts = Object.fromEntries(Object.keys(SYSTEMS).map(system => [
        system,
        positions.filter(sat => SYSTEM_BY_PREFIX[sat.PRN[0]] === system).length
      ]));
      for (const [system, count] of Object.entries(state.counts)) {
        const counter = document.querySelector(`#filters [data-system="${system}"]`);
        if (counter) counter.textContent = String(count);
      }
      const enabledPositions = positions.filter(sat => state.enabled.has(SYSTEM_BY_PREFIX[sat.PRN[0]]));
      const visible = enabledPositions.filter(sat => sat.ELEVATION >= 0);
      renderPlot(visible);
      renderTable(visible);
      document.getElementById("visible-count").textContent = String(visible.length);
      document.getElementById("tracked-count").textContent = String(enabledPositions.length);
      document.getElementById("observer-display").textContent = `${state.observer.latitude.toFixed(4)}°, ${state.observer.longitude.toFixed(4)}°`;
      document.getElementById("utc-time").textContent = `${now.toISOString().slice(0, 19).replace("T", " ")} UTC`;
    } catch (error) {
      console.error("Unable to calculate GNSS positions.", error);
      setStatus(`Unable to calculate satellite positions: ${error.message}`, "error");
    } finally {
      state.refreshing = false;
    }
  }

  function renderFilters() {
    const filters = document.getElementById("filters");
    filters.replaceChildren();
    for (const [system, definition] of Object.entries(SYSTEMS)) {
      const label = document.createElement("label");
      label.className = "filter";
      const group = document.createElement("span");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.enabled.has(system);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.enabled.add(system);
        else state.enabled.delete(system);
        refresh();
      });
      const dot = document.createElement("i");
      dot.className = `legend-dot system-${definition.className}`;
      const name = document.createElement("span");
      name.textContent = definition.name;
      group.append(checkbox, dot, name);
      const number = document.createElement("span");
      number.className = "system-count";
      number.dataset.system = system;
      number.textContent = state.counts[system] === undefined ? "—" : String(state.counts[system]);
      label.append(group, number);
      filters.append(label);
    }
  }

  function renderApiStatus(snapshot) {
    if (snapshot.errors.satellite) {
      setStatus(`Satellite calculation library unavailable: ${snapshot.errors.satellite.message}`, "error");
      return;
    }
    const warnings = [];
    for (const source of ["tle", "metadata"]) {
      const cache = snapshot.cache[source];
      const error = snapshot.errors[source];
      const label = source === "tle" ? "TLE" : "PRN mapping";
      if (error) warnings.push(`${label}: ${error.message}`);
      if (cache.status === "stale") warnings.push(`${label} cache is stale.`);
    }
    if (snapshot.errors.storage) warnings.push(`Cache storage: ${snapshot.errors.storage.message}`);
    if (snapshot.loading) {
      setStatus("Loading satellite data and checking cache…");
      return;
    }
    if (snapshot.errors.tle && !snapshot.initialized) {
      setStatus(`Satellite data unavailable: ${snapshot.errors.tle.message}`, "error");
      return;
    }
    if (snapshot.tracked) {
      const cacheSummary = `TLE cache ${snapshot.cache.tle.status}; metadata cache ${snapshot.cache.metadata.status}.`;
      setStatus(`${snapshot.tracked} PRN-identified satellites ready. ${cacheSummary}${warnings.length ? ` ${warnings.join(" ")}` : ""}`, warnings.length ? "warn" : "");
      return;
    }
    setStatus("Satellite data has not been loaded yet.");
  }

  function updateLocation() {
    const latitude = Number(document.getElementById("latitude").value);
    const longitude = Number(document.getElementById("longitude").value);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setStatus("Enter a valid latitude (−90 to 90°) and longitude (−180 to 180°).", "error");
      return;
    }
    state.observer = { latitude, longitude };
    refresh();
  }

  document.getElementById("update-location").addEventListener("click", updateLocation);
  document.getElementById("latitude").addEventListener("keydown", event => { if (event.key === "Enter") updateLocation(); });
  document.getElementById("longitude").addEventListener("keydown", event => { if (event.key === "Enter") updateLocation(); });
  document.getElementById("use-location").addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Geolocation is not available in this browser.", "error");
      return;
    }
    navigator.geolocation.getCurrentPosition(position => {
      document.getElementById("latitude").value = position.coords.latitude.toFixed(4);
      document.getElementById("longitude").value = position.coords.longitude.toFixed(4);
      updateLocation();
    }, error => {
      setStatus(`Could not get your location: ${error.message}`, "error");
    }, { enableHighAccuracy: false, timeout: 10000 });
  });

  GNSSSatelliteAPI.subscribe(renderApiStatus);
  renderFilters();
  drawGrid();
  GNSSSatelliteAPI.initialize().then(() => refresh()).catch(error => {
    console.error("Unable to load GNSS satellite data.", error);
  });
  window.setInterval(refresh, 1000);
})();
