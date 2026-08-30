export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // =========================
    // 通用 JSON Response
    // =========================
    function jsonResponse(data, status = 200, cache = "no-store") {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": cache
        }
      });
    }

    // =========================
    // 天气 API
    // =========================
    if (url.pathname === "/api/weather") {
      try {
        const city = request.cf?.city || "Unknown";
        const latitude = request.cf?.latitude;
        const longitude = request.cf?.longitude;

        if (latitude === undefined || longitude === undefined) {
          return jsonResponse({
            error: "无法获取访问者地理位置"
          }, 400);
        }

        const weatherURL =
          "https://api.open-meteo.com/v1/forecast" +
          `?latitude=${encodeURIComponent(latitude)}` +
          `&longitude=${encodeURIComponent(longitude)}` +
          "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,pressure_msl,weather_code" +
          "&timezone=auto";

        const response = await fetch(weatherURL);

        if (!response.ok) {
          return jsonResponse({
            error: "天气 API 请求失败",
            status: response.status
          }, 502);
        }

        const weather = await response.json();

        return jsonResponse({
          city,
          latitude,
          longitude,
          temperature: weather.current?.temperature_2m ?? null,
          humidity: weather.current?.relative_humidity_2m ?? null,
          wind_speed: weather.current?.wind_speed_10m ?? null,
          pressure: weather.current?.pressure_msl ?? null,
          weather_code: weather.current?.weather_code ?? null,
          updated_at: weather.current?.time ?? null
        });

      } catch (error) {
        console.error("Weather API error:", error);

        return jsonResponse({
          error: "天气服务发生错误",
          message: error?.message || "Unknown error"
        }, 500);
      }
    }

    // =========================
    // 地点 → 坐标
    // /api/geocode?q=Tokyo Tower
    // =========================
    if (url.pathname === "/api/geocode") {
      try {
        const query = url.searchParams.get("q")?.trim();

        if (!query) {
          return jsonResponse({
            error: "请输入地点名称"
          }, 400);
        }

        const nominatimURL =
          "https://nominatim.openstreetmap.org/search" +
          `?q=${encodeURIComponent(query)}` +
          "&format=jsonv2" +
          "&addressdetails=1" +
          "&limit=5" +
          "&accept-language=zh,en";

        const response = await fetch(nominatimURL, {
          headers: {
            "User-Agent": "JERRY-SYSTEM-ONLINE/1.0"
          }
        });

        if (!response.ok) {
          return jsonResponse({
            error: "OpenStreetMap 地理编码请求失败",
            status: response.status
          }, 502);
        }

        const results = await response.json();

        if (!Array.isArray(results) || results.length === 0) {
          return jsonResponse({
            query,
            results: []
          });
        }

        // 查询每一个结果的海拔和时区
        const detailedResults = await Promise.all(
          results.map(async (place) => {
            const latitude = Number(place.lat);
            const longitude = Number(place.lon);

            let elevation = null;
            let timezone = null;

            try {
              const elevationURL =
                "https://api.open-meteo.com/v1/forecast" +
                `?latitude=${latitude}` +
                `&longitude=${longitude}` +
                "&current=temperature_2m" +
                "&elevation=nan" +
                "&timezone=auto";

              const elevationResponse = await fetch(elevationURL);

              if (elevationResponse.ok) {
                const elevationData = await elevationResponse.json();

                elevation = elevationData.elevation ?? null;
                timezone = elevationData.timezone ?? null;
              }
            } catch (e) {
              console.error("Elevation/Timezone error:", e);
            }

            return {
              name: place.name || null,
              display_name: place.display_name || null,
              latitude,
              longitude,
              elevation,
              timezone,
              type: place.type || null,
              category: place.category || null,
              address: place.address || {}
            };
          })
        );

        return jsonResponse({
          query,
          results: detailedResults
        }, 200, "public, max-age=300");

      } catch (error) {
        console.error("Geocode API error:", error);

        return jsonResponse({
          error: "地点查询失败",
          message: error?.message || "Unknown error"
        }, 500);
      }
    }

    // =========================
    // 坐标 → 地点
    // /api/reverse?lat=35.658581&lon=139.745438
    // =========================
    if (url.pathname === "/api/reverse") {
      try {
        const lat = Number(url.searchParams.get("lat"));
        const lon = Number(url.searchParams.get("lon"));

        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          lat < -90 ||
          lat > 90 ||
          lon < -180 ||
          lon > 180
        ) {
          return jsonResponse({
            error: "无效的经纬度"
          }, 400);
        }

        const nominatimURL =
          "https://nominatim.openstreetmap.org/reverse" +
          `?lat=${encodeURIComponent(lat)}` +
          `&lon=${encodeURIComponent(lon)}` +
          "&format=jsonv2" +
          "&addressdetails=1" +
          "&zoom=18" +
          "&accept-language=zh,en";

        const response = await fetch(nominatimURL, {
          headers: {
            "User-Agent": "JERRY-SYSTEM-ONLINE/1.0"
          }
        });

        if (!response.ok) {
          return jsonResponse({
            error: "OpenStreetMap 反向地理编码请求失败",
            status: response.status
          }, 502);
        }

        const place = await response.json();

        // Open-Meteo 获取海拔 + 时区
        let elevation = null;
        let timezone = null;

        try {
          const elevationURL =
            "https://api.open-meteo.com/v1/forecast" +
            `?latitude=${lat}` +
            `&longitude=${lon}` +
            "&current=temperature_2m" +
            "&elevation=nan" +
            "&timezone=auto";

          const elevationResponse = await fetch(elevationURL);

          if (elevationResponse.ok) {
            const elevationData = await elevationResponse.json();

            elevation = elevationData.elevation ?? null;
            timezone = elevationData.timezone ?? null;
          }
        } catch (e) {
          console.error("Elevation/Timezone error:", e);
        }

        return jsonResponse({
          latitude: lat,
          longitude: lon,
          name: place.name || null,
          display_name: place.display_name || null,
          type: place.type || null,
          category: place.category || null,
          elevation,
          timezone,
          address: place.address || {}
        }, 200, "public, max-age=300");

      } catch (error) {
        console.error("Reverse geocode API error:", error);

        return jsonResponse({
          error: "坐标解析失败",
          message: error?.message || "Unknown error"
        }, 500);
      }
    }

    // =========================
    // 普通网页请求
    // =========================
    return env.ASSETS.fetch(request);
  }
};
