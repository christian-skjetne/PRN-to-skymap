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

The API downloads TLEs and the [GNSS-Radar PRN mapping](https://github.com/taroz/GNSS-Radar/blob/master/js/prnmap.js) when needed and caches them in browser `localStorage` (TLEs for 6 hours, metadata for 24 hours). Both feeds use CORS-enabled raw GitHub URLs so they can be fetched from a `file://` page in Chrome. The mapping is generated upstream from IGS satellite metadata; its freshness depends on upstream updates. It is parsed as data, not executed as JavaScript. Labels are normalized to the API format (`G5` becomes `G05`, and QZSS `Q193` becomes `J01`). A failed refresh falls back to cached data when available.

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

`cache.tle` and `cache.metadata` include a `status` (`empty`, `fresh`, or `stale`), `savedAt`, `expiresAt`, and `source` (`network` or `cache`). Feed, storage, and satellite.js errors are exposed as `{ message, at }` objects or `null`. Current mapping assignments take precedence over TLE names: a TLE-name fallback cannot reuse a PRN assigned to another NORAD in the mapping, even if that current satellite's TLE is missing. Metadata is optional when unavailable: the API still uses PRNs present in supported TLE names, but cannot verify that those assignments are current without the mapping.

The API is exposed as `window.GNSSSatelliteAPI` when loaded with a browser `<script>` tag. CommonJS consumers can also `require("./gnss-api.js")` when `satellite.js` is installed as a package.
