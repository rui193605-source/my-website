export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

  
    // 通用 JSON Response
  

    function jsonResponse(
      data,
      status = 200,
      cache = "no-store"
    ) {
      return new Response(
        JSON.stringify(data),
        {
          status,
          headers: {
            "Content-Type":
              "application/json; charset=utf-8",

            "Access-Control-Allow-Origin":
              "*",

            "Cache-Control":
              cache
          }
        }
      );
    }



    // 1. 天气 API


    if (url.pathname === "/api/weather") {

      try {

        const city =
          request.cf?.city ||
          "Unknown";

        const latitude =
          request.cf?.latitude;

        const longitude =
          request.cf?.longitude;


        if (
          latitude === undefined ||
          longitude === undefined
        ) {

          return jsonResponse(
            {
              error:
                "无法获取访问者地理位置"
            },
            400
          );

        }


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


        if (!response.ok) {

          return jsonResponse(
            {
              error:
                "天气 API 请求失败",

              status:
                response.status
            },
            502
          );

        }


        const weather =
          await response.json();


        return jsonResponse(
          {
            city,

            latitude,

            longitude,

            temperature:
              weather.current
                ?.temperature_2m ??
              null,

            humidity:
              weather.current
                ?.relative_humidity_2m ??
              null,

            wind_speed:
              weather.current
                ?.wind_speed_10m ??
              null,

            pressure:
              weather.current
                ?.pressure_msl ??
              null,

            weather_code:
              weather.current
                ?.weather_code ??
              null,

            updated_at:
              weather.current
                ?.time ??
              null
          },

          200,

          "no-store"
        );


      } catch (error) {

        console.error(
          "Weather API error:",
          error
        );


        return jsonResponse(
          {
            error:
              "天气服务发生错误",

            message:
              error?.message ||
              "Unknown error"
          },

          500
        );

      }

    }

// =========================
// IP / 访问者信息 API
// =========================

if (url.pathname === "/api/ip") {

  try {

    const cf = request.cf || {};

    // =========================
    // 当前访问者 IP
    // =========================

    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Real-IP") ||
      "Unknown";


    // =========================
    // Cloudflare GeoIP
    // =========================

    const city =
      cf.city ??
      "Unknown";

    const region =
      cf.region ??
      "Unknown";

    const country =
      cf.country ??
      "Unknown";

    const timezone =
      cf.timezone ??
      "Unknown";

    const latitude =
      cf.latitude ??
      null;

    const longitude =
      cf.longitude ??
      null;


    // =========================
    // ASN
    // =========================

    const asn =
      cf.asn ??
      null;


    // =========================
    // Cloudflare Edge
    //
    // colo = 当前请求进入的
    // Cloudflare 数据中心代码
    //
    // 例如：
    // NRT = Tokyo
    // KIX = Osaka
    // HND = Tokyo Haneda
    // =========================

    const cloudflare_colocation =
      cf.colo ??
      "Unknown";


    // =========================
    // 返回数据
    //
    // 字段名称严格匹配 ip.html
    // =========================

    return jsonResponse({

      ip,

      city,

      region,

      country,

      timezone,

      latitude,

      longitude,

      asn,

      cloudflare_colocation

    }, 200, "no-store");


  } catch (error) {

    console.error(
      "IP API error:",
      error
    );


    return jsonResponse({

      error:
        "无法获取访问者信息",

      message:
        error?.message ||
        "Unknown error"

    }, 500);

  }

}



    // =========================
    // 3. 地点 → 坐标
    //
    // /api/geocode?q=Tokyo Tower
    //
    // Nominatim / OpenStreetMap
    // +
    // Open-Meteo 海拔 / 时区
    // =========================

    if (url.pathname === "/api/geocode") {

      try {

        const query =
          url.searchParams
            .get("q")
            ?.trim();


        if (!query) {

          return jsonResponse(
            {
              error:
                "请输入地点名称"
            },

            400
          );

        }


        // =================
        // Nominatim
        // =================

        const nominatimURL =

          "https://nominatim.openstreetmap.org/search" +

          `?q=${encodeURIComponent(query)}` +

          "&format=jsonv2" +

          "&addressdetails=1" +

          "&limit=5" +

          "&accept-language=zh,en";


        const response =
          await fetch(
            nominatimURL,
            {
              headers: {

                // Nominatim 要求识别客户端
                "User-Agent":
                  "JERRY-SYSTEM-ONLINE/1.0"

              }
            }
          );


        if (!response.ok) {

          return jsonResponse(
            {
              error:
                "OpenStreetMap 地理编码请求失败",

              status:
                response.status
            },

            502
          );

        }


        const results =
          await response.json();


        if (
          !Array.isArray(results) ||
          results.length === 0
        ) {

          return jsonResponse(
            {
              query,

              results: []
            }
          );

        }


        // =================
        // 获取海拔 + 时区
        // =================

        const detailedResults =
          await Promise.all(

            results.map(
              async (place) => {

                const latitude =
                  Number(place.lat);

                const longitude =
                  Number(place.lon);


                let elevation =
                  null;

                let timezone =
                  null;


                try {

                  const geoURL =

                    "https://api.open-meteo.com/v1/forecast" +

                    `?latitude=${latitude}` +

                    `&longitude=${longitude}` +

                    "&current=temperature_2m" +

                    "&timezone=auto";


                  const geoResponse =
                    await fetch(
                      geoURL
                    );


                  if (
                    geoResponse.ok
                  ) {

                    const geoData =
                      await geoResponse.json();


                    elevation =
                      geoData.elevation ??
                      null;


                    timezone =
                      geoData.timezone ??
                      null;

                  }


                } catch (error) {

                  console.error(
                    "Elevation / timezone error:",
                    error
                  );

                }


                return {

                  name:
                    place.name ??
                    null,

                  display_name:
                    place.display_name ??
                    null,

                  latitude,

                  longitude,

                  elevation,

                  timezone,

                  type:
                    place.type ??
                    null,

                  category:
                    place.category ??
                    null,

                  address:
                    place.address ??
                    {}

                };

              }
            )

          );


        return jsonResponse(
          {
            query,

            results:
              detailedResults

          },

          200,

          // 缓存 5 分钟
          "public, max-age=300"
        );


      } catch (error) {

        console.error(
          "Geocode API error:",
          error
        );


        return jsonResponse(
          {
            error:
              "地点查询失败",

            message:
              error?.message ||
              "Unknown error"
          },

          500
        );

      }

    }


    // =========================
    // 4. 坐标 → 地点
    //
    // /api/reverse?lat=35.6584491&lon=139.745536
    //
    // Nominatim / OpenStreetMap
    // +
    // Open-Meteo 海拔 / 时区
    // =========================

    if (url.pathname === "/api/reverse") {

      try {

        const lat =
          Number(
            url.searchParams.get(
              "lat"
            )
          );


        const lon =
          Number(
            url.searchParams.get(
              "lon"
            )
          );


        // =================
        // 检查坐标
        // =================

        if (

          !Number.isFinite(lat) ||

          !Number.isFinite(lon) ||

          lat < -90 ||

          lat > 90 ||

          lon < -180 ||

          lon > 180

        ) {

          return jsonResponse(
            {
              error:
                "无效的经纬度"
            },

            400
          );

        }


        // =================
        // Nominatim Reverse
        // =================

        const nominatimURL =

          "https://nominatim.openstreetmap.org/reverse" +

          `?lat=${encodeURIComponent(lat)}` +

          `&lon=${encodeURIComponent(lon)}` +

          "&format=jsonv2" +

          "&addressdetails=1" +

          "&zoom=18" +

          "&accept-language=zh,en";


        const response =
          await fetch(
            nominatimURL,
            {
              headers: {

                "User-Agent":
                  "JERRY-SYSTEM-ONLINE/1.0"

              }
            }
          );


        if (!response.ok) {

          return jsonResponse(
            {
              error:
                "OpenStreetMap 反向地理编码请求失败",

              status:
                response.status
            },

            502
          );

        }


        const place =
          await response.json();


        // =================
        // Open-Meteo
        // 海拔 + 时区
        // =================

        let elevation =
          null;

        let timezone =
          null;


        try {

          const geoURL =

            "https://api.open-meteo.com/v1/forecast" +

            `?latitude=${lat}` +

            `&longitude=${lon}` +

            "&current=temperature_2m" +

            "&timezone=auto";


          const geoResponse =
            await fetch(
              geoURL
            );


          if (
            geoResponse.ok
          ) {

            const geoData =
              await geoResponse.json();


            elevation =
              geoData.elevation ??
              null;


            timezone =
              geoData.timezone ??
              null;

          }

        } catch (error) {

          console.error(
            "Elevation / timezone error:",
            error
          );

        }


        return jsonResponse(
          {

            latitude: lat,

            longitude: lon,

            name:
              place.name ??
              null,

            display_name:
              place.display_name ??
              null,

            type:
              place.type ??
              null,

            category:
              place.category ??
              null,

            elevation,

            timezone,

            address:
              place.address ??
              {}

          },

          200,

          "public, max-age=300"
        );


      } catch (error) {

        console.error(
          "Reverse geocode API error:",
          error
        );


        return jsonResponse(
          {
            error:
              "坐标解析失败",

            message:
              error?.message ||
              "Unknown error"
          },

          500
        );

      }

    }


    // =========================
    // 普通网页请求
    // =========================

    return env.ASSETS.fetch(
      request
    );

  }
};
