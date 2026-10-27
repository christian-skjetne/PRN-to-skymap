(function (root, factory) {
  const satelliteLibrary = root.satellite || (typeof module === "object" && module.exports ? require("satellite.js") : null);
  const api = factory(satelliteLibrary, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GNSSSatelliteAPI = api;
})(typeof globalThis === "object" ? globalThis : this, function (satellite, root) {
  "use strict";

  const TLE_URL = "https://raw.githubusercontent.com/satvisorcom/satvisor-data/master/celestrak/tle/gnss.tle";
  const METADATA_URL = "https://raw.githubusercontent.com/taroz/GNSS-Radar/master/js/prnmap.js";
  const TLE_CACHE_KEY = "gnss-sky-map:tle:v1";
  const METADATA_CACHE_KEY = "gnss-sky-map:metadata:v2";
  const TLE_CACHE_TTL = 6 * 60 * 60 * 1000;
  const METADATA_CACHE_TTL = 24 * 60 * 60 * 1000;
  const SYSTEM_BY_PREFIX = { G: "GPS", R: "GLONASS", E: "Galileo", C: "BeiDou", J: "QZSS", S: "SBAS", I: "NavIC" };
  const state = {
    initialized: false,
    loading: false,
    lastUpdated: null,
    records: [],
    cache: {
      tle: { status: "empty", savedAt: null, expiresAt: null, source: null },
      metadata: { status: "empty", savedAt: null, expiresAt: null, source: null }
    },
    errors: {
      tle: null,
      metadata: null,
      storage: null,
      satellite: satellite ? null : { message: "satellite.js must be loaded before gnss-api.js.", at: new Date().toISOString() }
    },
    listeners: new Set()
  };
  let loadPromise = null;

  function notify() {
    const snapshot = getStatus();
    for (const listener of state.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error("GNSS status listener failed.", error);
      }
    }
  }

  function getStatus() {
    return {
      initialized: state.initialized,
      loading: state.loading,
      lastUpdated: state.lastUpdated,
      tracked: state.records.length,
      cache: {
        tle: { ...state.cache.tle },
        metadata: { ...state.cache.metadata }
      },
      errors: {
        tle: state.errors.tle ? { ...state.errors.tle } : null,
        metadata: state.errors.metadata ? { ...state.errors.metadata } : null,
        storage: state.errors.storage ? { ...state.errors.storage } : null,
        satellite: state.errors.satellite ? { ...state.errors.satellite } : null
      }
    };
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Status subscriber must be a function.");
    state.listeners.add(listener);
    listener(getStatus());
    return () => state.listeners.delete(listener);
  }

  function readCache(key) {
    try {
      const serialized = root.localStorage.getItem(key);
      if (!serialized) return null;
      const entry = JSON.parse(serialized);
      if (typeof entry.text !== "string" || !entry.text || !Number.isFinite(entry.savedAt)) {
        throw new Error("Cache entry has an invalid shape.");
      }
      return entry;
    } catch (error) {
      state.errors.storage = { message: error.message, at: new Date().toISOString() };
      return null;
    }
  }

  function writeCache(key, text) {
    try {
      root.localStorage.setItem(key, JSON.stringify({ text, savedAt: Date.now() }));
      state.errors.storage = null;
    } catch (error) {
      state.errors.storage = { message: error.message, at: new Date().toISOString() };
    }
  }

  async function loadSource(name, url, key, ttl, force) {
    const cached = readCache(key);
    const now = Date.now();
    if (cached && !force && now - cached.savedAt < ttl) {
      state.cache[name] = {
        status: "fresh",
        savedAt: new Date(cached.savedAt).toISOString(),
        expiresAt: new Date(cached.savedAt + ttl).toISOString(),
        source: "cache"
      };
      state.errors[name] = null;
      return { text: cached.text, stale: false };
    }

    try {
      const response = await root.fetch(url);
      if (!response.ok) throw new Error(`Request returned HTTP ${response.status}.`);
      const text = await response.text();
      if (!text.trim()) throw new Error("Request returned an empty response.");
      writeCache(key, text);
      const savedAt = Date.now();
      state.cache[name] = {
        status: "fresh",
        savedAt: new Date(savedAt).toISOString(),
        expiresAt: new Date(savedAt + ttl).toISOString(),
        source: "network"
      };
      state.errors[name] = null;
      return { text, stale: false };
    } catch (error) {
      state.errors[name] = { message: error.message, at: new Date().toISOString() };
      if (cached) {
        state.cache[name] = {
          status: "stale",
          savedAt: new Date(cached.savedAt).toISOString(),
          expiresAt: new Date(cached.savedAt + ttl).toISOString(),
          source: "cache"
        };
        return { text: cached.text, stale: true };
      }
      state.cache[name] = { status: "empty", savedAt: null, expiresAt: null, source: null };
      return null;
    }
  }

  function parseMetadata(text) {
    const match = /\bconst\s+PRNMAP\s*=\s*(\{[^]*?\})\s*;/.exec(text);
    if (!match) throw new Error("PRNMAP object was not found.");
    const entries = JSON.parse(match[1]);
    const byNorad = new Map();
    for (const [catalogNumber, label] of Object.entries(entries)) {
      const norad = Number(catalogNumber);
      const prnMatch = typeof label === "string" && /^([GRECQJIS])(\d{1,3})$/.exec(label);
      if (!/^\d+$/.test(catalogNumber) || !Number.isSafeInteger(norad) || norad <= 0 || !prnMatch) {
        throw new Error(`Invalid PRN mapping for NORAD ${catalogNumber}.`);
      }
      const prefix = prnMatch[1] === "Q" ? "J" : prnMatch[1];
      const number = Number(prnMatch[2]) - (prnMatch[1] === "Q" ? 192 : 0);
      if (number <= 0) throw new Error(`Invalid PRN label "${label}".`);
      byNorad.set(norad, `${prefix}${String(number).padStart(2, "0")}`);
    }
    if (!byNorad.size) throw new Error("PRNMAP is empty.");
    return byNorad;
  }

  function parseTle(text, metadata) {
    const lines = text.split(/\r?\n/);
    const records = [];
    for (let index = 0; index < lines.length - 2; index += 1) {
      const name = lines[index].trim();
      const line1 = lines[index + 1].trim();
      const line2 = lines[index + 2].trim();
      if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;
      const norad = Number(line1.slice(2, 7));
      if (!Number.isInteger(norad) || line2.slice(2, 7).trim() !== String(norad)) continue;
      const directPrnMatch = /\(([GRECJIS])\s*0*(\d{1,3})\)/i.exec(name);
      const gpsPrnMatch = /^GPS\b.*\bPRN\s*0*(\d{1,2})\b/i.exec(name);
      const qzssPrnMatch = /\bQZSS\/PRN\s*(19[3-9]|20[0-2])\b/i.exec(name);
      const namedPrn = directPrnMatch
        ? `${directPrnMatch[1].toUpperCase()}${directPrnMatch[2].padStart(2, "0")}`
        : gpsPrnMatch
          ? `G${gpsPrnMatch[1].padStart(2, "0")}`
          : qzssPrnMatch
            ? `J${String(Number(qzssPrnMatch[1]) - 192).padStart(2, "0")}`
            : null;
      const prn = metadata.get(norad) || namedPrn;
      if (!prn || !SYSTEM_BY_PREFIX[prn[0]]) continue;
      try {
        records.push({ norad, prn, line1, line2, satrec: satellite.twoline2satrec(line1, line2) });
      } catch (error) {
        console.warn(`Skipping invalid TLE for NORAD ${norad}.`, error);
      }
      index += 2;
    }
    return records;
  }

  function normalizeTime(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (typeof value === "number") return new Date(value);
    if (typeof value === "string" && value.trim()) {
      const normalized = value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
      return new Date(normalized);
    }
    return new Date();
  }

  function normalizePrns(value) {
    if (value === undefined || value === null || value === "" || value === "*") return null;
    const values = Array.isArray(value) ? value : [value];
    if (!values.length) throw new TypeError("PRN must be a PRN string, a non-empty array of PRNs, or omitted.");
    const prns = values.map(item => {
      if (typeof item !== "string" || !/^[GRECJIS]\d{2,3}$/i.test(item.trim())) {
        throw new TypeError(`Invalid PRN "${item}". Use a system-prefixed PRN such as G05 or E12.`);
      }
      return item.trim().toUpperCase();
    });
    return new Set(prns);
  }

  async function initialize(force = false) {
    if (!satellite) {
      const error = new Error(state.errors.satellite.message);
      notify();
      throw error;
    }
    if (loadPromise && !force) return loadPromise;
    if (state.initialized && !force) return getStatus();
    state.loading = true;
    if (force) state.initialized = false;
    notify();

    loadPromise = (async () => {
      const [tleResult, metadataResult] = await Promise.all([
        loadSource("tle", TLE_URL, TLE_CACHE_KEY, TLE_CACHE_TTL, force),
        loadSource("metadata", METADATA_URL, METADATA_CACHE_KEY, METADATA_CACHE_TTL, force)
      ]);
      if (!tleResult) {
        state.records = [];
        state.initialized = false;
        state.errors.tle = state.errors.tle || { message: "TLE feed is unavailable and no cached copy exists.", at: new Date().toISOString() };
        throw new Error(state.errors.tle.message);
      }
      let metadata = new Map();
      if (metadataResult) {
        try {
          metadata = parseMetadata(metadataResult.text);
        } catch (error) {
          state.errors.metadata = { message: `Could not parse PRN mapping: ${error.message}`, at: new Date().toISOString() };
        }
      }
      state.records = parseTle(tleResult.text, metadata);
      if (!state.records.length) {
        state.initialized = false;
        state.errors.tle = { message: "No GNSS satellites with resolvable PRNs were found in the TLE feed.", at: new Date().toISOString() };
        throw new Error(state.errors.tle.message);
      }
      state.initialized = true;
      state.lastUpdated = new Date().toISOString();
      return getStatus();
    })().catch(error => {
      state.errors.tle = state.errors.tle || { message: error.message, at: new Date().toISOString() };
      throw error;
    }).finally(() => {
      state.loading = false;
      loadPromise = null;
      notify();
    });
    return loadPromise;
  }

  async function calculate(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("calculate expects an input object.");
    const prnFilter = normalizePrns(input.PRN ?? input.prn);
    const latitude = Number(input.LAT ?? input.lat);
    const longitude = Number(input.LON ?? input.lon);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new RangeError("LAT must be a number from -90 to 90 degrees.");
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new RangeError("LON must be a number from -180 to 180 degrees.");
    const time = normalizeTime(input["UTC-TIME"] ?? input.utcTime);
    if (!Number.isFinite(time.getTime())) throw new TypeError("UTC-TIME must be a valid Date, ISO timestamp, or Unix timestamp in milliseconds.");

    await initialize();
    const observer = {
      latitude: satellite.degreesToRadians(latitude),
      longitude: satellite.degreesToRadians(longitude),
      height: 0
    };
    const results = [];
    for (const record of state.records) {
      if (prnFilter && !prnFilter.has(record.prn)) continue;
      const positionAndVelocity = satellite.propagate(record.satrec, time);
      if (!positionAndVelocity.position) continue;
      const gmst = satellite.gstime(time);
      const positionEcf = satellite.eciToEcf(positionAndVelocity.position, gmst);
      const look = satellite.ecfToLookAngles(observer, positionEcf);
      const elevation = satellite.radiansToDegrees(look.elevation);
      if (!Number.isFinite(elevation) || !Number.isFinite(look.azimuth)) continue;
      if ((input.aboveHorizonOnly ?? input.ABOVE_HORIZON_ONLY) && elevation < 0) continue;
      results.push({
        PRN: record.prn,
        NORAD_ID: record.norad,
        AZIMUTH: (satellite.radiansToDegrees(look.azimuth) + 360) % 360,
        ELEVATION: elevation
      });
    }
    return results.sort((a, b) => b.ELEVATION - a.ELEVATION);
  }

  return Object.freeze({
    initialize: () => initialize(),
    refresh: () => initialize(true),
    calculate,
    getStatus,
    subscribe
  });
});
