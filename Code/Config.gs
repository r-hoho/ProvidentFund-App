// ==========================================
// GLOBAL CONSTANTS
// ==========================================

const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const SHEET_USERS = 'Users';
const SHEET_ENROLLMENTS = 'Enrollments';
const SHEET_AUDIT = 'Audit_Log';
const SHEET_REPORTING = 'Monthly_Reporting';
const SHEET_BENEFICIARIES = 'Beneficiaries';

// Beneficiary relationship display labels (Thai primary, English in brackets).
// The stored rel value stays the English key (used as the <select> option value);
// only display is mapped. Mirror of REL_LABELS in html/JS_Utils.html — keep in sync.
const REL_LABELS = {
  'Parent':   'บิดา/มารดา (Parent)',
  'Spouse':   'คู่สมรส (Spouse)',
  'Child':    'บุตร (Child)',
  'Relative': 'ญาติ (Relative)',
  'Friend':   'เพื่อน (Friend)',
  'Other':    'อื่นๆ (Other)'
};