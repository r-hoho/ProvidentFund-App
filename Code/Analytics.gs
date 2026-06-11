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
 * "A user opened the app." Called from doGet(). Answers visits / who / when /
 * returning-vs-new.
 */
function trackAppOpen() {
  trackEvent("app_open", {});
}

/**
 * "A user exercised a feature, with an outcome." Called from the action
 * handlers. Answers success rate / fail rate per feature.
 * @param {string} feature enroll | change_plan | withdraw | beneficiary | cancel
 * @param {string} outcome success | fail
 */
function trackFeatureAction(feature, outcome) {
  trackEvent("feature_action", { feature: feature, outcome: outcome });
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
