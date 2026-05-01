// ===========================================
// WEB APP SETUP
// ===========================================
function doGet() {
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