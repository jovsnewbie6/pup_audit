// ============ GLOBAL STATE VARIABLES ============
var currentUser = null;
var currentToken = localStorage.getItem('authToken') || null;
let mockDatabase = JSON.parse(localStorage.getItem('pupDatabase')) || [];
var API_BASE_URL = window.location.origin + '/api'; 

// ============ WEBSOCKET/SOCKET.IO CONNECTION ============
let socket = null;
let socketConnected = false;
let pollInterval = null;

function initializeWebSocket() {
    socket = io(window.location.origin, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5
    });

    socket.on('connect', () => {
        socketConnected = true;
        console.log('✅ Connected to server via WebSocket');
        console.log('Socket ID:', socket.id);
        showNotification('🔗 Connected to real-time sync');
        // Stop polling if Socket.io is working
        if (pollInterval) {
            clearInterval(pollInterval);
            console.log('⏹️ Stopping fallback polling - Socket.io is active');
            pollInterval = null;
        }
    });

    socket.on('disconnect', () => {
        socketConnected = false;
        console.log('❌ Disconnected from server');
        showNotification('⚠️ Lost real-time connection - using fallback sync');
        // Start polling if Socket.io disconnects
        if (!pollInterval) {
            startFallbackPolling();
        }
    });

    socket.on('connect_error', (error) => {
        console.error('❌ WebSocket connection error:', error);
        // Start polling if Socket.io fails
        if (!pollInterval) {
            startFallbackPolling();
        }
    });

    socket.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
    });

    // Fallback polling - check server every 10 seconds if Socket.io isn't connected
    if (!socketConnected) {
        startFallbackPolling();
    }

    // Listen for new records created by other users
    socket.on('recordCreated', (newRecord) => {
        console.log('📨 Socket.io: New record broadcast received from server');
        console.log('   Record:', newRecord);
        
        // Add the new record to mockDatabase if it's not already there
        const exists = mockDatabase.some(r => r.id === newRecord.id || r.serial === newRecord.serial);
        console.log('   Already exists in local DB?', exists);
        
        if (!exists) {
            const formattedRecord = {
                id: newRecord.id,
                serial: newRecord.serial,
                type: newRecord.type,
                name: newRecord.name,
                date: newRecord.date,
                status: newRecord.status,
                summary: `Audit record for ${newRecord.name}`,
                logs: [],
                excelData: null,
                style: {},
                mergeCells: null,
                deleted: false,
                deletedAt: null,
                api_id: newRecord.id
            };
            
            // Try to parse data if it's a JSON string
            if (newRecord.data) {
                try {
                    const parsedData = typeof newRecord.data === 'string' ? JSON.parse(newRecord.data) : newRecord.data;
                    formattedRecord.excelData = parsedData.excelData;
                    formattedRecord.style = parsedData.style || {};
                    formattedRecord.mergeCells = parsedData.mergeCells;
                    formattedRecord.summary = parsedData.summary || formattedRecord.summary;
                } catch (e) {
                    console.log('Could not parse data, using defaults');
                }
            }
            
            mockDatabase.push(formattedRecord);
            console.log('✅ Record added to local database. Total records:', mockDatabase.length);
            saveToMemory();
            
            // Refresh the UI if we're viewing the same record type
            if (currentTab === newRecord.type) {
                console.log('📊 Refreshing UI because currentTab matches');
                searchRecords();
                showNotification(`✨ New ${newRecord.type} record: ${newRecord.name}`);
            } else {
                console.log('⚠️ Not refreshing UI - viewing different tab:', currentTab, 'vs', newRecord.type);
            }
        } else {
            console.log('⚠️ Record already exists locally, skipping');
        }
    });

    // Listen for record updates (status changes, approvals, etc.)
    socket.on('recordUpdated', (updatedRecord) => {
        console.log('📨 Record updated:', updatedRecord.name);
        
        const recordIndex = mockDatabase.findIndex(r => r.id === updatedRecord.id || r.api_id === updatedRecord.id);
        if (recordIndex !== -1) {
            mockDatabase[recordIndex].status = updatedRecord.status;
            
            // Update other fields if provided
            if (updatedRecord.data) {
                try {
                    const parsedData = typeof updatedRecord.data === 'string' ? JSON.parse(updatedRecord.data) : updatedRecord.data;
                    mockDatabase[recordIndex].excelData = parsedData.excelData || mockDatabase[recordIndex].excelData;
                    mockDatabase[recordIndex].style = parsedData.style || mockDatabase[recordIndex].style;
                    mockDatabase[recordIndex].mergeCells = parsedData.mergeCells || mockDatabase[recordIndex].mergeCells;
                    mockDatabase[recordIndex].summary = parsedData.summary || mockDatabase[recordIndex].summary;
                } catch (e) {
                    console.log('Could not parse update data');
                }
            }
            
            saveToMemory();
            searchRecords();
            
            const statusLabel = updatedRecord.status || 'Unknown';
            showNotification(`${updatedRecord.name} status changed to: ${statusLabel}`);
        }
    });

    // Listen for record deletions from other users
    socket.on('recordDeleted', (deletedRecord) => {
        console.log('📨 Record deleted on server:', deletedRecord.id || deletedRecord);
        
        // Match by either id or api_id
        const recordIndex = mockDatabase.findIndex(r => 
            r.id === deletedRecord.id || 
            r.api_id === deletedRecord.id ||
            (deletedRecord.api_id && r.api_id === deletedRecord.api_id)
        );
        
        if (recordIndex !== -1) {
            console.log('✓ Found record in local database, marking as deleted');
            mockDatabase[recordIndex].deleted = true;
            mockDatabase[recordIndex].deletedAt = new Date().toISOString();
            saveToMemory();
            
            // Refresh the view
            if (currentTab === mockDatabase[recordIndex].type) {
                searchRecords();
            }
            
            showNotification('A record was moved to the recycle bin');
        } else {
            console.log('⚠ Record not found in local database, refreshing view');
            // Refresh the current view
            searchRecords();
        }
    });

    // Listen for new audit logs/comments added by other users
    socket.on('logAdded', (event) => {
        console.log('📨 New audit log received:', event.log.comment);
        
        // If the modal is open and it's the same record, add the log to the display
        if (currentOpenRecordId === event.recordId) {
            const logContainer = document.getElementById('logHistory');
            if (logContainer) {
                const div = document.createElement('div');
                div.className = 'log-entry';
                const logDate = new Date(event.log.created_at).toLocaleString();
                div.innerHTML = `<span class="timestamp">${logDate} - ${event.log.username}</span><span class="message">${event.log.comment}</span>`;
                logContainer.appendChild(div);
                logContainer.scrollTop = logContainer.scrollHeight;
                showNotification(`New comment on ${mockDatabase.find(r => r.id === event.recordId)?.name || 'record'}`);
            }
        }
    });

    // Auto-refresh records every 5 seconds to show updates from other users
    setInterval(() => {
        if (currentTab && document.getElementById('resultsContainer')) {
            searchRecords();
        }
    }, 5000);
}

// Fallback polling if Socket.io doesn't work
function startFallbackPolling() {
    if (pollInterval) return; // Already polling
    
    console.log('🔄 Starting fallback polling (Socket.io not connected)');
    pollInterval = setInterval(async () => {
        if (socketConnected) {
            // Socket.io is now connected, stop polling
            clearInterval(pollInterval);
            pollInterval = null;
            console.log('✅ Socket.io reconnected, stopping fallback poll');
            return;
        }
        
        if (!currentToken || !document.getElementById('appContainer') || document.getElementById('appContainer').style.display === 'none') {
            return; // Not logged in or viewing wrong page
        }
        
        try {
            // Check server for new records
            const freshRecords = await loadRecordsFromAPI();
            if (freshRecords) {
                // Check if there are any NEW records not in mockDatabase
                const newRecords = freshRecords.filter(sr => 
                    !mockDatabase.some(lr => lr.api_id === sr.id || lr.id === sr.id)
                );
                
                if (newRecords.length > 0) {
                    console.log('📥 Fallback poll found', newRecords.length, 'new records');
                    mockDatabase = freshRecords;
                    saveToMemory();
                    if (currentTab && document.getElementById('resultsContainer')) {
                        searchRecords();
                    }
                }
            }
        } catch (error) {
            console.error('Poll error:', error);
        }
    }, 10000); // Poll every 10 seconds
}

function showNotification(message) {
    // Create a simple notification at the top of the page
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        z-index: 10000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        animation: slideIn 0.3s ease-in-out;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-in-out';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

// Add animation styles if they don't exist
if (!document.querySelector('style[data-websocket-animations]')) {
    const style = document.createElement('style');
    style.setAttribute('data-websocket-animations', 'true');
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
}

// ============ AUTHENTICATION FUNCTIONS ============

// New function to dynamically fetch users
async function populateLoginDropdown() {
    const dropdown = document.getElementById('loginUsername');
    // Safety check to make sure the dropdown actually exists on the page
    if (!dropdown || dropdown.tagName !== 'SELECT') return;

    try {
        const response = await fetch(`${API_BASE_URL}/auth/public-users`);
        if (response.ok) {
            const users = await response.json();
            
            // Clear the old hardcoded HTML options and reset to default
            dropdown.innerHTML = '<option value="" disabled selected>Select your account...</option>';
            
            // Loop through the database results and create a new option for each user
            users.forEach(user => {
                const option = document.createElement('option');
                option.value = user.username;
                option.textContent = user.username; 
                dropdown.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Failed to fetch users for dropdown:', error);
    }
}

// Updated interface function
function showAuthInterface() {
    document.getElementById('authContainer').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
    
    // Call the new function every time the login screen appears!
    populateLoginDropdown(); 
}

function showMainInterface() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('appContainer').style.display = 'flex';
    
    // Update user info in header
    if (currentUser) {
        document.getElementById('userName').innerText = currentUser.username;
        document.getElementById('userRole').innerText = currentUser.role;
        
        // Update role badge color based on role
        const roleEl = document.getElementById('userRole');
        if (currentUser.role === 'Audit Supervisor') {
            roleEl.className = 'role-badge role-supervisor';
        } else {
            roleEl.className = 'role-badge role-auditor';
        }
    }
    
    // Initialize WebSocket connection when showing main interface
    if (!socket) {
        initializeWebSocket();
    }
    
    const adminBtn = document.getElementById('permissionsBtn');
    if (adminBtn && currentUser && currentUser.role === 'Audit Supervisor') {
        adminBtn.style.display = 'inline-block';
    } else if (adminBtn) {
        adminBtn.style.display = 'none';
    }
}

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

async function handleRegister(event) {
    event.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorEl = document.getElementById('registerError');
    
    if (password !== confirmPassword) {
        errorEl.textContent = 'Passwords do not match';
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ username, password, role: 'Staff Auditor' })
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

function handleLogout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    currentToken = null;
    currentUser = null;
    showAuthInterface();
}

// Alias for logout button
function logout() {
    handleLogout();
}

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

async function loadRecordsFromAPI() {
    if (!currentUser || !currentToken) return null;
    
    try {
        const response = await apiCall('/audit');
        if (!response) return null;
        
        if (response.ok) {
            const records = await response.json();
            
            // This safely translates the database columns into the exact format your frontend needs
            return records.map(record => ({
                id: record.id || Date.now(),
                serial: record.serial || record.serial_number || "Unknown Serial",
                type: record.type || record.record_type || "Reimbursement",
                name: record.name || record.record_name || "Untitled Record",
                date: record.date || (record.created_at ? record.created_at.split('T')[0] : new Date().toISOString().split('T')[0]),
                summary: record.summary || `Audit record for ${record.name || record.record_name}`,
                status: record.status || "Pending",
                logs: record.logs || [],
                excelData: record.excelData || record.excel_data || null,
                style: record.style || {},
                mergeCells: record.mergeCells || record.merge_cells || null,
                deleted: record.deleted || record.is_deleted || false,
                deletedAt: record.deletedAt || record.deleted_at || null,
                api_id: record.id
            }));
        }
    } catch (error) {
        console.error('Failed to load records from API:', error);
        return null;
    }
}

const originalDOMContentLoaded = document.addEventListener.bind(document);
document.addEventListener = function(event, handler) {
    if (event === 'DOMContentLoaded') {
        return originalDOMContentLoaded(event, async () => {
            initializeAuth();
            
            if (currentToken && currentUser) {
                const apiRecords = await loadRecordsFromAPI();
                if (apiRecords) {
                    mockDatabase = apiRecords;
                } else {
                    mockDatabase = JSON.parse(localStorage.getItem('pupDatabase')) || [];
                }
            } else {
                mockDatabase = JSON.parse(localStorage.getItem('pupDatabase')) || [];
            }
            
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
    
    if (currentUser && currentToken) {
        syncRecordsToAPI();
    }
}

async function syncRecordsToAPI() {}

function canDeleteRecords() {
    if (!currentUser) return false;
    if (currentUser.role === 'Audit Supervisor') return true;
    return false;
}

document.addEventListener('DOMContentLoaded', async () => {
    // First, try to load fresh records from the server
    if (currentToken) {
        console.log('📥 Refreshing records from server...');
        const freshRecords = await loadRecordsFromAPI();
        if (freshRecords && freshRecords.length > 0) {
            console.log('✅ Loaded', freshRecords.length, 'records from server');
            mockDatabase = freshRecords;
            saveToMemory();
        } else if (freshRecords) {
            console.log('ℹ️ Server has no records yet');
            mockDatabase = [];
            saveToMemory();
        } else {
            console.log('⚠️ Could not load from server, using local cache');
        }
    } else {
        console.log('⚠️ No auth token, waiting for login');
    }
    
    renderSidebar(); 
    searchRecords(); 
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

window.addEventListener('click', function(event) { 
    if (event.target == document.getElementById('addModal')) closeAddModal(); 
    if (event.target == document.getElementById('addRowModal')) closeAddRowModal(); 
    if (event.target == document.getElementById('passwordModal')) closePasswordModal();
    if (event.target == document.getElementById('settingsModal')) closeSettingsModal();
});

async function submitNewRecord(event) {
    event.preventDefault(); 
    
    try {
        const getValue = (id) => document.getElementById(id) ? document.getElementById(id).value : "";

        let dynamicName = getValue('f_project') || "Untitled Record";
        let dynamicDate = getValue('f_dateAssign') || getValue('f_checkDate') || new Date().toISOString().split('T')[0];

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
                    if (!isNaN(num) && num > maxSequence) maxSequence = num;
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
            reader.onload = async function(e) {
                const workbook = XLSX.read(new Uint8Array(e.target.result), {type: 'array'});
                newRecord.excelData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
                
                mockDatabase.push(newRecord); 
                const saved = await saveRecordToServer(newRecord);
                if (saved) {
                    // Refresh from server immediately to ensure new record appears without waiting for socket broadcast
                    const freshRecords = await loadRecordsFromAPI();
                    if (freshRecords) {
                        mockDatabase = freshRecords;
                        saveToMemory();
                    }
                }
                finishSubmission();
            };
            reader.readAsArrayBuffer(fileInput.files[0]);
            
        } else {
            // Updated row matching your 20 new columns
            const rowData = [
                getValue('f_no'), getValue('f_checkDate'), "", getValue('f_officer'), 
                getValue('f_transType'), getValue('f_soNum'), getValue('f_soDate'), getValue('f_project'), 
                getValue('f_incDates'), "", getValue('f_amtGranted'), getValue('f_amtLiq'), 
                getValue('f_auditor'), getValue('f_dateAssign'), "", "", "", "", "", ""
            ];

            const formattedDate = new Date(dynamicDate).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
            
            // Your exact new 20 headers
            const headers = [
                "No.", "Check Date", "Check Number", "Accountable Person", "Transaction Type", 
                "SO Number", "SO Date", "Project Description", "Inclusive Dates", "Location", 
                "Approved Budget", "Amount", "Auditor", "Date Assigned", "Date Audited", 
                "Audit Result", "Date forwarded to the Chief", "Reviewed by \\ Comments", 
                "Reviewed by \\ Dates", "Remarks"
            ];
            
            newRecord.excelData = [
                [`SUMMARY OF AUDIT REPORT - ${currentTab.toUpperCase()}S`, ...Array(19).fill("")],
                [`For the Fiscal Year ${yearStr}`, ...Array(19).fill("")],
                [`As of ${formattedDate}`, ...Array(19).fill("")],
                headers, 
                rowData
            ];
            
            // Extends the styling out to 20 columns (A through T)
            newRecord.mergeCells = { A1: [20, 1], A2: [20, 1], A3: [20, 1] };
            newRecord.style = { 'A1': 'text-align: center; font-weight: bold; font-size: 16px;', 'A2': 'text-align: center; font-weight: bold;', 'A3': 'text-align: center; font-weight: bold;' };
            const columns = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T'];
            columns.forEach(col => newRecord.style[`${col}4`] = 'background-color: #ffff00; font-weight: bold; text-align: center;');
            
            mockDatabase.push(newRecord); 
            const saved = await saveRecordToServer(newRecord);
            if (saved) {
                // Refresh from server immediately to ensure new record appears without waiting for socket broadcast
                const freshRecords = await loadRecordsFromAPI();
                if (freshRecords) {
                    mockDatabase = freshRecords;
                    saveToMemory();
                }
            }
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
        
        // Match the 20 columns
        const rowData = [
            getValue('r_no'), getValue('r_checkDate'), "", getValue('r_officer'), 
            getValue('r_transType'), getValue('r_soNum'), getValue('r_soDate'), getValue('r_project'), 
            getValue('r_incDates'), "", getValue('r_amtGranted'), getValue('r_amtLiq'), 
            getValue('r_auditor'), getValue('r_dateAssign'), "", "", "", "", "", ""
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
    
    // Store previous Excel data for change detection
    record.previousExcelData = record.excelData ? JSON.parse(JSON.stringify(record.excelData)) : [];
    
    document.getElementById('fileModal').style.display = 'block';
    document.getElementById('modalTitle').innerText = `[${record.serial}] Audit Worksheet: ${record.name}`;
    document.getElementById('recordStatusDropdown').value = record.status || "Pending";
    
    // Fetch logs from server if record has api_id
    if (record.api_id) {
        fetchLogsFromServer(id, record.api_id);
    } else {
        renderLogs(record.logs);
    }
    
    const deleteBtn = document.querySelector('.delete-btn');
    if (deleteBtn) {
        if (canDeleteRecords()) {
            deleteBtn.style.display = 'inline-block';
        } else {
            deleteBtn.style.display = 'none';
        }
    }
    
    const container = document.getElementById('excelViewer');
    container.innerHTML = "";
    if (currentSpreadsheet) currentSpreadsheet.destroy();

    if (!record.excelData || record.excelData.length === 0) {
        const title = `SUMMARY OF AUDIT REPORT - ${currentTab.toUpperCase()}S`;
        const formattedDate = record.date ? new Date(record.date).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }) : new Date().toLocaleDateString();
        
        const headers = [
            "No.", "Check Date", "Check Number", "Accountable Person", "Transaction Type", 
            "SO Number", "SO Date", "Project Description", "Inclusive Dates", "Location", 
            "Approved Budget", "Amount", "Auditor", "Date Assigned", "Date Audited", 
            "Audit Result", "Date forwarded to the Chief", "Reviewed by \\ Comments", 
            "Reviewed by \\ Dates", "Remarks"
        ];
        
        record.excelData = [
            [title, ...Array(19).fill("")], 
            [`For the Fiscal Year ${new Date().getFullYear()}`, ...Array(19).fill("")], 
            [`As of ${formattedDate}`, ...Array(19).fill("")], 
            headers, 
            Array(20).fill("")
        ];
        
        record.mergeCells = { A1: [20, 1], A2: [20, 1], A3: [20, 1] };
        record.style = { 'A1': 'text-align: center; font-weight: bold; font-size: 16px;', 'A2': 'text-align: center; font-weight: bold;', 'A3': 'text-align: center; font-weight: bold;' };
        const columns = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T'];
        columns.forEach(col => record.style[`${col}4`] = 'background-color: #ffff00; font-weight: bold; text-align: center;');
    }

   let loadingSpreadsheet = true; 
    
    // 1. Determine if the current viewer is a restricted Staff Auditor
    const isStaff = currentUser && currentUser.role !== 'Audit Supervisor';
    
    // 2. Generate dynamic column permissions
    const columnConfig = [];
    for (let i = 0; i < 20; i++) {
        columnConfig.push({
            type: 'text',
            width: 140,
            // Lock columns A through N (0-13) if the user is a Staff Auditor.
            // Columns O through T (14-19) remain editable for their audit work.
            readOnly: isStaff && i <= 13 
        });
    }

    currentSpreadsheet = jspreadsheet(container, {
        data: record.excelData,
        minDimensions: [20, 20], 
        columns: columnConfig, // Inject the dynamic security permissions
        tableOverflow: true, 
        tableWidth: "100%", 
        tableHeight: "400px",
        columnDrag: !isStaff, // Prevent staff from dragging locked columns to unlocked zones
        rowDrag: !isStaff, 
        allowInsertRow: !isStaff, // Prevent staff from injecting blank rows
        allowInsertColumn: false,
        style: record.style || {}, 
        mergeCells: record.mergeCells || {}, 
        responsive: true,
        onchange: function(instance, cell, x, y, value) {
            if (loadingSpreadsheet) return; 
            if (!record.api_id) return; 
            
            const colLetter = String.fromCharCode(65 + parseInt(x));
            const rowNum = parseInt(y) + 1;
            const cellRef = `${colLetter}${rowNum}`;
            
            const message = value === "" 
                ? `System: Cleared cell ${cellRef}` 
                : `System: Updated Excel cell ${cellRef} to "${value}"`;
            
            // Only send the lightweight log to the server in real-time to prevent server crashes
            // (The actual heavy Excel data will safely sync when they close the modal)
            sendCommentToServer(record.api_id, message, (success) => {
                if (!success) console.error(`Failed to log cell edit: ${cellRef}`);
            });
        }
    });
    loadingSpreadsheet = false;

}

// Detect changes in Excel data and create audit log entries
function detectAndLogChanges(record, newData) {
    const oldData = record.previousExcelData || record.excelData || [];
    const changes = [];
    
    // Compare cell values between old and new data
    for (let row = 0; row < Math.max(oldData.length, newData.length); row++) {
        const oldRow = oldData[row] || [];
        const newRow = newData[row] || [];
        
        for (let col = 0; col < Math.max(oldRow.length, newRow.length); col++) {
            const oldVal = oldRow[col] || '';
            const newVal = newRow[col] || '';
            
            if (String(oldVal).trim() !== String(newVal).trim()) {
                // Convert column index to letter (0=A, 1=B, etc)
                const colLetter = String.fromCharCode(65 + col);
                const cellRef = `${colLetter}${row + 1}`;
                changes.push({
                    cell: cellRef,
                    oldVal: String(oldVal).substring(0, 50), // Truncate for readability
                    newVal: String(newVal).substring(0, 50)
                });
            }
        }
    }
    
    // Create audit log entries for changes
    if (changes.length > 0 && currentUser) {
        if (!record.logs) record.logs = [];
        
        // Group changes summary
        const summary = changes.length <= 5 
            ? changes.map(c => `${c.cell}: "${c.oldVal}" → "${c.newVal}"`).join('; ')
            : `${changes.length} cells modified`;
        
        const editMessage = `${currentUser.username} edited Excel data: ${summary}`;
        record.logs.push({ 
            date: new Date().toLocaleString(), 
            message: editMessage,
            username: currentUser.username
        });
        
        // Send to server as a system comment
        if (record.api_id && currentToken) {
            fetch(`${API_BASE_URL}/audit/${record.api_id}/logs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                },
                body: JSON.stringify({ comment: editMessage })
            }).catch(err => console.log('Note: Could not post edit summary to server'));
        }
    }
}

function toggleAuditLog() {
    const logHistory = document.getElementById('logHistory');
    const logInput = document.querySelector('.log-input-area');
    const collapseBtn = document.getElementById('auditLogCollapseBtn');
    
    if (logHistory && logInput && collapseBtn) {
        logHistory.classList.toggle('collapsed');
        logInput.classList.toggle('collapsed');
        collapseBtn.classList.toggle('collapsed');
    }
}

function closeModal() {
    if (currentSpreadsheet && currentOpenRecordId) {
        const record = mockDatabase.find(item => item.id === currentOpenRecordId);
        if (record) {
            const newExcelData = currentSpreadsheet.getData();
            
            // Detect and log changes before updating
            detectAndLogChanges(record, newExcelData);
            
            record.excelData = newExcelData;
            record.headers = currentSpreadsheet.getHeaders().split(',');
            record.style = currentSpreadsheet.getStyle();
            record.mergeCells = currentSpreadsheet.getConfig().mergeCells || {};
            
            // Sync Excel data changes to server for real-time broadcast
            updateRecordOnServer(record, 'Excel data updated');
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
        // Sync status change to server for real-time broadcast
        updateRecordOnServer(record, `Status changed to ${newStatus}`);
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
        const messageText = log.message || log.comment || '';
        div.className = `log-entry ${messageText.startsWith("System:") ? 'system-log' : ''}`;
        const logDate = log.date || log.created_at;
        const displayDate = typeof logDate === 'string' ? new Date(logDate).toLocaleString() : logDate;
        const username = log.username ? ` - ${log.username}` : '';
        div.innerHTML = `<span class="timestamp">${displayDate}${username}</span><span class="message">${messageText}</span>`;
        container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
}

async function fetchLogsFromServer(recordId, recordApiId) {
    if (!recordApiId || !currentToken) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/audit/${recordApiId}/logs`, {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });

        if (response.ok) {
            const logs = await response.json();
            const record = mockDatabase.find(r => r.id === recordId);
            if (record) {
                record.logs = logs;
                if (currentOpenRecordId === recordId) {
                    renderLogs(record.logs);
                }
            }
        }
    } catch (err) {
        console.error('Error fetching logs:', err);
    }
}

function addAuditLog() {
    if (!currentOpenRecordId) return;
    const input = document.getElementById('newLogInput');
    if (!input.value.trim()) return;
    const record = mockDatabase.find(item => item.id === currentOpenRecordId);
    if (record) {
        if (!record.logs) record.logs = [];
        const comment = input.value.trim();
        
        // Clear input immediately for better UX
        input.value = "";
        input.disabled = true;
        
        // Send comment to server
        sendCommentToServer(record.api_id, comment, (success) => {
            input.disabled = false;
            if (success) {
                // Comment was sent and will be broadcast by socket.io
                console.log('✓ Comment sent to server');
            } else {
                // If server fails, add locally but mark as pending
                record.logs.push({ 
                    date: new Date().toLocaleString(), 
                    message: `[PENDING] ${comment}`,
                    pending: true
                });
                renderLogs(record.logs);
                showNotification('Comment saved locally (pending sync)');
            }
        });
    }
}

async function sendCommentToServer(recordApiId, comment, callback) {
    if (!recordApiId || !currentToken) {
        callback(false);
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/audit/${recordApiId}/logs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ comment })
        });

        if (response.ok) {
            console.log('✓ Comment posted to server');
            callback(true);
        } else {
            console.error('Failed to post comment to server');
            callback(false);
        }
    } catch (err) {
        console.error('Error posting comment:', err);
        callback(false);
    }
}

// --- DELETE & RECYCLE BIN ---
async function deleteCurrentRecord() {
    if (!currentOpenRecordId) return;
    
    if(confirm("Move this record to the Recycle Bin? It will be permanently deleted after 30 days.")) {
        try {
            const record = mockDatabase.find(c => c.id === currentOpenRecordId);
            
            if (record && record.api_id && currentToken) {
                const response = await apiCall(`/audit/${record.api_id}`, {
                    method: 'DELETE'
                });
                
                if (!response.ok) {
                    alert('Failed to delete record on server');
                    return;
                }
            }
            
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
        currentSpreadsheet = jspreadsheet(container, { data: jsonData, minDimensions: [20, 20], defaultColWidth: 140, tableOverflow: true, tableWidth: "100%", tableHeight: "400px", responsive: true });
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

// ============ USER SETTINGS & PASSWORD ============

function openPasswordModal() {
    // Password management moved to User Settings modal
    openSettingsModal();
}

function closePasswordModal() {
    // Deprecated: Password modal removed - now part of User Settings
    // This function kept for backwards compatibility
}

function openSettingsModal() {
    document.getElementById('settingsModal').style.display = 'block';
    if (currentUser) {
        document.getElementById('settingsUsername').innerText = currentUser.username;
        document.getElementById('settingsRole').innerText = currentUser.role;
    }
}

function closeSettingsModal() {
    document.getElementById('settingsModal').style.display = 'none';
    document.getElementById('passwordForm').reset();
    document.getElementById('passwordError').textContent = '';
}

async function handlePasswordChange(event) {
    event.preventDefault(); 
    
    const oldPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;
    const errorEl = document.getElementById('passwordError');
    
    if (newPassword !== confirmPassword) {
        errorEl.style.color = '#dc2626'; 
        errorEl.textContent = 'New passwords do not match!';
        return;
    }
    
    try {
        const response = await apiCall('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ oldPassword, newPassword })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            errorEl.style.color = '#059669'; 
            errorEl.textContent = 'Password updated successfully!';
            setTimeout(() => {
                closeSettingsModal();
            }, 1500);
        } else {
            errorEl.style.color = '#dc2626'; 
            errorEl.textContent = data.error || 'Failed to update password.';
        }
    } catch (error) {
        console.error('Password change error:', error);
        errorEl.style.color = '#dc2626'; 
        errorEl.textContent = 'Connection error. Please try again.';
    }
}

// ============ ADMIN USER MANAGEMENT ============

async function openPermissionsModal() {
    document.getElementById('permissionsModal').style.display = 'block';
    await loadUsersList();
}

function closePermissionsModal() {
    document.getElementById('permissionsModal').style.display = 'none';
    document.getElementById('adminRegisterForm').reset();
    document.getElementById('adminRegisterMsg').textContent = '';
}

async function loadUsersList() {
    const container = document.getElementById('permissionsContainer');
    container.innerHTML = '<p>Loading users...</p>';

    try {
        const response = await apiCall('/auth/users');
        if (!response) throw new Error("No response from server");
        
        const users = await response.json();
        
        if (response.ok) {
            let html = `
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
                    <tr style="background: #eee; text-align: left;">
                        <th style="padding: 10px; border-bottom: 2px solid #ddd;">Username</th>
                        <th style="padding: 10px; border-bottom: 2px solid #ddd;">Role</th>
                        <th style="padding: 10px; border-bottom: 2px solid #ddd;">Status</th>
                        <th style="padding: 10px; border-bottom: 2px solid #ddd;">Actions</th>
                    </tr>
            `;
            
            users.forEach(user => {
                const isMe = currentUser.username === user.username;
                html += `
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 10px;"><strong>${user.username}</strong> ${isMe ? '<span style="color:#888;">(You)</span>' : ''}</td>
                        <td style="padding: 10px;">${user.role}</td>
                        <td style="padding: 10px; font-weight: bold; color: ${user.is_active ? '#059669' : '#dc2626'}">
                            ${user.is_active ? 'Active' : 'Deactivated'}
                        </td>
                        <td style="padding: 10px;">
                            ${!isMe && user.is_active ? 
                                `<button onclick="deactivateAccount(${user.id})" class="danger-btn" style="padding: 4px 8px; font-size: 12px;">Deactivate</button>` 
                                : ''}
                        </td>
                    </tr>
                `;
            });
            
            html += `</table>`;
            container.innerHTML = html;
        } else {
            container.innerHTML = `<p style="color: #dc2626;">Error: ${users.error}</p>`;
        }
    } catch (error) {
        container.innerHTML = '<p style="color: #dc2626;">Failed to connect to the database.</p>';
    }
}

async function handleAdminRegister(event) {
    event.preventDefault();
    const username = document.getElementById('newUsername').value;
    const password = document.getElementById('newUserPassword').value;
    const role = document.getElementById('newUserRole').value;
    const msgEl = document.getElementById('adminRegisterMsg');
    
    msgEl.style.color = '#333';
    msgEl.textContent = 'Creating account...';
    
    try {
        const response = await apiCall('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, password, role })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            msgEl.style.color = '#059669'; 
            msgEl.textContent = 'Account successfully created!';
            document.getElementById('adminRegisterForm').reset();
            loadUsersList(); 
            setTimeout(() => msgEl.textContent = '', 3000);
        } else {
            msgEl.style.color = '#dc2626'; 
            msgEl.textContent = data.error || 'Username might already exist.';
        }
    } catch (error) {
        msgEl.style.color = '#dc2626';
        msgEl.textContent = 'Connection error.';
    }
}

async function deactivateAccount(userId) {
    if (!confirm("Are you sure you want to deactivate this account? They will be locked out immediately.")) return;
    
    try {
        const response = await apiCall(`/auth/deactivate-user/${userId}`, { method: 'POST' });
        if (response.ok) {
            loadUsersList(); 
        } else {
            alert("Failed to deactivate account.");
        }
    } catch (error) {
        alert("Connection error.");
    }
}

async function loadRecordsFromAPI() {
    if (!currentUser || !currentToken) return null;
    
    try {
        const response = await fetch(`${API_BASE_URL}/audit`, {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        if (!response.ok) return null;
        
        const records = await response.json();
        
        return records.map(record => {
            // Safely open the "data" package the database sent us
            let parsedData = {};
            if (record.data) {
                // If it accidentally got double-stringified, this fixes it
                parsedData = typeof record.data === 'string' ? JSON.parse(record.data) : record.data;
            }

            // Map the database columns to exactly what your frontend expects
            return {
                id: record.id || Date.now(),
                serial: record.serial_number || "Unknown Serial",
                type: record.record_type || "Reimbursement",
                name: record.record_name || "Untitled Record",
                date: parsedData.date || (record.created_at ? record.created_at.split('T')[0] : new Date().toISOString().split('T')[0]),
                summary: parsedData.summary || `Audit record generated for ${record.record_name}`,
                status: parsedData.status || record.status || "Pending",
                logs: [], 
                excelData: parsedData.excelData || null, // Pulls from inside the data package!
                style: parsedData.style || {},
                mergeCells: parsedData.mergeCells || null,
                deleted: record.is_deleted || false,
                api_id: record.id
            };
        });
    } catch (error) {
        console.error('Failed to load records from API:', error);
        return null;
    }
}

async function saveRecordToServer(record) {
    try {
        console.log('📤 Sending record to server:', record.name);
        const response = await fetch(`${API_BASE_URL}/audit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                record_name: record.name,
                record_type: record.type,
                // NOTE: serial_number is now generated on the SERVER for uniqueness!
                // serial_number: record.serial,  <- REMOVED
                data: {
                    excelData: record.excelData,
                    style: record.style,
                    mergeCells: record.mergeCells,
                    summary: record.summary,
                    date: record.date,
                    status: record.status
                }
            })
        });

        if (response.ok) {
            const savedRecord = await response.json();
            // Server returns the record WITH the generated serial_number
            record.api_id = savedRecord.id;
            record.serial = savedRecord.serial_number; // Get serial from server
            
            // Update in mockDatabase to ensure the api_id and serial are persisted
            const recordIndex = mockDatabase.findIndex(r => r.id === record.id);
            if (recordIndex !== -1) {
                mockDatabase[recordIndex].api_id = savedRecord.id;
                mockDatabase[recordIndex].serial = savedRecord.serial_number;
                saveToMemory();
            }
            console.log('✅ Record successfully saved to server with ID:', savedRecord.id);
            console.log('   Server-generated serial:', savedRecord.serial_number);
            console.log('⏳ Waiting for real-time sync broadcast from server...');
            return true;
        } else {
            try {
                const errorData = await response.json();
                console.error('❌ Server error (HTTP ' + response.status + '):', errorData.error || errorData);
                showNotification('❌ Error saving record: ' + (errorData.error || 'Unknown error'));
            } catch (e) {
                console.error('❌ Server error (HTTP ' + response.status + ') - Could not parse error response');
                showNotification('❌ Server error: HTTP ' + response.status);
            }
            return false;
        }
    } catch (err) {
        console.error('❌ Network error connecting to backend:', err.message);
        showNotification('❌ Connection error: ' + err.message);
        return false;
    }
}

// ============ UPDATE RECORD ON SERVER (For Real-Time Sync) ============
async function updateRecordOnServer(record, comment = '') {
    if (!record) return false;
    
    // If record doesn't have api_id yet, try to create it first
    if (!record.api_id) {
        if (!currentToken) {
            console.log('Not logged in, storing changes locally...');
            saveToMemory();
            return false;
        }
        
        // Try to save the record to server first
        console.log('Record not yet synced, creating on server first...');
        const created = await saveRecordToServer(record);
        if (!created) {
            console.log('Failed to create record on server, saving locally...');
            saveToMemory();
            return false;
        }
    }

    try {
        const response = await fetch(`${API_BASE_URL}/audit/${record.api_id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                status: record.status,
                data: {
                    excelData: record.excelData,
                    style: record.style,
                    mergeCells: record.mergeCells,
                    summary: record.summary,
                    date: record.date
                },
                comment: comment
            })
        });

        if (response.ok) {
            console.log('✓ Record updated on server:', record.api_id);
            saveToMemory();
            return true;
        } else {
            console.error('Failed to update record on server:', response.status);
            saveToMemory();
            return false;
        }
    } catch (err) {
        console.error('Error updating record on server:', err);
        saveToMemory();
        return false;
    }
}