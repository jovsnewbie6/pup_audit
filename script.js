// --- STATE MANAGEMENT ---
let currentTab = 'Reimbursement'; // Default tab on load
let currentOpenCaseId = null;     // Tracks which file is currently being viewed

// --- MOCK DATA --- 
// Using a safe placeholder image so your browser doesn't block the preview window
const mockDatabase = [
    { id: 1, type: "Reimbursement", name: "Outreach Program Expenses", date: "2026-05-10", summary: "Reimbursement for Community Outreach Program at PUP Maragondon Campus.", fileUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Flat_tick_icon.svg/512px-Flat_tick_icon.svg.png", comments: [] },
    { id: 2, type: "Liquidation", name: "International Conference Travel", date: "2026-05-12", summary: "Liquidation for the 9th International Conference on Green Urbanism.", fileUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Flat_tick_icon.svg/512px-Flat_tick_icon.svg.png", comments: [{ text: "Receipt indicated incorrect amount. Please review.", time: "5/12/2026, 2:30 PM" }] }
];

// Load initial data when page opens
window.onload = () => { searchCases(); };

// --- SIDEBAR TAB SWITCHING ---
function switchTab(tabName, element) {
    currentTab = tabName;
    document.getElementById('pageTitle').innerText = tabName + 's';
    
    // Update active class on sidebar
    const links = document.querySelectorAll('.nav-links li');
    links.forEach(link => link.classList.remove('active'));
    element.classList.add('active');

    // Clear search inputs and refresh the list
    document.getElementById('searchInput').value = "";
    document.getElementById('dateInput').value = "";
    searchCases();
}

// --- SEARCH FUNCTION ---
function searchCases() {
    const nameQuery = document.getElementById('searchInput').value.toLowerCase();
    const dateQuery = document.getElementById('dateInput').value;
    const container = document.getElementById('resultsContainer');

    container.innerHTML = "<p class='placeholder-text'>Loading audit records...</p>";

    setTimeout(() => {
        const results = mockDatabase.filter(item => {
            const matchType = item.type === currentTab; 
            const matchName = item.name.toLowerCase().includes(nameQuery);
            const matchDate = dateQuery ? item.date === dateQuery : true;
            return matchType && matchName && matchDate;
        });

        renderResults(results);
    }, 200); 
}

// --- RENDER SUMMARIES ---
function renderResults(data) {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = ""; 

    if (data.length === 0) {
        container.innerHTML = "<p class='placeholder-text'>No cases found matching your search criteria.</p>";
        return;
    }

    data.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card';
        card.onclick = () => openModal(item.id); 

        card.innerHTML = `
            <h3>${item.name}</h3>
            <span class="date">Submitted: ${item.date}</span>
            <p class="summary">${item.summary}</p>
        `;

        container.appendChild(card);
    });
}

// --- MODAL / VIEWER FUNCTIONS ---
function openModal(id) {
    const caseData = mockDatabase.find(item => item.id === id);
    if (!caseData) return;

    currentOpenCaseId = id;
    document.getElementById('modalTitle').innerText = caseData.name;
    document.getElementById('documentFrame').src = caseData.fileUrl; 
    
    renderComments(caseData.comments);
    
    document.getElementById('fileModal').style.display = 'block';
}

function closeModal() {
    document.getElementById('fileModal').style.display = 'none';
    document.getElementById('documentFrame').src = ""; 
    currentOpenCaseId = null;
}

// --- COMMENTING FUNCTIONS ---
function renderComments(comments) {
    const list = document.getElementById('commentsList');
    list.innerHTML = "";
    
    if (comments.length === 0) {
        list.innerHTML = "<p style='color:#7f8c8d; font-size:0.9em; font-style:italic;'>No audit comments yet. Add findings below.</p>";
        return;
    }

    comments.forEach(c => {
        const div = document.createElement('div');
        div.className = 'comment-item';
        div.innerHTML = `<span>${c.text}</span><span class="timestamp">${c.time}</span>`;
        list.appendChild(div);
    });
    
    // Auto-scroll to bottom of comments
    list.scrollTop = list.scrollHeight;
}

function submitComment(event) {
    event.preventDefault();
    const input = document.getElementById('newCommentText');
    const text = input.value.trim();
    
    if (!text || !currentOpenCaseId) return;

    const caseData = mockDatabase.find(item => item.id === currentOpenCaseId);
    
    // Create simple timestamp
    const now = new Date();
    const timeString = now.toLocaleDateString() + ', ' + now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    caseData.comments.push({ text: text, time: timeString });
    
    input.value = "";
    renderComments(caseData.comments);
}

// --- ADD RECORD MODAL FUNCTIONS ---
function openAddModal() {
    document.getElementById('addModal').style.display = 'block';
}

function closeAddModal() {
    document.getElementById('addModal').style.display = 'none';
}

// --- SUBMIT NEW RECORD ---
function submitNewRecord(event) {
    event.preventDefault(); 

    const name = document.getElementById('newName').value;
    const date = document.getElementById('newDate').value;
    const summary = document.getElementById('newSummary').value;
    
    // Safe placeholder image
    const safeFileUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Flat_tick_icon.svg/512px-Flat_tick_icon.svg.png";

    const newCase = {
        id: mockDatabase.length + 1, 
        type: currentTab,
        name: name,
        date: date,
        summary: summary,
        fileUrl: safeFileUrl,
        comments: []
    };

    mockDatabase.push(newCase);
    closeAddModal();
    document.getElementById('addRecordForm').reset();
    
    document.getElementById('searchInput').value = "";
    document.getElementById('dateInput').value = "";
    searchCases(); 
    
    alert(`New ${currentTab} record submitted successfully!`);
}

// Close modals if user clicks outside the box
window.onclick = function(event) {
    const fileModal = document.getElementById('fileModal');
    const addModal = document.getElementById('addModal');
    
    if (event.target == fileModal) {
        closeModal();
    }
    if (event.target == addModal) {
        closeAddModal();
    }
}