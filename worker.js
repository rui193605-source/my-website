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
// 地点 → 坐标 API
// =========================

if (url.pathname === "/api/geocode") {

  try {

    const query =
      url.searchParams.get("q")?.trim();


    // =========================
    // 检查搜索内容
    // =========================

    if (!query) {

      return jsonResponse(
        {
          query: "",
          count: 0,
          results: [],
          error: "请输入地点名称"
        },
        400
      );

    }


    // =========================
    // Nominatim
    // =========================

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
            "User-Agent":
              "JERRY-SYSTEM-ONLINE/1.0"
          }
        }
      );


    if (!response.ok) {

      return jsonResponse(
        {
          query,
          count: 0,
          results: [],

          error:
            "OpenStreetMap 地理编码请求失败",

          status:
            response.status
        },
        502
      );

    }


    const places =
      await response.json();


    // =========================
    // 没有结果
    // =========================

    if (
      !Array.isArray(places) ||
      places.length === 0
    ) {

      return jsonResponse(
        {
          query,
          count: 0,
          results: []
        },
        200,
        "public, max-age=60"
      );

    }


    // =========================
    // 整理 Nominatim 数据
    //
    // 这一阶段暂时不请求
    // Open-Meteo
    //
    // 后面会统一优化海拔 / 时区
    // =========================

    const results =
      places.map(
        (place) => {

          const latitude =
            Number(place.lat);

          const longitude =
            Number(place.lon);


          return {

            // =================
            // 基本名称
            // =================

            name:
              place.name ??
              null,

            display_name:
              place.display_name ??
              null,


            // =================
            // 坐标
            // =================

            latitude:
              Number.isFinite(latitude)
                ? latitude
                : null,

            longitude:
              Number.isFinite(longitude)
                ? longitude
                : null,


            // =================
            // 类型
            // =================

            type:
              place.type ??
              null,

            category:
              place.category ??
              null,


            // =================
            // OSM 信息
            // =================

            osm_type:
              place.osm_type ??
              null,

            osm_id:
              place.osm_id ??
              null,


            // =================
            // 地址
            // =================

            address:
              place.address ??
              {}

          };

        }
      );


    // =========================
    // 返回
    // =========================

    return jsonResponse(
      {
        query,

        count:
          results.length,

        results
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
        query:
          url.searchParams.get("q") ??
          "",

        count: 0,

        results: [],

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
// 坐标详细信息 API
//
// /api/location?lat=35.6584491&lon=139.745536
//
// 用于：
// 已经选择地点后
// 查询海拔 + 时区
//
// Open-Meteo
// =========================

if (url.pathname === "/api/location") {

  try {

    // =========================
    // 获取坐标
    // =========================

    const lat =
      Number(
        url.searchParams.get("lat")
      );

    const lon =
      Number(
        url.searchParams.get("lon")
      );


    // =========================
    // 坐标验证
    // =========================

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
          error: "无效的经纬度"
        },

        400
      );

    }


    // =========================
    // Open-Meteo
    // =========================

    const geoURL =

      "https://api.open-meteo.com/v1/forecast" +

      `?latitude=${encodeURIComponent(lat)}` +

      `&longitude=${encodeURIComponent(lon)}` +

      "&current=temperature_2m" +

      "&timezone=auto";


    const response =
      await fetch(geoURL);


    // =========================
    // Open-Meteo 请求失败
    // =========================

    if (!response.ok) {

      return jsonResponse(
        {
          error:
            "Open-Meteo 地理信息请求失败",

          status:
            response.status,

          latitude: lat,

          longitude: lon
        },

        502
      );

    }


    const data =
      await response.json();


    // =========================
    // 返回
    // =========================

    return jsonResponse(

      {

        latitude: lat,

        longitude: lon,

        elevation:
          data.elevation ??
          null,

        timezone:
          data.timezone ??
          null

      },

      200,

      "public, max-age=300"

    );


  } catch (error) {

    console.error(
      "Location API error:",
      error
    );


    return jsonResponse(

      {

        error:
          "地理信息查询失败",

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
