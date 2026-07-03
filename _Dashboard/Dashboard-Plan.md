# Admin Dashboard Implementation Plan

## Objective
Create a separate, standalone Google Apps Script (HTML Web App) Dashboard for Admin/HR to monitor and manage the Internal Provident Fund Enrollment application. The dashboard will connect to the existing Google Sheet via its Document ID.

## Data Source & Approach
- **Data Source:** Existing Google Sheet used by the main app, accessed via `SpreadsheetApp.openById()`. **CRITICAL CONSTRAINT:** The Dashboard will *strictly* read from the `Audit_Log` sheet only.
- **Approach:** Event Sourcing. All metrics, user states, and search results must be derived by parsing and analyzing the append-only events from the `Audit_Log` sheet.
- **UI Framework:** PicoCSS (to match the main app's styling) and Vanilla JavaScript. Chart.js (via CDN) will be added for aggregated metrics visualization. Single Page Application (SPA) structure using JS to switch between "Pages/Tabs".

## Features & Layout (2-Page Split)

### Page 1: Summary Dashboard & Stats
1. **This Month's Summary:** A quick-glance list/cards showing the count of actions taken this month so far (e.g., X New Enrollments, Y Plan Changes, Z Withdrawals).
2. **Action Trend Chart:** A line or bar chart using Chart.js showing the trend of actions over time (e.g., last 6 months or 30 days). All actions (Enroll, Change %, Withdraw, Update Beneficiaries) will be on the same chart, differentiated by color.
3. **[Suggested] Contribution % Breakdown:** A pie/doughnut chart showing the distribution of the *current* active contribution plans (3%, 5%, 15%, etc.) across all active members.
4. **[Suggested] Investment Plan Breakdown:** A pie/doughnut chart showing the historical distribution of initial Investment Plan selections (Conservative, Growth, etc.) based on enrollment events.

### Page 2: Detail Table & Search
1. **Global Search:** An input box to search for a specific staff member by `Emp Email` or `Emp ID`.
2. **Action Data Table:** A comprehensive table displaying the raw event data.
   - **Columns:** `Time` (Timestamp), `EmpID` (Allstars_ID), `EmpEmail` (Work_Email), `Action`, `Selected_Plan` (Plan), `Investment_Plan`.
   - **Behavior:** By default, shows the most recent actions. When the search box is used, it filters the table to show the complete history/timeline of actions for that specific employee.

## Implementation Steps
1. **Initialize Project Structure:**
   - Create `_Dashboard/Code/` and `_Dashboard/html/` directories.
   - Set up `Main.gs` to serve `Index.html` via `doGet()`.
2. **Backend Configuration (`Code/Config.gs`):**
   - Store the master `SPREADSHEET_ID`.
   - Define the sheet name constant for `Audit_Log` ONLY.
3. **Backend Data Services (`Code/DataService.gs`):**
   - `getAuditData()`: Fetch all raw rows from `Audit_Log`.
4. **Frontend Logic (`html/JS.html`):**
   - Data Processing: Calculate "This Month" totals, group data by date for the trend chart, and map data for the table.
   - Tab Navigation: Logic to toggle visibility between the "Summary" view and "Detail" view.
   - Search/Filter Logic: Real-time filtering of the detailed table array based on the search input.
5. **Frontend UI (`html/`):**
   - `Index.html`: Layout with a navigation bar (Summary | Details).
   - `CSS.html`: PicoCSS styling and custom utility classes.

## Verification & Testing
- Deploy the Dashboard as a Web App (Test deployment).
- Verify that it successfully connects to the existing Google Sheet and reads data without errors.
- Confirm that the chart renders correctly and accurately reflects the event trends.
- Test the employee search functionality to ensure it filters the table properly.