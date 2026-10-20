import { handleEchowallApi } from "./Project_2/Echowall_v2/echowall_api.js";
import { handleEchowallAdminApi } from "./Project_2/Echowall_v2/echowall_admin_api.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ==============================
    // CORS 预检
    // 放在最前面：否则 OPTIONS 请求会先落入下面的 API 分支
    // ==============================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
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

    // ==============================
    // PING
    // GET /api/speed/ping
    // ==============================
    if (
      url.pathname === "/api/speed/ping" &&
      request.method === "GET"
    ) {
      return new Response("pong", {
        status: 200,
        headers: {
          ...corsHeaders(),
          "Content-Type": "text/plain",
          "Cache-Control": "no-store, no-cache, must-revalidate"
        }
      });
    }

    // ==============================
    // DOWNLOAD
    // GET /api/speed/download
    // ==============================
    if (
      url.pathname === "/api/speed/download" &&
      request.method === "GET"
    ) {
      return createDownloadResponse();
    }

    // ==============================
    // UPLOAD
    // POST /api/speed/upload
    // ==============================
    if (
      url.pathname === "/api/speed/upload" &&
      request.method === "POST"
    ) {
      return await handleUpload(request);
    }

    // ==============================
    // Echowall 旧链接兼容
    // ==============================
    if (url.pathname === "/Project_2/Echowall.html") {
      return Response.redirect(`${url.origin}/Project_2/Echowall_v2/Echowall_v2.html`, 302);
    }

    // ==============================
    // Echowall 评论 / 管理 API
    // ==============================
    if (url.pathname === "/api/echowall" || url.pathname.startsWith("/api/echowall/")) {
      // 管理 API 先处理；非 /admin 路径返回 null，再交给公开 API。
      const adminResponse = await handleEchowallAdminApi(request, env);
      if (adminResponse) return adminResponse;
      return await handleEchowallApi(request, env);
    }

    // ==============================
    // 404
    // ==============================
    return new Response("Not Found", {
      status: 404,
      headers: {
        ...corsHeaders(),
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }
};


// ============================================================
// DOWNLOAD TEST
// ============================================================

/**
 * 构建下载测速响应
 *
 * 关键点：用 pull() 提供数据，而不是在微任务里死循环 enqueue。
 *  - pull() 只在响应流需要数据时触发，天然形成背压，内存占用恒定；
 *  - 旧写法（queueMicrotask 循环）无视背压，数据会全部堆在内存里，
 *    高带宽下容易撞上 Worker 的内存上限。
 */
function createDownloadResponse() {

  // 256 KB 固定数据块
  // 不使用 crypto.getRandomValues()
  // 避免 CPU 成为测速瓶颈
  const CHUNK_SIZE = 256 * 1024;

  const chunk = new Uint8Array(CHUNK_SIZE);

  // 填充固定二进制数据
  for (let i = 0; i < CHUNK_SIZE; i++) {
    chunk[i] = i & 0xff;
  }

  // 单连接最长持续时间，避免连接泄漏
  const MAX_DURATION = 20000;

  let closed = false;
  let controllerRef = null;
  let timerId = null;

  const stream = new ReadableStream({

    start(controller) {
      controllerRef = controller;
    },

    // 下游消费掉一块后会继续索要，形成稳定的持续输出
    pull(controller) {

      if (closed) return;

      try {
        controller.enqueue(chunk);

      } catch (error) {
        closed = true;
      }
    },

    cancel() {
      // 浏览器主动 abort 时触发，顺手清掉计时器
      closed = true;

      if (timerId) clearTimeout(timerId);
    }
  });

  // 安全限制：单连接最多持续 MAX_DURATION
  timerId = setTimeout(() => {

    timerId = null;

    if (closed) return;

    closed = true;

    try {
      if (controllerRef) controllerRef.close();
    } catch (error) {}

  }, MAX_DURATION);

  return new Response(stream, {

    status: 200,

    headers: {

      ...corsHeaders(),

      "Content-Type":
        "application/octet-stream",

      "Cache-Control":
        "no-store, no-cache, must-revalidate",

      "Pragma":
        "no-cache",

      "Expires":
        "0",

      // 注意：不要再设置 Content-Encoding。
      // 这里的 body 并没有真的编码，声明 identity 只会给中间层
      // 和浏览器带来解析风险；application/octet-stream
      // 本身也不会被 Cloudflare 压缩。

      "X-Speed-Test":
        "download"
    }
  });
}


// ============================================================
// UPLOAD TEST
// ============================================================

/**
 * 读取并丢弃上传数据，返回实际接收到的字节数
 */
async function handleUpload(request) {

  const headers = {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache"
  };

  // 没有 body
  if (!request.body) {

    return new Response(

      JSON.stringify({
        success: false,
        bytes: 0
      }),

      { status: 400, headers }
    );
  }

  let totalBytes = 0;

  try {

    // request.body 是 ReadableStream，可以直接异步迭代：
    // 比手动 getReader() 更简洁，流结束时循环自动退出
    for await (const chunk of request.body) {
      totalBytes += chunk.byteLength;
    }

  } catch (error) {

    // 浏览器测速结束时会用 AbortController 主动断开，
    // 这里进入 catch 属于正常情况，已收到的字节数依然有效。

  }

  return new Response(

    JSON.stringify({
      success: true,
      bytes: totalBytes
    }),

    { status: 200, headers }
  );
}


// ============================================================
// 通用 JSON Response
// ============================================================

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


// ============================================================
// CORS
// ============================================================

function corsHeaders() {

  return {

    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "GET, POST, PATCH, DELETE, OPTIONS",

    "Access-Control-Allow-Headers":
      "*",

    "Access-Control-Expose-Headers":
      "*",

    // 预检结果缓存一天：避免每次跨域测速都多一次 OPTIONS 往返
    "Access-Control-Max-Age":
      "86400"
  };
}
