// ===========================================
// WEB APP SETUP
// ===========================================
function doGet() {
  // GA4 adoption metric: "a user opened the app" (visits / who / when /
  // returning-vs-new). Best-effort — trackAppOpen() never throws, so it can
  // never block page render.
  trackAppOpen();

  // CRITICAL FIX: You MUST use createTemplateFromFile and .evaluate() here
  // If you use createHtmlOutputFromFile, the <?!= ?> tags will break!
  return HtmlService.createTemplateFromFile('Index')
    .evaluate() 
    .setTitle('Provident Fund App')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no'); 
}

// ===========================================
// HTML TEMPLATE INCLUDER
// ===========================================
// CRITICAL FIX: This function MUST exist in your .gs files for the tags to work
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent(); 
}