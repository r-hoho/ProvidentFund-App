// ==========================================
// SIGNED PDF LETTERS (Phase D)
// ==========================================
// Generates a bilingual (Thai-first) confirmation letter from a Google Docs
// template, embeds the user's drawn signature, exports to PDF, archives in
// Drive, and returns the PDF metadata for the email attachment.
//
// See "Proposal - Email Confirmations and Signed Letters.md" §5 + the
// Implementation Plan §3 for the agreed flow. NOTE: this module is allowed to
// throw — the caller (action handler) wraps generateLetter() in its own
// try/catch so a letter failure logs letterError but never blocks the action.
//
// Template IDs + folder are hard-coded below for now (Phase D testing). Move to
// Script Properties before production so the IDs aren't in source.
//   PF_ENROLLMENT_TEMPLATE_ID   (required)
//   PF_BENEFICIARY_TEMPLATE_ID  (optional — falls back to enrollment template)
//   PF_LETTERS_FOLDER_ID        (required)
const PF_ENROLLMENT_TEMPLATE_ID  = "1dJhbHiftXafuq7usbhjX-i6rkqBbxzJ1X10MiVpqBj8";
const PF_BENEFICIARY_TEMPLATE_ID = ""; // leave "" to reuse the enrollment template
const PF_LETTERS_FOLDER_ID       = "1nBmGnxydfUtjFM9vEwA9hdM0_E7Iu1dX"; // "" → template's parent folder

const PF_SIG_WIDTH = 180;   // px — signature image render width
const PF_SIG_HEIGHT = 72;   // px — signature image render height

// Thai month names for the bilingual {{date_today}} placeholder (Gregorian year).
const PF_THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

/**
 * Builds a signed PDF letter and returns its Drive metadata.
 *
 * @param {string} type  "ENROLLMENT" | "BENEFICIARY".
 * @param {Object} ctx   Placeholder values (see buildPlaceholderMap for keys);
 *                       ctx.beneficiaries is an array of { name, rel, pct }.
 * @param {string} sigDataUrl  base64 PNG data URL from the signature pad
 *                             (e.g. "data:image/png;base64,iVBOR...").
 * @return {{fileId: string, fileUrl: string, fileName: string}}
 */
function generateLetter(type, ctx, sigDataUrl) {
  const isBeneficiary = (type === "BENEFICIARY");
  const templateId = isBeneficiary
    ? (PF_BENEFICIARY_TEMPLATE_ID || PF_ENROLLMENT_TEMPLATE_ID)
    : PF_ENROLLMENT_TEMPLATE_ID;
  if (!templateId) {
    throw new Error("PF_ENROLLMENT_TEMPLATE_ID is not set in Letter.gs.");
  }

  // Letters folder: hard-coded id when set, else fall back to the template's
  // own parent folder (handy for testing before a dedicated folder exists).
  const lettersFolder = PF_LETTERS_FOLDER_ID
    ? DriveApp.getFolderById(PF_LETTERS_FOLDER_ID)
    : getFirstParentFolder(templateId);

  const subfolderName = isBeneficiary ? "Beneficiary" : "Enrollment";
  const targetFolder = getOrCreateSubfolder(lettersFolder, subfolderName);

  // 1. Copy the template into the target folder.
  const safeName = (ctx.nameEn || "Unknown").toString().trim().replace(/\s+/g, "-");
  const dateStamp = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyyMMdd");
  const baseName = `Provident-Fund-${subfolderName}-${safeName}-${dateStamp}`;

  const templateFile = DriveApp.getFileById(templateId);
  const docCopyFile = templateFile.makeCopy(baseName, targetFolder);
  const docId = docCopyFile.getId();

  let pdfFile;
  try {
    // 2. Fill placeholders, table, and signature.
    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();

    fillPlaceholders(body, buildPlaceholderMap(ctx));
    fillBeneficiaryList(body, ctx.beneficiaries || []);
    insertSignatureImage(body, sigDataUrl);

    doc.saveAndClose();

    // 3. Export the finished Doc as a PDF in the same folder.
    const pdfBlob = DriveApp.getFileById(docId).getAs("application/pdf").setName(`${baseName}.pdf`);
    pdfFile = targetFolder.createFile(pdfBlob);
  } finally {
    // 4. Trash the intermediate Doc — the PDF is the artifact of record.
    //    Runs even if editing/export threw, so we don't leave orphan Docs.
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) { /* best-effort */ }
  }

  return {
    fileId: pdfFile.getId(),
    fileUrl: pdfFile.getUrl(),
    fileName: pdfFile.getName()
  };
}

// ------------------------------------------------------------------
// Placeholder helpers
// ------------------------------------------------------------------

/**
 * Maps the ctx object to the {{snake_case}} text placeholders in the template.
 * {{beneficiary_table}} and {{signature_image}} are handled separately (they
 * are not plain text swaps) and are intentionally absent here.
 */
function buildPlaceholderMap(ctx) {
  const now = new Date();
  const day = Utilities.formatDate(now, "Asia/Bangkok", "d");
  const monthIdx = parseInt(Utilities.formatDate(now, "Asia/Bangkok", "M"), 10) - 1;
  const year = Utilities.formatDate(now, "Asia/Bangkok", "yyyy");
  const enMonth = Utilities.formatDate(now, "Asia/Bangkok", "MMMM");
  const dateToday = `${day} ${PF_THAI_MONTHS[monthIdx]} ${year} / ${day} ${enMonth} ${year}`;

  return {
    "date_today": dateToday,
    "name_en": ctx.nameEn,
    "allstars_id": ctx.allstarsId,
    "business_title": ctx.businessTitle,
    "work_email": ctx.workEmail,
    "hire_date": ctx.hireDate,
    "member_since_date": ctx.memberSinceDate,
    "plan_pct": ctx.planPct,
    "employer_match_pct": ctx.employerMatchPct,
    "investment_plan": ctx.investmentPlan,
    "effective_date": ctx.effectiveDate,
    "transaction_id": ctx.transactionId
  };
}

/**
 * Replaces every {{key}} placeholder with its value. Missing/blank values are
 * written as an empty string so no raw {{placeholder}} leaks into the PDF.
 */
function fillPlaceholders(body, values) {
  for (const key in values) {
    const v = values[key];
    const text = (v === undefined || v === null) ? "" : v.toString();
    // Escape regex specials in the literal placeholder, then replace.
    body.replaceText(`\\{\\{${key}\\}\\}`, text);
  }
}

/**
 * Replaces the {{beneficiary_table}} marker with a plain-text list, one
 * beneficiary per line: "- Name (Relationship) — 60%".
 */
function fillBeneficiaryList(body, beneficiaries) {
  const lines = beneficiaries.map(b => `- ${b.name} (${b.rel}) — ${b.pct}%`).join("\n");
  body.replaceText("\\{\\{beneficiary_table\\}\\}", lines || "-");
}

/**
 * Replaces the {{signature_image}} marker (which must sit alone on its own
 * paragraph) with the decoded signature PNG, sized to PF_SIG_WIDTH×HEIGHT.
 * Clearing then appending into the same paragraph preserves the paragraph's
 * position and alignment, so the image lands exactly where the marker was.
 */
function insertSignatureImage(body, sigDataUrl) {
  const found = body.findText("\\{\\{signature_image\\}\\}");
  if (!found) return; // no marker — skip

  const sigPar = found.getElement().getParent().asParagraph();
  sigPar.clear();

  if (!sigDataUrl) return; // marker cleared, no image to insert

  const blob = decodeSignatureBlob(sigDataUrl);
  sigPar.appendInlineImage(blob).setWidth(PF_SIG_WIDTH).setHeight(PF_SIG_HEIGHT);
}

/** Decodes a base64 PNG data URL into an image Blob. */
function decodeSignatureBlob(sigDataUrl) {
  const base64 = sigDataUrl.replace(/^data:image\/\w+;base64,/, "");
  const bytes = Utilities.base64Decode(base64);
  return Utilities.newBlob(bytes, "image/png", "signature.png");
}

/** Returns the named subfolder inside the parent folder, creating it if absent. */
function getOrCreateSubfolder(parentFolder, name) {
  const existing = parentFolder.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parentFolder.createFolder(name);
}

/** Returns the first parent folder of a file, or Drive root if it has none. */
function getFirstParentFolder(fileId) {
  const parents = DriveApp.getFileById(fileId).getParents();
  return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
}

// ------------------------------------------------------------------
// Phase D test harness — run from the Apps Script editor
// ------------------------------------------------------------------
/**
 * Generates a letter from hardcoded ctx + a tiny sample signature so the PDF
 * can be eyeballed before wiring the real handlers (Phases E/F). Requires the
 * three Script Properties to be set. Logs the resulting PDF URL.
 */
function testGenerateLetter() {
  // A 200×80 dark-blue PNG — confirms the signature lands at the right spot/size.
  const sampleSig =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAABQCAIAAADTD63nAAAAqElEQVR42u3SMQ0AAAgEsVeCECSimgELjE2q4HKpHngXCTAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHgLM5RMDqs0YcwAAAAAElFTkSuQmCC";

  const ctx = {
    nameEn: "Somchai Testsubject",
    allstarsId: "TEST-001",
    businessTitle: "Software Engineer",
    workEmail: "somchai.test@example.com",
    hireDate: "01 Jan 2020",
    memberSinceDate: "01 Jan 2020",
    planPct: "5%",
    employerMatchPct: "5%",
    investmentPlan: "Balanced",
    effectiveDate: "30 Jun 2026",
    transactionId: "EN-20260602-test",
    beneficiaries: [
      { name: "Malee Testsubject", rel: "Spouse", pct: 60 },
      { name: "Niran Testsubject", rel: "Child", pct: 40 }
    ]
  };

  const result = generateLetter("ENROLLMENT", ctx, sampleSig);
  Logger.log("PDF created: " + result.fileName);
  Logger.log("URL: " + result.fileUrl);
  return result;
}
