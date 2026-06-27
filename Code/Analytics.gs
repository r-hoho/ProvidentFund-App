// ==========================================
// GA4 ADOPTION ANALYTICS (server-side Measurement Protocol)
// ==========================================
// Aggregate "is the app being used successfully" metrics for management:
// visits / who / when / returning-vs-new (app_open) and success/fail rate
// per feature (feature_action). Server-side ON PURPOSE: the GAS web app
// renders in a sandboxed googleusercontent.com iframe where GA's third-party
// cookies are often blocked, so client-side gtag.js can't reliably track
// users/sessions/returning. Server-side knows the user and sets a stable
// (hashed) user_id, so returning-vs-new works despite the iframe cookie problem.
//
// PDPA: we send a SHA-256 HASH of the user's email as user_id (pseudonymous),
// never the raw email/Allstars_ID. An optional GA4_USER_ID_SALT makes the hash
// non-reversible by rainbow table; keep any hash→identity mapping internal.
//
// Config lives in Script Properties (Project Settings → Script Properties),
// same mechanism as Letter.gs PF_* IDs — never in source:
//   GA4_MEASUREMENT_ID  e.g. "G-XXXXXXXXXX"
//   GA4_API_SECRET      Measurement Protocol API secret (Admin → Data Streams →
//                       <stream> → Measurement Protocol API secrets)
//   GA4_USER_ID_SALT    (optional) any random string; salts the user_id hash
//
// EVERYTHING here is best-effort and NEVER throws — analytics must not affect
// any user action (mirrors the email/letter failure discipline). If the two
// required properties are unset, every call is a silent no-op, so the app runs
// fine before GA is wired.

/**
 * Reads GA4 config from Script Properties. measurementId/apiSecret empty → the
 * tracker no-ops (analytics simply off until configured).
 */
function getAnalyticsConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    measurementId: props.getProperty("GA4_MEASUREMENT_ID") || "",
    apiSecret:     props.getProperty("GA4_API_SECRET")     || "",
    userIdSalt:    props.getProperty("GA4_USER_ID_SALT")   || ""
  };
}

/**
 * SHA-256(salt + seed) → lowercase hex. Stable for a given email, so GA4 can
 * tell returning from new users without ever receiving the raw identifier.
 */
function hashUserId_(seed) {
  const cfg = getAnalyticsConfig_();
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    (cfg.userIdSalt || "") + seed,
    Utilities.Charset.UTF_8
  );
  return bytes
    .map(function (b) { return ("0" + (b & 0xFF).toString(16)).slice(-2); })
    .join("");
}

/**
 * Hashed id for the active user, or "" if no email is resolvable. Defensive:
 * never throws.
 */
function currentUserHash_() {
  try {
    const email = (Session.getActiveUser().getEmail() || "").trim().toLowerCase();
    return email ? hashUserId_(email) : "";
  } catch (e) {
    return "";
  }
}

/**
 * Parse a browser User-Agent string into LOW-CARDINALITY device buckets so the
 * values are usable as GA4 custom dimensions (never send the raw UA — it's
 * thousands of distinct strings, useless in reports). Returns {} for an empty
 * UA so no device params are attached. Never throws.
 *
 * NOTE: native GA4 device detection is useless in this app — our hits are sent
 * server-side via UrlFetchApp, so GA4 sees Google's datacenter UA/IP, not the
 * user's. These explicit params are the only reliable device signal. Register
 * device_category / device_os / device_browser as custom dimensions in GA4
 * Admin to see them in reports.
 * @param {string} ua  navigator.userAgent forwarded from the client (may carry
 *                      a " | WxH" screen-size suffix, which is ignored here).
 */
function parseDevice_(ua) {
  try {
    if (!ua) return {};
    const s = String(ua);

    // device_category — iPad reports tablet; Android without "Mobile" is tablet
    let category = "desktop";
    if (/iPad|Tablet|(Android(?!.*Mobile))/i.test(s)) category = "tablet";
    else if (/Mobi|iPhone|iPod|Android/i.test(s)) category = "mobile";

    // os
    let os = "Other";
    if (/iPhone|iPad|iPod/i.test(s)) os = "iOS";
    else if (/Android/i.test(s)) os = "Android";
    else if (/Windows/i.test(s)) os = "Windows";
    else if (/Mac OS X|Macintosh/i.test(s)) os = "macOS";
    else if (/Linux/i.test(s)) os = "Linux";

    // browser — order matters (Edge/Opera/Chrome-iOS UAs also contain "Chrome";
    // Chrome's UA also contains "Safari", so Safari must be checked last)
    let browser = "Other";
    if (/Edg\//i.test(s)) browser = "Edge";
    else if (/OPR\/|Opera/i.test(s)) browser = "Opera";
    else if (/SamsungBrowser/i.test(s)) browser = "Samsung";
    else if (/Firefox|FxiOS/i.test(s)) browser = "Firefox";
    else if (/Chrome|CriOS/i.test(s)) browser = "Chrome";
    else if (/Safari/i.test(s)) browser = "Safari";

    return { device_category: category, device_os: os, device_browser: browser };
  } catch (e) {
    return {};
  }
}

/**
 * Low-level: POST one event to the GA4 Measurement Protocol. Best-effort —
 * swallows everything. Adds engagement_time_msec + session_id so the hit
 * registers as an active session in GA4 (a common MP gotcha: without them,
 * server events often don't count toward users/sessions).
 * @param {string} name   GA4 event name (e.g. "app_open", "feature_action").
 * @param {Object} params Extra event params to merge in.
 */
function trackEvent(name, params) {
  try {
    const cfg = getAnalyticsConfig_();
    if (!cfg.measurementId || !cfg.apiSecret) return; // not configured → no-op

    const uid = currentUserHash_();
    const eventParams = Object.assign({
      engagement_time_msec: "100",
      session_id: String(Date.now())
    }, params || {});

    const payload = {
      // GA4 requires client_id; with no reliable browser id (iframe) we reuse
      // the hashed user id so a user's events group to one client.
      client_id: uid || ("anon." + Date.now()),
      events: [{ name: name, params: eventParams }]
    };
    if (uid) payload.user_id = uid; // enables returning-vs-new

    const url = "https://www.google-analytics.com/mp/collect"
      + "?measurement_id=" + encodeURIComponent(cfg.measurementId)
      + "&api_secret=" + encodeURIComponent(cfg.apiSecret);

    UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    // best-effort only — analytics must never affect the app
  }
}

/**
 * "A user opened the app." Called CLIENT-side (from JS.html DOMContentLoaded)
 * rather than doGet() so it can carry device info — doGet() runs server-side and
 * cannot see the browser's User-Agent. Answers visits / who / when /
 * returning-vs-new, now splittable by device.
 * @param {string} deviceData  navigator.userAgent (+ optional " | WxH") from
 *                             the client; parsed into device_* buckets.
 */
function trackAppOpen(deviceData) {
  trackEvent("app_open", parseDevice_(deviceData));
}

/**
 * "A user exercised a feature, with an outcome." Called from the action
 * handlers. Answers success rate / fail rate per feature, splittable by device.
 * @param {string} feature    enroll | change_plan | withdraw | beneficiary | cancel
 * @param {string} outcome    success | fail
 * @param {string} deviceData (optional) navigator.userAgent from the client —
 *                            the handlers already receive it for the audit log,
 *                            so device comes free here. Parsed into device_*
 *                            buckets; omitted (no device params) if absent.
 */
function trackFeatureAction(feature, outcome, deviceData) {
  const params = Object.assign(
    { feature: feature, outcome: outcome },
    parseDevice_(deviceData)
  );
  trackEvent("feature_action", params);
}

/**
 * Editor-run harness. Logs whether config is present, prints your hashed
 * user_id, validates a sample event against GA4's /debug endpoint (which
 * returns validationMessages — the live /collect endpoint is silent), then
 * sends one real feature_action(test, success) you can watch in GA4 Realtime.
 */
function testTrackEvent() {
  const cfg = getAnalyticsConfig_();
  Logger.log("GA4_MEASUREMENT_ID set: " + !!cfg.measurementId);
  Logger.log("GA4_API_SECRET set: " + !!cfg.apiSecret);
  Logger.log("GA4_USER_ID_SALT set: " + !!cfg.userIdSalt);
  Logger.log("Hashed user_id for you: " + currentUserHash_());

  if (!cfg.measurementId || !cfg.apiSecret) {
    Logger.log("→ Config incomplete; trackEvent() is a no-op until both are set.");
    return;
  }

  const uid = currentUserHash_();
  const samplePayload = {
    client_id: uid,
    user_id: uid,
    events: [{
      name: "feature_action",
      params: { feature: "test", outcome: "success", engagement_time_msec: "100", session_id: String(Date.now()) }
    }]
  };
  const debugUrl = "https://www.google-analytics.com/debug/mp/collect"
    + "?measurement_id=" + encodeURIComponent(cfg.measurementId)
    + "&api_secret=" + encodeURIComponent(cfg.apiSecret);
  const res = UrlFetchApp.fetch(debugUrl, {
    method: "post", contentType: "application/json",
    payload: JSON.stringify(samplePayload), muteHttpExceptions: true
  });
  Logger.log("Debug validation response: " + res.getContentText());

  trackFeatureAction("test", "success");
  Logger.log("Sent live feature_action(test, success) — check GA4 Realtime.");
}

/**
 * Editor-run harness for the device dimensions. (1) Unit-checks parseDevice_
 * against representative UA strings and logs the buckets so you can eyeball that
 * category/os/browser are right. (2) Sends ONE real feature_action(test) tagged
 * as a mobile device so you can confirm device_category/device_os/device_browser
 * land in GA4 Realtime/DebugView. Best-effort — no-ops if GA4 isn't configured.
 */
function testDeviceTracking() {
  const samples = {
    "iPhone Safari":   "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Android Chrome":  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "iPad Safari":     "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/604.1",
    "Windows Chrome":  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mac Safari":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Android tablet":  "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "empty":           ""
  };
  Logger.log("=== parseDevice_ unit check ===");
  Object.keys(samples).forEach(function (label) {
    Logger.log(label + " → " + JSON.stringify(parseDevice_(samples[label])));
  });

  const cfg = getAnalyticsConfig_();
  if (!cfg.measurementId || !cfg.apiSecret) {
    Logger.log("→ GA4 not configured; live send skipped.");
    return;
  }
  // Tag the live test event as a phone so you can verify device_* in GA4.
  trackFeatureAction("test", "success", samples["Android Chrome"]);
  Logger.log("Sent live feature_action(test, success) as Android/Chrome/mobile — check GA4 Realtime → click the event → confirm device_category=mobile, device_os=Android, device_browser=Chrome.");
}
