export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // =========================
    // 天气 API
    // =========================
    if (url.pathname === "/api/weather") {
      try {
        // 获取访问者的大致地理位置
        const city = request.cf?.city || "Unknown";
        const latitude = request.cf?.latitude;
        const longitude = request.cf?.longitude;

        // 如果 Cloudflare 没有提供定位信息
        if (
          latitude === undefined ||
          longitude === undefined
        ) {
          return new Response(
            JSON.stringify({
              error: "无法获取访问者地理位置"
            }),
            {
              status: 400,
              headers: {
                "Content-Type":
                  "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*"
              }
            }
          );
        }

        // =========================
        // Open-Meteo 天气 API
        // =========================

        const weatherURL =
          "https://api.open-meteo.com/v1/forecast" +
          `?latitude=${encodeURIComponent(latitude)}` +
          `&longitude=${encodeURIComponent(longitude)}` +
          "&current=" +
          "temperature_2m," +
          "relative_humidity_2m," +
          "wind_speed_10m," +
          "pressure_msl," +
          "weather_code" +
          "&timezone=auto";

        const response =
          await fetch(weatherURL);

        // API 请求失败
        if (!response.ok) {
          return new Response(
            JSON.stringify({
              error: "天气 API 请求失败",
              status: response.status
            }),
            {
              status: 502,
              headers: {
                "Content-Type":
                  "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*"
              }
            }
          );
        }

        const weather =
          await response.json();

        // =========================
        // 返回给网页的数据
        // =========================

        return new Response(
          JSON.stringify({
            city: city,

            latitude: latitude,

            longitude: longitude,

            temperature:
              weather.current?.temperature_2m ?? null,

            humidity:
              weather.current?.relative_humidity_2m ?? null,

            wind_speed:
              weather.current?.wind_speed_10m ?? null,

            pressure:
              weather.current?.pressure_msl ?? null,

            weather_code:
              weather.current?.weather_code ?? null,

            updated_at:
              weather.current?.time ?? null
          }),
          {
            status: 200,

            headers: {
              "Content-Type":
                "application/json; charset=utf-8",

              "Access-Control-Allow-Origin": "*",

              "Cache-Control":
                "no-store, no-cache, must-revalidate"
            }
          }
        );
      } catch (error) {
        console.error(
          "Weather API error:",
          error
        );

        return new Response(
          JSON.stringify({
            error: "天气服务发生错误",
            message: error?.message || "Unknown error"
          }),
          {
            status: 500,

            headers: {
              "Content-Type":
                "application/json; charset=utf-8",

              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }
    }


      // =========================
      // IP 信息 API
      // =========================
    if (url.pathname === "/api/ip") {

      const ip =
        request.headers.get("CF-Connecting-IP") ||
        request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
        "Unknown";

      const city =
        request.cf?.city || "Unknown";

      const region =
        request.cf?.region || "Unknown";

      const country =
        request.cf?.country || "Unknown";

      const countryCode =
        request.cf?.regionCode || "Unknown";

      const timezone =
        request.cf?.timezone || "Unknown";

      const latitude =
        request.cf?.latitude ?? null;

      const longitude =
        request.cf?.longitude ?? null;

      const asn =
        request.cf?.asn ?? null;

      const colo =
        request.cf?.colo || "Unknown";

      return new Response(
        JSON.stringify({
            ip: ip,
            city: city,
            region: region,
            country: country,
            country_code: countryCode,
            timezone: timezone,
            latitude: latitude,
            longitude: longitude,
            asn: asn,
            cloudflare_colocation: colo
        }),
        {
            status: 200,

            headers: {
                "Content-Type":
                    "application/json; charset=utf-8",

                "Access-Control-Allow-Origin": "*",

                "Cache-Control":
                    "no-store, no-cache, must-revalidate"
                  }
                }
              );
      } 
    // =========================
    // 普通网页请求
    // =========================

return env.ASSETS.fetch(request);
  }
}
