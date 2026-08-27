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
      if (!latitude || !longitude) {
        return new Response(
          JSON.stringify({
            error: "无法获取访问者地理位置"
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json; charset=utf-8"
            }
          }
        );
      }

      // Open-Meteo 天气 API
      const weatherURL =
        "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${latitude}` +
        `&longitude=${longitude}` +
        "&current=temperature_2m,relative_humidity_2m,wind_speed_10m" +
        "&timezone=auto";

      const response = await fetch(weatherURL);

      // API 请求失败
      if (!response.ok) {
        return new Response(
          JSON.stringify({
            error: "天气 API 请求失败"
          }),
          {
            status: 502,
            headers: {
              "Content-Type": "application/json; charset=utf-8"
            }
          }
        );
      }

      const weather = await response.json();

      // 返回给网页的数据
      return new Response(
        JSON.stringify({
          city: city,
          latitude: latitude,
          longitude: longitude,
          temperature: weather.current?.temperature_2m,
          humidity: weather.current?.relative_humidity_2m,
          wind_speed: weather.current?.wind_speed_10m
        }),
        {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    // =========================
    // 普通网页请求
    // =========================
    return env.ASSETS.fetch(request);
  }
};

