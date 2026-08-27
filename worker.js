export default {
  async fetch(request, env, ctx) {

    const url = new URL(request.url);

    // 只有访问 /api/weather 时才执行天气 API
    if (url.pathname === "/api/weather") {

      // 获取 Cloudflare 判断出来的访问者位置
      const city = request.cf?.city || "Unknown";
      const latitude = request.cf?.latitude;
      const longitude = request.cf?.longitude;

      // 如果没有定位信息
      if (!latitude || !longitude) {
        return new Response(
          JSON.stringify({
            error: "无法获取你的地理位置"
          }),
          {
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      // 请求 Open-Meteo
      const weatherURL =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${latitude}` +
        `&longitude=${longitude}` +
        `&current=temperature_2m,relative_humidity_2m,wind_speed_10m` +
        `&timezone=auto`;

      const response = await fetch(weatherURL);

      const weather = await response.json();

      // 返回我们自己的 JSON
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
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    // 其他地址
    // 其他地址交给 Cloudflare 静态资源处理
return env.ASSETS.fetch(request);

