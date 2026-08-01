// ===========================================
// WEB APP SETUP
// ===========================================
function doGet() {
  // Check if system is in maintenance mode
  var isMaintenanceActive = PropertiesService.getScriptProperties().getProperty('MAINTENANCE_MODE') === 'true';
  if (isMaintenanceActive) {
    var userEmail = Session.getActiveUser().getEmail().toLowerCase();
    var isAdmin = ADMIN_EMAILS.indexOf(userEmail) !== -1;
    
    // Non-admins see the maintenance page; admins bypass to test/access
    if (!isAdmin) {
      return HtmlService.createTemplateFromFile('html/Maintenance')
        .evaluate()
        .setTitle('Provident Fund App - Under Maintenance')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no');
    }
  }

  // GA4 "app_open" is fired CLIENT-side (JS.html DOMContentLoaded → trackAppOpen)
  // so it can carry device info — doGet() can't see the browser's User-Agent.
  // Do NOT also call trackAppOpen() here, or every visit would double-count.

  // CRITICAL FIX: You MUST use createTemplateFromFile and .evaluate() here
  // If you use createHtmlOutputFromFile, the <?!= ?> tags will break!
  var template = HtmlService.createTemplateFromFile('html/Index');
  template.maintenanceActive = isMaintenanceActive;
  return template.evaluate()
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