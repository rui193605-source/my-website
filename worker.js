export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // =========================// 天气 API// =========================
    if (url.pathname === "/api/weather") {
      try {
        const city = request.cf?.city || "Unknown";
        const latitude = request.cf?.latitude;
        const longitude = request.cf?.longitude;

        if (latitude === undefined || longitude === undefined) {
          return new Response(
            JSON.stringify({
              error: "无法获取访问者地理位置"
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*"
              }
            }
          );
        }

        const weatherURL =
          "https://api.open-meteo.com/v1/forecast" +
          `?latitude=${encodeURIComponent(latitude)}` +
          `&longitude=${encodeURIComponent(longitude)}` +
          "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,pressure_msl,weather_code" +
          "&timezone=auto";

        const response = await fetch(weatherURL);

        if (!response.ok) {
          return new Response(
            JSON.stringify({
              error: "天气 API 请求失败",
              status: response.status
            }),
            {
              status: 502,
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*"
              }
            }
          );
        }

        const weather = await response.json();

        return new Response(
          JSON.stringify({
            city,
            latitude,
            longitude,
            temperature: weather.current?.temperature_2m ?? null,
            humidity: weather.current?.relative_humidity_2m ?? null,
            wind_speed: weather.current?.wind_speed_10m ?? null,
            pressure: weather.current?.pressure_msl ?? null,
            weather_code: weather.current?.weather_code ?? null,
            updated_at: weather.current?.time ?? null
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-store, no-cache, must-revalidate"
            }
          }
        );
      } catch (error) {
        console.error("Weather API error:", error);

        return new Response(
          JSON.stringify({
            error: "天气服务发生错误",
            message: error?.message || "Unknown error"
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }
    }

    // =========================// IP 信息 API// =========================
    if (url.pathname === "/api/ip") {
      const ip =
        request.headers.get("CF-Connecting-IP") ||
        request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
        "Unknown";

      const city = request.cf?.city || "Unknown";
      const region = request.cf?.region || "Unknown";
      const country = request.cf?.country || "Unknown";
      const countryCode = request.cf?.regionCode || "Unknown";
      const timezone = request.cf?.timezone || "Unknown";
      const latitude = request.cf?.latitude ?? null;
      const longitude = request.cf?.longitude ?? null;
      const asn = request.cf?.asn ?? null;
      const colo = request.cf?.colo || "Unknown";

      return new Response(
        JSON.stringify({
          ip,
          city,
          region,
          country,
          country_code: countryCode,
          timezone,
          latitude,
          longitude,
          asn,
          cloudflare_colocation: colo
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store, no-cache, must-revalidate"
          }
        }
      );
    }

    // =========================// ADS-B API// =========================
  if (url.pathname === "/api/adsb") {
    try {
      const adsbUrl =
        "https://opendata.adsb.fi/api/v3/lat/35.6895/lon/139.6917/dist/25";

      const response = await fetch(adsbUrl);

      const data = await response.text();

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: "ADS-B 请求失败",
          status: response.status,
          statusText: response.statusText,
          response: data
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {

    return new Response(
      JSON.stringify({
        error: "Worker 请求 ADS-B 时发生异常",
        message: error?.message || "Unknown error"
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        }
        }
      );
    }
  }

    // =========================// 普通网页请求// =========================
    return env.ASSETS.fetch(request);
  }
};
