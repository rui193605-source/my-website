const ADSB_URL =
    "https://opendata.adsb.fi/api/v3/lat/35.6895/lon/139.6917/dist/25";


async function fetchAircraft() {
    try {
        const response = await fetch(ADSB_URL);

        if (!response.ok) {
            throw new Error(`ADS-B HTTP ${response.status}`);
        }

        const data = await response.json();

        const aircraft = (data.ac || [])
            .filter(plane =>
                plane.lat != null &&
                plane.lon != null
            )
            .map(plane => ({
                icao: plane.hex || null,
                callsign: plane.flight?.trim() || "UNKNOWN",
                registration: plane.r || null,

                type: plane.t || null,
                description: plane.desc || null,

                lat: plane.lat,
                lon: plane.lon,

                altitude: plane.alt_baro ?? null,
                speed: plane.gs ?? null,
                heading: plane.track ?? null
            }));

        console.log("ADS-B aircraft:", aircraft);

        return aircraft;

    } catch (error) {
        console.error("ADS-B Error:", error);
        return [];
    }
}
fetchAircraft();
