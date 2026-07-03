/**
 * Entry point for the Dashboard Web App.
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('html/Index');
  
  return template.evaluate()
      .setTitle('Provident Fund - Admin Dashboard')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Helper function to include HTML partials.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
