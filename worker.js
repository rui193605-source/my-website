export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // =========================
    // 天气 API
    // =========================
    if (url.pathname === "/api/weather") {

      // 获取访问者的大致地理位置
      const city = request.cf?.city || "Unknown";
      const latitude = request.cf?.latitude;
      const longitude = request.cf?.longitude;

      // 如果 Cloudflare 没有提供定位信息
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

      // =========================
      // Open-Meteo 天气 API
      // =========================

      const weatherURL =
        "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${latitude}` +
        `&longitude=${longitude}` +
        "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,pressure_msl,weather_code" +
        "&timezone=auto";

      try {

        const response =
          await fetch(weatherURL);

        // API 请求失败
        if (!response.ok) {

          return new Response(
            JSON.stringify({
              error: "天气 API 请求失败"
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
        // 当前天气数据
        // =========================

        const current =
          weather.current;


        // =========================
        // 返回给网页的数据
        // =========================

        return new Response(

          JSON.stringify({

            // 城市
            city: city,

            // Cloudflare 定位
            latitude: latitude,
            longitude: longitude,

            // 温度
            temperature:
              current?.temperature_2m ?? null,

            // 湿度
            humidity:
              current?.relative_humidity_2m ?? null,

            // 风速
            wind_speed:
              current?.wind_speed_10m ?? null,

            // 气压
            surface_pressure:
              current?.pressure_msl ?? null,

            // WMO 天气代码
            weather_code:
              current?.weather_code ?? null,

            // Open-Meteo 更新时间
            updated_at:
              current?.time ?? null

          }),

          {

            headers: {

              "Content-Type":
                "application/json; charset=utf-8",

              "Access-Control-Allow-Origin":
                "*",

              "Cache-Control":
                "no-store"

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
            error: "天气服务暂时不可用"
          }),

          {

            status: 502,

            headers: {

              "Content-Type":
                "application/json; charset=utf-8",

              "Access-Control-Allow-Origin":
                "*"

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
