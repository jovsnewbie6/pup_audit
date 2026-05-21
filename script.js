// --- STATE MANAGEMENT ---
let currentTab = 'Reimbursement'; 
let currentYear = 'All'; 
let currentOpenCaseId = null;     
let currentSpreadsheet = null; 
let isFullScreen = false;
let isMinimized = false;
let expandedSidebar = { "Reimbursement": true, "Liquidation": true };

let mockDatabase = JSON.parse(localStorage.getItem('pupDatabase')) || [];

// 30-Day Auto Purge for Recycle Bin
const now = new Date();
mockDatabase = mockDatabase.filter(caseData => {
    if (caseData.deleted && caseData.deletedAt) {
        const diffDays = Math.ceil(Math.abs(now - new Date(caseData.deletedAt)) / (1000 * 60 * 60 * 24)); 
        if (diffDays > 30) return false;
    }
    return true;
});

function saveToMemory() { localStorage.setItem('pupDatabase', JSON.stringify(mockDatabase)); }

// Ensure HTML is loaded before running
document.addEventListener('DOMContentLoaded', () => { 
    renderSidebar(); 
    searchCases(); 
    
    // Setup enter-key search
    document.getElementById('searchInput').addEventListener('keyup', searchCases);
});

// --- BACKUP & RESTORE ---
function backupDatabase() {
    const blob = new Blob([JSON.stringify(mockDatabase, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `PUP_Audit_Backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

function restoreDatabase(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            if (Array.isArray(importedData)) { mockDatabase = importedData; saveToMemory(); renderSidebar(); searchCases(); alert("Database restored successfully!"); }
        } catch (error) { alert("Error reading file."); }
        event.target.value = ""; 
    };
    reader.readAsText(file);
}

// --- SIDEBAR & DASHBOARD ---
function renderSidebar() {
    const nav = document.getElementById('sidebarNav');
    nav.innerHTML = ""; 

    ["Reimbursement", "Liquidation"].forEach(type => {
        const cases = mockDatabase.filter(c => c.type === type && !c.deleted);
        const years = [...new Set(cases.map(c => c.date ? c.date.split('-')[0] : 'Unknown'))].sort().reverse();

        const header = document.createElement('li');
        header.className = 'sidebar-category';
        header.innerHTML = `<span>${type.toUpperCase()}S</span> <span>${expandedSidebar[type] ? '▼' : '▶'}</span>`;
        header.onclick = () => { expandedSidebar[type] = !expandedSidebar[type]; renderSidebar(); };
        nav.appendChild(header);

        if (expandedSidebar[type]) {
            nav.appendChild(createNavBtn(type, 'All', cases.length));
            years.forEach(year => {
                const count = cases.filter(c => c.date && c.date.startsWith(year)).length;
                nav.appendChild(createNavBtn(type, year, count));
            });
        }
    });

    const binCount = mockDatabase.filter(c => c.deleted).length;
    const binHeader = document.createElement('li');
    binHeader.className = `sidebar-category ${currentTab === 'Bin' ? 'bin-active' : ''}`;
    binHeader.style.marginTop = '25px';
    binHeader.innerHTML = `<span>🗑️ RECYCLE BIN</span> <span class="badge" style="background: white; color: #c0392b;">${binCount}</span>`;
    binHeader.onclick = () => { currentTab = 'Bin'; currentYear = 'All'; document.getElementById('pageTitle').innerText = `Recycle Bin`; document.getElementById('pageSubtitle').innerText = `Deleted cases are permanently removed after 30 days`; updateTopButtons(); renderSidebar(); searchCases(); };
    nav.appendChild(binHeader);
}

function createNavBtn(type, year, count) {
    const li = document.createElement('li');
    li.className = `nav-item ${currentTab === type && currentYear === year ? 'active' : ''}`;
    li.innerHTML = `<span>${year === 'All' ? 'All Years' : year}</span> <span class="badge">${count}</span>`;
    li.onclick = () => { currentTab = type; currentYear = year; document.getElementById('pageTitle').innerText = `${type}s - ${year === 'All' ? 'All Years' : year}`; document.getElementById('pageSubtitle').innerText = `Search and review submitted cases`; updateTopButtons(); renderSidebar(); searchCases(); };
    return li;
}

function updateTopButtons() {
    document.getElementById('addNewBtn').style.display = (currentTab === 'Bin') ? 'none' : 'inline-block';
    document.getElementById('emptyBinBtn').style.display = (currentTab === 'Bin') ? 'inline-block' : 'none';
}

function updateDashboard(results) {
    document.getElementById('dashTotal').innerText = results.length;
    document.getElementById('dashPending').innerText = results.filter(c => c.status === 'Pending').length;
    document.getElementById('dashApproved').innerText = results.filter(c => c.status === 'Approved').length;
    document.getElementById('dashRejected').innerText = results.filter(c => c.status === 'Rejected').length;
}

// --- SEARCH & RESULTS ---
function searchCases() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    const dateQuery = document.getElementById('dateInput').value;
    const container = document.getElementById('resultsContainer');
    
    const results = mockDatabase.filter(item => {
        if (currentTab === 'Bin') return !!item.deleted; 
        if (item.deleted) return false; 
        return item.type === currentTab && (item.name.toLowerCase().includes(query) || (item.serial && item.serial.toLowerCase().includes(query))) && (dateQuery ? item.date === dateQuery : true) && (currentYear === 'All' ? true : (item.date && item.date.startsWith(currentYear)));
    });
    
    updateDashboard(results);
    renderResults(results);
}

function renderResults(data) {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = ""; 
    if (data.length === 0) {
        container.innerHTML = `<p class='placeholder-text'>${currentTab === 'Bin' ? "The Recycle Bin is empty." : "No cases found matching your search criteria."}</p>`;
        return;
    }

    data.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card';
        if (currentTab === 'Bin') {
            const daysLeft = 30 - Math.floor((new Date() - new Date(item.deletedAt)) / (1000 * 60 * 60 * 24));
            card.innerHTML = `
                <span class="status-badge status-rejected">${daysLeft} Days Left</span>
                <span class="serial">${item.serial}</span>
                <h3 style="color: #555; text-decoration: line-through;">${item.name}</h3>
                <span class="date">Deleted on: ${new Date(item.deletedAt).toLocaleDateString()}</span>
                <p class="summary" style="color: #aaa;">${item.summary}</p>
                <div class="bin-actions">
                    <button class="bin-btn restore-btn" onclick="restoreCase(${item.id}, event)">↺ Restore</button>
                    <button class="bin-btn perm-delete-btn" onclick="permanentlyDelete(${item.id}, event)">❌ Delete Forever</button>
                </div>
            `;
        } else {
            card.onclick = () => openModal(item.id); 
            card.innerHTML = `
                <span class="status-badge status-${(item.status || 'Pending').toLowerCase()}">${item.status || 'Pending'}</span>
                <span class="serial">${item.serial}</span>
                <h3>${item.name}</h3>
                <span class="date">Submitted: ${item.date}</span>
                <p class="summary">${item.summary}</p>
            `;
        }
        container.appendChild(card);
    });
}

// --- SUBMIT NEW RECORD LOGIC ---
function openAddModal() { document.getElementById('addModal').style.display = 'block'; }
function closeAddModal() { document.getElementById('addModal').style.display = 'none'; }
window.onclick = function(event) { if (event.target == document.getElementById('addModal')) closeAddModal(); }

function submitNewRecord(event) {
    event.preventDefault(); 
    
    try {
        const getValue = (id) => document.getElementById(id) ? document.getElementById(id).value : "";

        let dynamicName = getValue('f_project');
        if (!dynamicName) dynamicName = "Untitled Audit Case";
        
        let dynamicDate = getValue('f_dateAssign') || getValue('f_checkDate');
        if (!dynamicDate) dynamicDate = new Date().toISOString().split('T')[0];

        const summary = `Audit case generated for ${dynamicName}.`;
        const fileInput = document.getElementById('newFile');

        // --- NEW INDEPENDENT SERIAL NUMBER LOGIC ---
        const yearStr = dynamicDate.split('-')[0] || new Date().getFullYear();
        const typeIndicator = currentTab === 'Reimbursement' ? 'R' : 'L';
        
        // Find highest serial number specifically for THIS type and THIS year
        const similarCases = mockDatabase.filter(c => c.type === currentTab && c.date && c.date.startsWith(yearStr));
        let maxSequence = 0;
        
        similarCases.forEach(c => {
            if (c.serial) {
                // Serial format is "AUD-R: 2026 - 0001". Split by " - " to get the sequence.
                const parts = c.serial.split(' - ');
                if (parts.length === 2) {
                    const num = parseInt(parts[1], 10);
                    if (!isNaN(num) && num > maxSequence) {
                        maxSequence = num;
                    }
                }
            }
        });
        
        const nextSequenceNumber = maxSequence + 1;
        const generatedSerial = `AUD-${typeIndicator}: ${yearStr} - ${String(nextSequenceNumber).padStart(4, '0')}`;
        // ------------------------------------------

        const newCase = { 
            id: Date.now(), // Unique internal ID
            serial: generatedSerial, // Beautiful visible Serial Number
            type: currentTab, 
            name: dynamicName, 
            date: dynamicDate, 
            summary: summary, 
            status: "Pending", 
            logs: [], 
            excelData: null, 
            style: {}, 
            mergeCells: null, 
            deleted: false, 
            deletedAt: null 
        };

        if (fileInput && fileInput.files.length > 0 && fileInput.files[0].name.match(/\.(xlsx|xls|csv)$/i)) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const workbook = XLSX.read(new Uint8Array(e.target.result), {type: 'array'});
                newCase.excelData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
                mockDatabase.push(newCase); 
                finishSubmission();
            };
            reader.readAsArrayBuffer(fileInput.files[0]);
        } else {
            const rowData = [
                getValue('f_no'), getValue('f_fund'), getValue('f_checkDate'), getValue('f_officer'),
                getValue('f_transType'), getValue('f_soNum'), getValue('f_soDate'), getValue('f_project'),
                getValue('f_incDates'), getValue('f_amtGranted'), getValue('f_amtLiq'), getValue('f_auditor'),
                getValue('f_dateAssign'), 
                "", "", "", "", "", ""
            ];

            const formattedDate = new Date(dynamicDate).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
            
            const headers = ["No.", "Fund", "Check Date", "Accountable Officer", "Transaction Type", "SO Number", "SO Date", "Project Description", "Inclusive Dates", "Amount Granted", "Amount", "Auditor", "Date Assign", "Date Audited", "Audit Result", "Date Forwarded to the Chief", "Reviewed by / Comments", "Reviewed by / Date", "Remarks"];
            
            newCase.excelData = [
                [`SUMMARY OF AUDIT REPORT - ${currentTab.toUpperCase()}S`, ...Array(18).fill("")],
                [`For the Fiscal Year ${yearStr}`, ...Array(18).fill("")],
                [`As of ${formattedDate}`, ...Array(18).fill("")],
                headers, 
                rowData
            ];
            
            newCase.mergeCells = { A1: [19, 1], A2: [19, 1], A3: [19, 1] };
            newCase.style = { 'A1': 'text-align: center; font-weight: bold; font-size: 16px;', 'A2': 'text-align: center; font-weight: bold;', 'A3': 'text-align: center; font-weight: bold;' };
            const columns = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S'];
            columns.forEach(col => newCase.style[`${col}4`] = 'background-color: #ffff00; font-weight: bold; text-align: center;');
            
            mockDatabase.push(newCase); 
            finishSubmission();
        }
    } catch (err) {
        alert("There was an error submitting the case. Please check your form. Error: " + err.message);
    }
}

function finishSubmission() {
    saveToMemory(); 
    closeAddModal(); 
    document.getElementById('addRecordForm').reset();
    document.getElementById('searchInput').value = ""; 
    document.getElementById('dateInput').value = "";
    updateTopButtons(); 
    renderSidebar(); 
    searchCases(); 
}

// --- MODAL & SPREADSHEET LOGIC ---
function openModal(id) {
    const caseData = mockDatabase.find(item => item.id === id);
    if (!caseData) return;
    restoreModal();
    if (isFullScreen) toggleFullScreen(); 

    currentOpenCaseId = id;
    document.getElementById('fileModal').style.display = 'block';
    document.getElementById('modalTitle').innerText = `[${caseData.serial}] Audit Worksheet: ${caseData.name}`;
    document.getElementById('caseStatusDropdown').value = caseData.status || "Pending";
    renderLogs(caseData.logs);
    
    const container = document.getElementById('excelViewer');
    container.innerHTML = "";
    if (currentSpreadsheet) currentSpreadsheet.destroy();

    if (!caseData.excelData || caseData.excelData.length === 0) {
        const title = `SUMMARY OF AUDIT REPORT - ${currentTab.toUpperCase()}S`;
        const formattedDate = caseData.date ? new Date(caseData.date).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }) : new Date().toLocaleDateString();
        const headers = ["No.", "Fund", "Check Date", "Accountable Officer", "Transaction Type", "SO Number", "SO Date", "Project Description", "Inclusive Dates", "Amount Granted", "Amount", "Auditor", "Date Assign", "Date Audited", "Audit Result", "Date Forwarded to the Chief", "Reviewed by / Comments", "Reviewed by / Date", "Remarks"];
        caseData.excelData = [[title, ...Array(18).fill("")], [`For the Fiscal Year ${new Date().getFullYear()}`, ...Array(18).fill("")], [`As of ${formattedDate}`, ...Array(18).fill("")], headers, Array(19).fill("")];
        caseData.mergeCells = { A1: [19, 1], A2: [19, 1], A3: [19, 1] };
        caseData.style = { 'A1': 'text-align: center; font-weight: bold; font-size: 16px;', 'A2': 'text-align: center; font-weight: bold;', 'A3': 'text-align: center; font-weight: bold;' };
        const columns = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S'];
        columns.forEach(col => caseData.style[`${col}4`] = 'background-color: #ffff00; font-weight: bold; text-align: center;');
    }

    currentSpreadsheet = jspreadsheet(container, {
        data: caseData.excelData,
        minDimensions: [19, 20], 
        defaultColWidth: 140, 
        tableOverflow: true, 
        tableWidth: "100%", 
        tableHeight: "400px",
        columnDrag: true, 
        rowDrag: true, 
        allowInsertRow: true, 
        allowInsertColumn: true,
        style: caseData.style || {}, 
        mergeCells: caseData.mergeCells || {}, 
        responsive: true
    });
}

function closeModal() {
    if (currentSpreadsheet && currentOpenCaseId) {
        const caseData = mockDatabase.find(item => item.id === currentOpenCaseId);
        if (caseData) {
            caseData.excelData = currentSpreadsheet.getData();
            caseData.headers = currentSpreadsheet.getHeaders().split(',');
            caseData.style = currentSpreadsheet.getStyle();
            caseData.mergeCells = currentSpreadsheet.getConfig().mergeCells || {};
        }
    }
    saveToMemory();
    document.getElementById('fileModal').style.display = 'none';
    currentOpenCaseId = null;
}

function changeCaseStatus(newStatus) {
    const caseData = mockDatabase.find(item => item.id === currentOpenCaseId);
    if (caseData && caseData.status !== newStatus) {
        caseData.status = newStatus;
        if (!caseData.logs) caseData.logs = [];
        caseData.logs.push({ date: new Date().toLocaleString(), message: `System: Status changed to ${newStatus}` });
        saveToMemory(); 
        searchCases(); 
        renderLogs(caseData.logs); 
    }
}

// --- AUDIT LOGS ---
function renderLogs(logs) {
    const container = document.getElementById('logHistory');
    container.innerHTML = "";
    if (!logs || logs.length === 0) { container.innerHTML = "<p style='color: #999; font-style: italic; font-size: 0.9em; margin: 0; padding: 10px;'>No comments or history yet.</p>"; return; }
    logs.forEach(log => {
        const div = document.createElement('div');
        div.className = `log-entry ${log.message.startsWith("System:") ? 'system-log' : ''}`;
        div.innerHTML = `<span class="timestamp">${log.date}</span><span class="message">${log.message}</span>`;
        container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
}

function addAuditLog() {
    if (!currentOpenCaseId) return;
    const input = document.getElementById('newLogInput');
    if (!input.value.trim()) return;
    const caseData = mockDatabase.find(item => item.id === currentOpenCaseId);
    if (caseData) {
        if (!caseData.logs) caseData.logs = [];
        caseData.logs.push({ date: new Date().toLocaleString(), message: input.value.trim() });
        saveToMemory(); renderLogs(caseData.logs); input.value = ""; 
    }
}

// --- DELETE & RECYCLE BIN ---
function deleteCurrentCase() {
    if(confirm("Move this case to the Recycle Bin? It will be permanently deleted after 30 days.")) {
        const caseData = mockDatabase.find(c => c.id === currentOpenCaseId);
        caseData.deleted = true; caseData.deletedAt = new Date().toISOString();
        saveToMemory(); closeModal(); renderSidebar(); searchCases();
    }
}

function restoreCase(id, event) {
    event.stopPropagation();
    const caseData = mockDatabase.find(c => c.id === id);
    caseData.deleted = false; caseData.deletedAt = null;
    saveToMemory(); renderSidebar(); searchCases();
}

function permanentlyDelete(id, event) {
    event.stopPropagation();
    if(confirm("Are you sure you want to PERMANENTLY delete this case? This cannot be undone.")) {
        mockDatabase = mockDatabase.filter(c => c.id !== id);
        saveToMemory(); renderSidebar(); searchCases();
    }
}

function emptyBin() {
    if(confirm("Are you sure you want to permanently delete ALL items in the Recycle Bin?")) {
        mockDatabase = mockDatabase.filter(c => !c.deleted);
        saveToMemory(); renderSidebar(); searchCases();
    }
}

// --- IMPORT/EXPORT & PDF ---
function importExcel(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const workbook = XLSX.read(new Uint8Array(e.target.result), {type: 'array'});
        const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
        if (currentOpenCaseId) {
            const caseData = mockDatabase.find(item => item.id === currentOpenCaseId);
            caseData.excelData = jsonData; caseData.headers = null; caseData.style = null; caseData.mergeCells = null; saveToMemory();
        }
        const container = document.getElementById('excelViewer');
        container.innerHTML = ""; if (currentSpreadsheet) currentSpreadsheet.destroy();
        currentSpreadsheet = jspreadsheet(container, { data: jsonData, minDimensions: [19, 20], defaultColWidth: 140, tableOverflow: true, tableWidth: "100%", tableHeight: "400px", responsive: true });
    };
    reader.readAsArrayBuffer(file);
}

function exportExcel() {
    if (!currentOpenCaseId || !currentSpreadsheet) return;
    
    const caseData = mockDatabase.find(item => item.id === currentOpenCaseId);
    const data = currentSpreadsheet.getData();
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    
    if (caseData.mergeCells) {
        worksheet['!merges'] = [];
        for (const [cell, span] of Object.entries(caseData.mergeCells)) {
            const decoded = XLSX.utils.decode_cell(cell); 
            worksheet['!merges'].push({
                s: { r: decoded.r, c: decoded.c },
                e: { r: decoded.r + (span[1] || 1) - 1, c: decoded.c + span[0] - 1 }
            });
        }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "AuditData");
    XLSX.writeFile(workbook, `${caseData.serial}_Audit_Data.xlsx`);
}

function generatePDF() {
    if (!currentOpenCaseId) return;
    const caseData = mockDatabase.find(item => item.id === currentOpenCaseId);
    let logsHTML = caseData.logs.map(log => `<p style="font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 5px;"><strong style="color: #555;">${log.date}</strong><br>${log.message}</p>`).join('');
    if(!logsHTML) logsHTML = "<p style='font-style: italic; color: #777;'>No audit logs recorded.</p>";
    const statusColor = caseData.status === 'Approved' ? '#059669' : caseData.status === 'Rejected' ? '#dc2626' : '#d97706';

    const element = document.createElement('div');
    element.style.padding = '50px'; element.style.fontFamily = 'Helvetica, Arial, sans-serif'; element.style.color = '#333';
    element.innerHTML = `
        <div style="text-align: center; border-bottom: 3px solid #800000; padding-bottom: 20px; margin-bottom: 30px;">
            <h1 style="color: #800000; margin: 0; font-size: 32px;">PUP INTERNAL AUDIT</h1><h3 style="color: #555; margin: 5px 0 0 0; text-transform: uppercase;">Executive Case Summary</h3>
        </div>
        <table style="width: 100%; margin-bottom: 30px; border-collapse: collapse; font-size: 15px;">
            <tr><td style="padding: 12px; border: 1px solid #ccc; background: #f9f9f9; font-weight: bold; width: 180px;">Serial Number:</td><td style="padding: 12px; border: 1px solid #ccc; font-family: monospace;">${caseData.serial}</td></tr>
            <tr><td style="padding: 12px; border: 1px solid #ccc; background: #f9f9f9; font-weight: bold;">Case Title:</td><td style="padding: 12px; border: 1px solid #ccc; font-weight: bold;">${caseData.name}</td></tr>
            <tr><td style="padding: 12px; border: 1px solid #ccc; background: #f9f9f9; font-weight: bold;">Audit Type:</td><td style="padding: 12px; border: 1px solid #ccc;">${caseData.type}</td></tr>
            <tr><td style="padding: 12px; border: 1px solid #ccc; background: #f9f9f9; font-weight: bold;">Date Submitted:</td><td style="padding: 12px; border: 1px solid #ccc;">${caseData.date}</td></tr>
            <tr><td style="padding: 12px; border: 1px solid #ccc; background: #f9f9f9; font-weight: bold;">Status:</td><td style="padding: 12px; border: 1px solid #ccc; font-weight: bold; color: ${statusColor}; text-transform: uppercase;">${caseData.status}</td></tr>
        </table>
        <h3 style="color: #800000; border-bottom: 1px solid #ccc; padding-bottom: 8px;">Executive Overview</h3>
        <p style="background: #f4f7f6; padding: 20px; border-left: 5px solid #800000; line-height: 1.6; white-space: pre-wrap;">${caseData.summary}</p>
        <h3 style="color: #800000; border-bottom: 1px solid #ccc; padding-bottom: 8px;">Audit Trail & Remarks</h3>${logsHTML}
    `;

    const btn = document.getElementById('pdfBtn'); const originalText = btn.innerHTML; btn.innerHTML = "⏳ Generating..."; btn.style.opacity = "0.7";
    html2pdf().set({ margin: 0, filename: `${caseData.serial}_Summary.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' } }).from(element).save().then(() => { btn.innerHTML = originalText; btn.style.opacity = "1"; });
}

// --- WINDOW CONTROLS ---
function toggleFullScreen() {
    if (isMinimized) restoreModal(); 
    const modalContent = document.getElementById('worksheetModalContent');
    isFullScreen = !isFullScreen;
    if (isFullScreen) { modalContent.classList.add('fullscreen'); document.getElementById('maxBtn').innerHTML = "❐"; } 
    else { modalContent.classList.remove('fullscreen'); document.getElementById('maxBtn').innerHTML = "□"; }
}

function minimizeModal() {
    const modalContent = document.getElementById('worksheetModalContent');
    isMinimized = true; isFullScreen = false;
    modalContent.classList.remove('fullscreen'); document.getElementById('maxBtn').innerHTML = "□";
    modalContent.classList.add('minimized'); document.getElementById('fileModal').classList.add('minimized-backdrop');
    modalContent.onclick = function(e) { if (isMinimized && !e.target.classList.contains('win-btn')) restoreModal(); }
}

function restoreModal() {
    const modalContent = document.getElementById('worksheetModalContent');
    isMinimized = false; modalContent.classList.remove('minimized'); document.getElementById('fileModal').classList.remove('minimized-backdrop');
    modalContent.onclick = null; 
}