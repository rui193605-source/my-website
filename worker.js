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
      try {
        // =========================
        // 获取访问者 IP
        // =========================

      const ip =
        request.headers.get("CF-Connecting-IP") ||
        request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
        "Unknown";


        // =========================
        // Cloudflare 地理 / 网络信息
        // =========================

        const cf = request.cf || {};


        const data = {
          // IP 地址
          ip: ip,

          // 国家
          country:
            cf.country || "Unknown",

          // 城市
          city:
            cf.city || "Unknown",

          // 地区
          region:
            cf.region || "Unknown",

          // 国家 / 地区代码
          region_code:
            cf.regionCode || "Unknown",

          // 时区
          timezone:
            cf.timezone || "Unknown",

          // 经纬度
          latitude:
            cf.latitude ?? null,

          longitude:
            cf.longitude ?? null,

          // ASN
          asn:
            cf.asn ?? null,

          // 网络组织
          organization:
            cf.asOrganization || "Unknown",

          // Cloudflare 数据中心
          colo:
            cf.colo || "Unknown",

          // HTTP 协议
          http_protocol:
            cf.httpProtocol || "Unknown",

          // TLS 版本
          tls_version:
            cf.tlsVersion || "Unknown",

          // 请求方法
          method:
            request.method
        };


        // =========================
        // 返回 JSON
        // =========================

        return new Response(
          JSON.stringify(data),
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
          "IP API error:",
          error
        );

        return new Response(
          JSON.stringify({
            error: "IP 信息获取失败",

            message:
              error?.message ||
              "Unknown error"
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
    // 普通网页请求
    // =========================

    return env.ASSETS.fetch(request);
  }
};
