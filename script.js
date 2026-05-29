// ============ GLOBAL STATE VARIABLES ============
let currentUser = null;
let currentToken = localStorage.getItem('authToken') || null;
let mockDatabase = JSON.parse(localStorage.getItem('pupDatabase')) || [];
const API_BASE_URL = window.location.origin + '/api'; // Use relative URL for backend

// ============ AUTHENTICATION FUNCTIONS ============

function showAuthInterface() {
    document.getElementById('authContainer').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
}

function showMainInterface() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('appContainer').style.display = 'flex';
}

// Handle login
async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            errorEl.textContent = data.error || 'Login failed';
            return;
        }
        
        currentToken = data.token;
        currentUser = { username: data.username, role: data.role };
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        showMainInterface();
        document.getElementById('loginForm').reset();
        errorEl.textContent = '';
    } catch (error) {
        console.error('Login error:', error);
        errorEl.textContent = 'Connection error';
    }
}

// Handle registration
async function handleRegister(event) {
    event.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;
    const role = document.getElementById('registerRole').value;
    const errorEl = document.getElementById('registerError');
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ username, password, role })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            errorEl.textContent = data.error || 'Registration failed';
            return;
        }
        
        errorEl.style.color = 'green';
        errorEl.textContent = 'Registration successful! Please login.';
        document.getElementById('registerForm').reset();
        setTimeout(() => switchToLogin(event), 2000);
    } catch (error) {
        console.error('Register error:', error);
        errorEl.textContent = 'Connection error';
    }
}

// Switch between login and register screens
function switchToRegister(event) {
    event.preventDefault();
    document.getElementById('loginScreen').classList.remove('active');
    document.getElementById('registerScreen').classList.add('active');
}

function switchToLogin(event) {
    event.preventDefault();
    document.getElementById('registerScreen').classList.remove('active');
    document.getElementById('loginScreen').classList.add('active');
}

// Handle logout
function handleLogout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    currentToken = null;
    currentUser = null;
    showAuthInterface();
}

// Generic API call helper
async function apiCall(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (currentToken) {
        headers['Authorization'] = `Bearer ${currentToken}`;
    }
    
    const config = {
        ...options,
        headers
    };
    
    try {
        return await fetch(`${API_BASE_URL}${endpoint}`, config);
    } catch (error) {
        console.error('API call error:', error);
        return null;
    }
}

// Initialize authentication on page load
function initializeAuth() {
    const token = localStorage.getItem('authToken');
    const user = localStorage.getItem('currentUser');
    
    if (token && user) {
        currentToken = token;
        currentUser = JSON.parse(user);
        showMainInterface();
    } else {
        showAuthInterface();
    }
}

// Override initial data loading to use API if available
async function loadRecordsFromAPI() {
    if (!currentUser || !currentToken) return null;
    
    try {
        const response = await apiCall('/audit');
        if (!response) return null;
        
        if (response.ok) {
            const records = await response.json();
            // Transform API records to match mockDatabase format
            return records.map(record => ({
                id: record.id,
                serial: record.serial_number,
                type: record.record_type,
                name: record.record_name,
                date: record.created_at ? record.created_at.split('T')[0] : new Date().toISOString().split('T')[0],
                summary: `Audit record for ${record.record_name}`,
                status: record.status,
                logs: [],
                excelData: null,
                style: {},
                mergeCells: null,
                deleted: record.is_deleted,
                deletedAt: record.deleted_at,
                api_id: record.id
            }));
        }
    } catch (error) {
        console.error('Failed to load records from API:', error);
        return null;
    }
}

// Override the initial DOMContentLoaded logic
const originalDOMContentLoaded = document.addEventListener.bind(document);
document.addEventListener = function(event, handler) {
    if (event === 'DOMContentLoaded') {
        return originalDOMContentLoaded(event, async () => {
            // Initialize authentication UI first
            initializeAuth();
            
            // Check if we have auth token
            if (currentToken && currentUser) {
                // Load from API first
                const apiRecords = await loadRecordsFromAPI();
                if (apiRecords) {
                    mockDatabase = apiRecords;
                } else {
                    // Fallback to localStorage
                    mockDatabase = JSON.parse(localStorage.getItem('pupDatabase')) || [];
                }
            } else {
                mockDatabase = JSON.parse(localStorage.getItem('pupDatabase')) || [];
            }
            
            // Apply 30-day auto purge
            const now = new Date();
            mockDatabase = mockDatabase.filter(recordData => {
                if (recordData.deleted && recordData.deletedAt) {
                    const diffDays = Math.ceil(Math.abs(now - new Date(recordData.deletedAt)) / (1000 * 60 * 60 * 24));
                    if (diffDays > 30) return false;
                }
                return true;
            });

            if (currentToken && currentUser) {
                renderSidebar();
                searchRecords();
                document.getElementById('searchInput').addEventListener('keyup', searchRecords);
            }
            
            // Call original handler
            handler();
        });
    }
    return originalDOMContentLoaded(event, handler);
};

// --- STATE MANAGEMENT ---
let currentTab = 'Reimbursement'; 
let currentYear = 'All'; 
let currentOpenRecordId = null;     
let currentSpreadsheet = null; 
let isFullScreen = false;
let isMinimized = false;
let expandedSidebar = { "Reimbursement": true, "Liquidation": true };

// 30-Day Auto Purge for Recycle Bin
const now = new Date();
mockDatabase = mockDatabase.filter(recordData => {
    if (recordData.deleted && recordData.deletedAt) {
        const diffDays = Math.ceil(Math.abs(now - new Date(recordData.deletedAt)) / (1000 * 60 * 60 * 24)); 
        if (diffDays > 30) return false;
    }
    return true;
});

function saveToMemory() { 
    localStorage.setItem('pupDatabase', JSON.stringify(mockDatabase));
    
    // Also sync to backend if user is authenticated
    if (currentUser && currentToken) {
        syncRecordsToAPI();
    }
}

// Sync records to API
async function syncRecordsToAPI() {
    // This is optional - records can also be managed through individual API calls
    // For now, we'll handle this at the individual operation level
}

// Enhanced delete function with API call
async function deleteCurrentRecord() {
    if (!currentOpenRecordId) return;
    
    if(confirm("Move this record to the Recycle Bin? It will be permanently deleted after 30 days.")) {
        try {
            const record = mockDatabase.find(c => c.id === currentOpenRecordId);
            
            // If record has API ID, call API delete
            if (record && record.api_id && currentToken) {
                const response = await apiCall(`/audit/${record.api_id}`, {
                    method: 'DELETE'
                });
                
                if (!response.ok) {
                    alert('Failed to delete record on server');
                    return;
                }
            }
            
            // Update local database
            record.deleted = true;
            record.deletedAt = new Date().toISOString();
            saveToMemory();
            closeModal();
            renderSidebar();
            searchRecords();
        } catch (error) {
            console.error('Delete error:', error);
            alert('Error deleting record');
        }
    }
}

// Check if delete button should be shown
function canDeleteRecords() {
    if (!currentUser) return false;
    // Audit Supervisors can always delete
    if (currentUser.role === 'Audit Supervisor') return true;
    // Staff Auditors cannot delete (permission configurable by supervisor)
    return false;
}

// Ensure HTML is loaded before running
document.addEventListener('DOMContentLoaded', () => { 
    renderSidebar(); 
    searchRecords(); 
    
    // Setup enter-key search
    document.getElementById('searchInput').addEventListener('keyup', searchRecords);
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
            if (Array.isArray(importedData)) { mockDatabase = importedData; saveToMemory(); renderSidebar(); searchRecords(); alert("Database restored successfully!"); }
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
        const records = mockDatabase.filter(c => c.type === type && !c.deleted);
        const years = [...new Set(records.map(c => c.date ? c.date.split('-')[0] : 'Unknown'))].sort().reverse();

        const header = document.createElement('li');
        header.className = 'sidebar-category';
        header.innerHTML = `<span>${type.toUpperCase()}S</span> <span>${expandedSidebar[type] ? '▼' : '▶'}</span>`;
        header.onclick = () => { expandedSidebar[type] = !expandedSidebar[type]; renderSidebar(); };
        nav.appendChild(header);

        if (expandedSidebar[type]) {
            nav.appendChild(createNavBtn(type, 'All', records.length));
            years.forEach(year => {
                const count = records.filter(c => c.date && c.date.startsWith(year)).length;
                nav.appendChild(createNavBtn(type, year, count));
            });
        }
    });

    const binCount = mockDatabase.filter(c => c.deleted).length;
    const binHeader = document.createElement('li');
    binHeader.className = `sidebar-category ${currentTab === 'Bin' ? 'bin-active' : ''}`;
    binHeader.style.marginTop = '25px';
    binHeader.innerHTML = `<span>🗑️ RECYCLE BIN</span> <span class="badge" style="background: white; color: #c0392b;">${binCount}</span>`;
    binHeader.onclick = () => { currentTab = 'Bin'; currentYear = 'All'; document.getElementById('pageTitle').innerText = `Recycle Bin`; document.getElementById('pageSubtitle').innerText = `Deleted records are permanently removed after 30 days`; updateTopButtons(); renderSidebar(); searchRecords(); };
    nav.appendChild(binHeader);
}

function createNavBtn(type, year, count) {
    const li = document.createElement('li');
    li.className = `nav-item ${currentTab === type && currentYear === year ? 'active' : ''}`;
    li.innerHTML = `<span>${year === 'All' ? 'All Years' : year}</span> <span class="badge">${count}</span>`;
    li.onclick = () => { currentTab = type; currentYear = year; document.getElementById('pageTitle').innerText = `${type}s - ${year === 'All' ? 'All Years' : year}`; document.getElementById('pageSubtitle').innerText = `Search and review submitted records`; updateTopButtons(); renderSidebar(); searchRecords(); };
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
function searchRecords() {
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
        container.innerHTML = `<p class='placeholder-text'>${currentTab === 'Bin' ? "The Recycle Bin is empty." : "No records found matching your search criteria."}</p>`;
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
                    <button class="bin-btn restore-btn" onclick="restoreRecord(${item.id}, event)">↺ Restore</button>
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

window.onclick = function(event) { 
    if (event.target == document.getElementById('addModal')) closeAddModal(); 
    if (event.target == document.getElementById('addRowModal')) closeAddRowModal(); 
}

function submitNewRecord(event) {
    event.preventDefault(); 
    
    try {
        const getValue = (id) => document.getElementById(id) ? document.getElementById(id).value : "";

        let dynamicName = getValue('f_project');
        if (!dynamicName) dynamicName = "Untitled Record";
        
        let dynamicDate = getValue('f_dateAssign') || getValue('f_checkDate');
        if (!dynamicDate) dynamicDate = new Date().toISOString().split('T')[0];

        const summary = `Audit record generated for ${dynamicName}.`;
        const fileInput = document.getElementById('newFile');

        const yearStr = dynamicDate.split('-')[0] || new Date().getFullYear();
        const typeIndicator = currentTab === 'Reimbursement' ? 'R' : 'L';
        
        const similarRecords = mockDatabase.filter(c => c.type === currentTab && c.date && c.date.startsWith(yearStr));
        let maxSequence = 0;
        
        similarRecords.forEach(c => {
            if (c.serial) {
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

        const newRecord = { 
            id: Date.now(), 
            serial: generatedSerial, 
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
                newRecord.excelData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
                mockDatabase.push(newRecord); 
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
            
            newRecord.excelData = [
                [`SUMMARY OF AUDIT REPORT - ${currentTab.toUpperCase()}S`, ...Array(18).fill("")],
                [`For the Fiscal Year ${yearStr}`, ...Array(18).fill("")],
                [`As of ${formattedDate}`, ...Array(18).fill("")],
                headers, 
                rowData
            ];
            
            newRecord.mergeCells = { A1: [19, 1], A2: [19, 1], A3: [19, 1] };
            newRecord.style = { 'A1': 'text-align: center; font-weight: bold; font-size: 16px;', 'A2': 'text-align: center; font-weight: bold;', 'A3': 'text-align: center; font-weight: bold;' };
            const columns = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S'];
            columns.forEach(col => newRecord.style[`${col}4`] = 'background-color: #ffff00; font-weight: bold; text-align: center;');
            
            mockDatabase.push(newRecord); 
            finishSubmission();
        }
    } catch (err) {
        alert("There was an error submitting the record. Please check your form. Error: " + err.message);
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
    searchRecords(); 
}

// --- APPEND NEW ROW LOGIC ---
function openAddRowModal() {
    document.getElementById('addRowModal').style.display = 'block';
}

function closeAddRowModal() {
    document.getElementById('addRowModal').style.display = 'none';
    document.getElementById('addRowForm').reset();
}

function submitNewRow(event) {
    event.preventDefault();
    try {
        const getValue = (id) => document.getElementById(id) ? document.getElementById(id).value : "";
        
        const rowData = [
            getValue('r_no'), getValue('r_fund'), getValue('r_checkDate'), getValue('r_officer'),
            getValue('r_transType'), getValue('r_soNum'), getValue('r_soDate'), getValue('r_project'),
            getValue('r_incDates'), getValue('r_amtGranted'), getValue('r_amtLiq'), getValue('r_auditor'),
            getValue('r_dateAssign'), 
            "", "", "", "", "", ""
        ];

        const record = mockDatabase.find(item => item.id === currentOpenRecordId);
        if (record && currentSpreadsheet) {
            let currentData = currentSpreadsheet.getData();
            record.style = currentSpreadsheet.getStyle();
            
            let insertIndex = currentData.length;
            for (let i = currentData.length - 1; i >= 3; i--) {
                const isEmpty = currentData[i].every(cell => !cell || String(cell).trim() === "");
                if (!isEmpty) {
                    insertIndex = i + 1;
                    break;
                }
            }
            
            if (insertIndex < currentData.length) {
                currentData[insertIndex] = rowData;
            } else {
                currentData.push(rowData);
            }
            
            record.excelData = currentData;
            
            if (!record.logs) record.logs = [];
            record.logs.push({ date: new Date().toLocaleString(), message: `System: Inserted new data row via form.` });
            
            saveToMemory();
            closeAddRowModal();
            openModal(currentOpenRecordId); 
        }
    } catch (err) {
        alert("There was an error appending the row: " + err.message);
    }
}

// --- MODAL & SPREADSHEET LOGIC ---
function openModal(id) {
    const record = mockDatabase.find(item => item.id === id);
    if (!record) return;
    restoreModal();
    if (isFullScreen) toggleFullScreen(); 

    currentOpenRecordId = id;
    document.getElementById('fileModal').style.display = 'block';
    document.getElementById('modalTitle').innerText = `[${record.serial}] Audit Worksheet: ${record.name}`;
    document.getElementById('recordStatusDropdown').value = record.status || "Pending";
    
    // Update delete button visibility based on permissions
    const deleteBtn = document.querySelector('.delete-btn');
    if (deleteBtn) {
        if (canDeleteRecords()) {
            deleteBtn.style.display = 'inline-block';
        } else {
            deleteBtn.style.display = 'none';
        }
    }
    
    renderLogs(record.logs);
    
    const container = document.getElementById('excelViewer');
    container.innerHTML = "";
    if (currentSpreadsheet) currentSpreadsheet.destroy();

    if (!record.excelData || record.excelData.length === 0) {
        const title = `SUMMARY OF AUDIT REPORT - ${currentTab.toUpperCase()}S`;
        const formattedDate = record.date ? new Date(record.date).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }) : new Date().toLocaleDateString();
        const headers = ["No.", "Fund", "Check Date", "Accountable Officer", "Transaction Type", "SO Number", "SO Date", "Project Description", "Inclusive Dates", "Amount Granted", "Amount", "Auditor", "Date Assign", "Date Audited", "Audit Result", "Date Forwarded to the Chief", "Reviewed by / Comments", "Reviewed by / Date", "Remarks"];
        record.excelData = [[title, ...Array(18).fill("")], [`For the Fiscal Year ${new Date().getFullYear()}`, ...Array(18).fill("")], [`As of ${formattedDate}`, ...Array(18).fill("")], headers, Array(19).fill("")];
        record.mergeCells = { A1: [19, 1], A2: [19, 1], A3: [19, 1] };
        record.style = { 'A1': 'text-align: center; font-weight: bold; font-size: 16px;', 'A2': 'text-align: center; font-weight: bold;', 'A3': 'text-align: center; font-weight: bold;' };
        const columns = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S'];
        columns.forEach(col => record.style[`${col}4`] = 'background-color: #ffff00; font-weight: bold; text-align: center;');
    }

    currentSpreadsheet = jspreadsheet(container, {
        data: record.excelData,
        minDimensions: [19, 20], 
        defaultColWidth: 140, 
        tableOverflow: true, 
        tableWidth: "100%", 
        tableHeight: "400px",
        columnDrag: true, 
        rowDrag: true, 
        allowInsertRow: true, 
        allowInsertColumn: true,
        style: record.style || {}, 
        mergeCells: record.mergeCells || {}, 
        responsive: true
    });
}

function closeModal() {
    if (currentSpreadsheet && currentOpenRecordId) {
        const record = mockDatabase.find(item => item.id === currentOpenRecordId);
        if (record) {
            record.excelData = currentSpreadsheet.getData();
            record.headers = currentSpreadsheet.getHeaders().split(',');
            record.style = currentSpreadsheet.getStyle();
            record.mergeCells = currentSpreadsheet.getConfig().mergeCells || {};
        }
    }
    saveToMemory();
    document.getElementById('fileModal').style.display = 'none';
    currentOpenRecordId = null;
}

function changeRecordStatus(newStatus) {
    const record = mockDatabase.find(item => item.id === currentOpenRecordId);
    if (record && record.status !== newStatus) {
        record.status = newStatus;
        if (!record.logs) record.logs = [];
        record.logs.push({ date: new Date().toLocaleString(), message: `System: Status changed to ${newStatus}` });
        saveToMemory(); 
        searchRecords(); 
        renderLogs(record.logs); 
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
    if (!currentOpenRecordId) return;
    const input = document.getElementById('newLogInput');
    if (!input.value.trim()) return;
    const record = mockDatabase.find(item => item.id === currentOpenRecordId);
    if (record) {
        if (!record.logs) record.logs = [];
        record.logs.push({ date: new Date().toLocaleString(), message: input.value.trim() });
        saveToMemory(); renderLogs(record.logs); input.value = ""; 
    }
}

// --- DELETE & RECYCLE BIN ---
function deleteCurrentRecord() {
    if (!currentOpenRecordId) return;
    
    if(confirm("Move this record to the Recycle Bin? It will be permanently deleted after 30 days.")) {
        try {
            const record = mockDatabase.find(c => c.id === currentOpenRecordId);
            
            // If record has API ID, call API delete
            if (record && record.api_id && currentToken) {
                fetch(`${API_BASE_URL}/audit/${record.api_id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${currentToken}` }
                }).then(res => {
                    if (!res.ok) throw new Error('Server delete failed');
                    // Update local database
                    record.deleted = true;
                    record.deletedAt = new Date().toISOString();
                    saveToMemory();
                    closeModal();
                    renderSidebar();
                    searchRecords();
                }).catch(err => {
                    console.error('Delete error:', err);
                    alert('Error deleting record');
                });
            } else {
                // Fallback to local deletion
                record.deleted = true;
                record.deletedAt = new Date().toISOString();
                saveToMemory();
                closeModal();
                renderSidebar();
                searchRecords();
            }
        } catch (error) {
            console.error('Delete error:', error);
            alert('Error deleting record');
        }
    }
}

function restoreRecord(id, event) {
    event.stopPropagation();
    const record = mockDatabase.find(c => c.id === id);
    record.deleted = false; record.deletedAt = null;
    saveToMemory(); renderSidebar(); searchRecords();
}

function permanentlyDelete(id, event) {
    event.stopPropagation();
    if(confirm("Are you sure you want to PERMANENTLY delete this record? This cannot be undone.")) {
        mockDatabase = mockDatabase.filter(c => c.id !== id);
        saveToMemory(); renderSidebar(); searchRecords();
    }
}

function emptyBin() {
    if(confirm("Are you sure you want to permanently delete ALL items in the Recycle Bin?")) {
        mockDatabase = mockDatabase.filter(c => !c.deleted);
        saveToMemory(); renderSidebar(); searchRecords();
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
        if (currentOpenRecordId) {
            const record = mockDatabase.find(item => item.id === currentOpenRecordId);
            record.excelData = jsonData; record.headers = null; record.style = null; record.mergeCells = null; saveToMemory();
        }
        const container = document.getElementById('excelViewer');
        container.innerHTML = ""; if (currentSpreadsheet) currentSpreadsheet.destroy();
        currentSpreadsheet = jspreadsheet(container, { data: jsonData, minDimensions: [19, 20], defaultColWidth: 140, tableOverflow: true, tableWidth: "100%", tableHeight: "400px", responsive: true });
    };
    reader.readAsArrayBuffer(file);
}

function exportExcel() {
    if (!currentOpenRecordId || !currentSpreadsheet) return;
    
    const record = mockDatabase.find(item => item.id === currentOpenRecordId);
    const data = currentSpreadsheet.getData();
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    
    if (record.mergeCells) {
        worksheet['!merges'] = [];
        for (const [cell, span] of Object.entries(record.mergeCells)) {
            const decoded = XLSX.utils.decode_cell(cell); 
            worksheet['!merges'].push({
                s: { r: decoded.r, c: decoded.c },
                e: { r: decoded.r + (span[1] || 1) - 1, c: decoded.c + span[0] - 1 }
            });
        }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "AuditData");
    XLSX.writeFile(workbook, `${record.serial}_Audit_Data.xlsx`);
}

function generatePDF() {
    if (!currentOpenRecordId) return;
    const record = mockDatabase.find(item => item.id === currentOpenRecordId);
    let logsHTML = record.logs.map(log => `<p style="font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 5px;"><strong style="color: #555;">${log.date}</strong><br>${log.message}</p>`).join('');
    if(!logsHTML) logsHTML = "<p style='font-style: italic; color: #777;'>No audit logs recorded.</p>";
    const statusColor = record.status === 'Approved' ? '#059669' : record.status === 'Rejected' ? '#dc2626' : '#d97706';

    const element = document.createElement('div');
    element.style.padding = '50px'; element.style.fontFamily = 'Helvetica, Arial, sans-serif'; element.style.color = '#333';
    element.innerHTML = `
        <div style="text-align: center; border-bottom: 3px solid #800000; padding-bottom: 20px; margin-bottom: 30px;">
            <h1 style="color: #800000; margin: 0; font-size: 32px;">PUP INTERNAL AUDIT</h1><h3 style="color: #555; margin: 5px 0 0 0; text-transform: uppercase;">Executive Record Summary</h3>
        </div>
        <table style="width: 100%; margin-bottom: 30px; border-collapse: collapse; font-size: 15px;">
            <tr><td style="padding: 12px; border: 1px solid #ccc; background: #f9f9f9; font-weight: bold; width: 180px;">Serial Number:</td><td style="padding: 12px; border: 1px solid #ccc; font-family: monospace;">${record.serial}</td></tr>
            <tr><td style="padding: 12px; border: 1px solid #ccc; background: #f9f9f9; font-weight: bold;">Record Title:</td><td style="padding: 12px; border: 1px solid #ccc; font-weight: bold;">${record.name}</td></tr>
            <tr><td style="padding: 12px; border: 1px solid #ccc; background: #f9f9f9; font-weight: bold;">Audit Type:</td><td style="padding: 12px; border: 1px solid #ccc;">${record.type}</td></tr>
            <tr><td style="padding: 12px; border: 1px solid #ccc; background: #f9f9f9; font-weight: bold;">Date Submitted:</td><td style="padding: 12px; border: 1px solid #ccc;">${record.date}</td></tr>
            <tr><td style="padding: 12px; border: 1px solid #ccc; background: #f9f9f9; font-weight: bold;">Status:</td><td style="padding: 12px; border: 1px solid #ccc; font-weight: bold; color: ${statusColor}; text-transform: uppercase;">${record.status}</td></tr>
        </table>
        <h3 style="color: #800000; border-bottom: 1px solid #ccc; padding-bottom: 8px;">Executive Overview</h3>
        <p style="background: #f4f7f6; padding: 20px; border-left: 5px solid #800000; line-height: 1.6; white-space: pre-wrap;">${record.summary}</p>
        <h3 style="color: #800000; border-bottom: 1px solid #ccc; padding-bottom: 8px;">Audit Trail & Remarks</h3>${logsHTML}
    `;

    const btn = document.getElementById('pdfBtn'); const originalText = btn.innerHTML; btn.innerHTML = "⏳ Generating..."; btn.style.opacity = "0.7";
    html2pdf().set({ margin: 0, filename: `${record.serial}_Summary.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' } }).from(element).save().then(() => { btn.innerHTML = originalText; btn.style.opacity = "1"; });
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