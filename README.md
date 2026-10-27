# GNSS Sky Map API

The calculation API can be used independently of the sky-map UI. Include satellite.js first, then the API script:

```html
<script src="https://cdn.jsdelivr.net/npm/satellite.js@6.0.1/dist/satellite.min.js"></script>
<script src="./gnss-api.js"></script>
<script>
  async function showGpsSatellite() {
    const positions = await GNSSSatelliteAPI.calculate({
      PRN: "G05",
      LAT: 52.52,
      LON: 13.405,
      "UTC-TIME": new Date().toISOString()
    });
    console.log(positions);
  }
</script>
```

`PRN` is optional: omit it or use `"*"` to calculate every tracked satellite. It can also be an array, such as `["G05", "E12"]`. PRNs use their constellation prefix (`G` GPS, `R` GLONASS, `E` Galileo, `C` BeiDou, `J` QZSS, `S` SBAS, `I` NavIC). `LAT` and `LON` are decimal degrees. `"UTC-TIME"` accepts a `Date`, an ISO timestamp, or Unix time in milliseconds; a timestamp without a time-zone suffix is interpreted as UTC. If omitted, the current time is used.

The result is always an array of `{ PRN, NORAD_ID, AZIMUTH, ELEVATION }` objects. Azimuth and elevation are in degrees. By default the result includes satellites below the horizon (negative elevation); set `aboveHorizonOnly: true` to omit them.

The API downloads TLEs and IGS satellite metadata when needed and caches them in browser `localStorage` (TLEs for 6 hours, metadata for 24 hours). A failed refresh falls back to cached data when available.

```js
const status = GNSSSatelliteAPI.getStatus();
// {
//   initialized, loading, lastUpdated, tracked,
//   cache: { tle, metadata },
//   errors: { tle, metadata, storage, satellite }
// }

const unsubscribe = GNSSSatelliteAPI.subscribe(status => {
  console.log("Cache and feed status:", status);
});

await GNSSSatelliteAPI.refresh(); // Force both data feeds to refresh
unsubscribe();
```

`cache.tle` and `cache.metadata` include a `status` (`empty`, `fresh`, or `stale`), `savedAt`, `expiresAt`, and `source` (`network` or `cache`). Feed, storage, and satellite.js errors are exposed as `{ message, at }` objects or `null`. Metadata is optional when unavailable: the API still uses PRNs present in supported TLE names.

The API is exposed as `window.GNSSSatelliteAPI` when loaded with a browser `<script>` tag. CommonJS consumers can also `require("./gnss-api.js")` when `satellite.js` is installed as a package.
