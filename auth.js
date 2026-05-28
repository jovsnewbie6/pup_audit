// ============ AUTHENTICATION MODULE ============
const API_BASE_URL = window.location.origin + '/api';
let currentUser = null;
let currentToken = null;

// Initialize authentication on page load
function initializeAuth() {
    const token = localStorage.getItem('authToken');
    if (token) {
        currentToken = token;
        verifyToken();
    } else {
        showAuthScreen();
    }
}

// Show authentication screen
function showAuthScreen() {
    document.getElementById('authContainer').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
}

// Show application
function showApp() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('appContainer').style.display = 'flex';
}

// Switch to registration screen
function switchToRegister(event) {
    event.preventDefault();
    document.getElementById('loginScreen').classList.remove('active');
    document.getElementById('registerScreen').classList.add('active');
}

// Switch to login screen
function switchToLogin(event) {
    event.preventDefault();
    document.getElementById('registerScreen').classList.remove('active');
    document.getElementById('loginScreen').classList.add('active');
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
            errorEl.classList.add('show');
            return;
        }

        // Store token and user info
        currentToken = data.token;
        currentUser = data.user;
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));

        errorEl.classList.remove('show');
        
        // Update UI and show app
        updateUserInfo();
        showApp();
        renderSidebar();
        searchRecords();
    } catch (error) {
        errorEl.textContent = 'Connection error. Please try again.';
        errorEl.classList.add('show');
    }
}

// Handle registration
async function handleRegister(event) {
    event.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;
    const errorEl = document.getElementById('registerError');

    if (password !== confirmPassword) {
        errorEl.textContent = 'Passwords do not match';
        errorEl.classList.add('show');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ username, email, password, role: 'Staff Auditor' })
        });

        const data = await response.json();

        if (!response.ok) {
            errorEl.textContent = data.error || 'Registration failed';
            errorEl.classList.add('show');
            return;
        }

        alert('User registered successfully!');
        switchToLogin(new Event('switch'));
        errorEl.classList.remove('show');
    } catch (error) {
        errorEl.textContent = 'Connection error. Please try again.';
        errorEl.classList.add('show');
    }
}

// Handle password change
async function handlePasswordChange(event) {
    event.preventDefault();
    const oldPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;
    const errorEl = document.getElementById('passwordError');

    if (newPassword !== confirmNewPassword) {
        errorEl.textContent = 'New passwords do not match';
        errorEl.classList.add('show');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ oldPassword, newPassword })
        });

        const data = await response.json();

        if (!response.ok) {
            errorEl.textContent = data.error || 'Password change failed';
            errorEl.classList.add('show');
            return;
        }

        alert('Password changed successfully!');
        closePasswordModal();
        errorEl.classList.remove('show');
    } catch (error) {
        errorEl.textContent = 'Connection error. Please try again.';
        errorEl.classList.add('show');
    }
}

// Verify token validity
async function verifyToken() {
    if (!currentToken) return;

    try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });

        if (response.ok) {
            const user = await response.json();
            currentUser = user;
            localStorage.setItem('user', JSON.stringify(user));
            updateUserInfo();
            showApp();
            renderSidebar();
            searchRecords();
        } else {
            logout();
        }
    } catch (error) {
        console.error('Token verification failed:', error);
        logout();
    }
}

// Update user info in header
function updateUserInfo() {
    if (currentUser) {
        document.getElementById('userName').textContent = currentUser.username;
        document.getElementById('userRole').textContent = currentUser.role;
        
        // Show permissions button only for Audit Supervisor
        if (currentUser.role === 'Audit Supervisor') {
            document.getElementById('permissionsBtn').style.display = 'inline-block';
        } else {
            document.getElementById('permissionsBtn').style.display = 'none';
        }
    }
}

// Logout
function logout() {
    currentToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    document.getElementById('loginForm').reset();
    document.getElementById('registerForm').reset();
    showAuthScreen();
}

// API Helper: Make authenticated requests
async function apiCall(endpoint, options = {}) {
    if (!currentToken) {
        logout();
        return null;
    }

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        ...options.headers
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers
    });

    if (response.status === 401 || response.status === 403) {
        logout();
        return null;
    }

    return response;
}

// Check if user has permission for action
function hasPermission(action) {
    // For now, return true. This will be checked server-side
    // Frontend can display/hide UI elements based on role
    return currentUser && currentUser.role === 'Audit Supervisor' || action !== 'delete_record';
}

// Permissions Management (Audit Supervisor only)
function openPermissionsModal() {
    if (currentUser.role !== 'Audit Supervisor') {
        alert('Only Audit Supervisors can manage permissions');
        return;
    }

    loadPermissionsData();
    document.getElementById('permissionsModal').style.display = 'block';
}

function closePermissionsModal() {
    document.getElementById('permissionsModal').style.display = 'none';
}

async function loadPermissionsData() {
    try {
        const response = await apiCall('/permissions/role/Staff%20Auditor');
        if (!response) return;

        const permissions = await response.json();
        const container = document.getElementById('permissionsContainer');

        let html = `
            <table class="permissions-table">
                <thead>
                    <tr>
                        <th>Permission</th>
                        <th>Action</th>
                        <th style="text-align: center;">Allowed</th>
                    </tr>
                </thead>
                <tbody>
        `;

        permissions.forEach(perm => {
            const checked = perm.can_perform ? 'checked' : '';
            html += `
                <tr>
                    <td>${perm.action.replace(/_/g, ' ').toUpperCase()}</td>
                    <td>Staff Auditors ${perm.can_perform ? 'CAN' : 'CANNOT'} ${perm.action.replace(/_/g, ' ')}</td>
                    <td style="text-align: center;">
                        <input type="checkbox" class="toggle-checkbox" id="perm_${perm.id}" ${checked} data-role="Staff Auditor" data-action="${perm.action}">
                    </td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    } catch (error) {
        console.error('Failed to load permissions:', error);
    }
}

async function savePermissions() {
    const checkboxes = document.querySelectorAll('.toggle-checkbox');

    for (const checkbox of checkboxes) {
        const role = checkbox.dataset.role;
        const action = checkbox.dataset.action;
        const canPerform = checkbox.checked;

        try {
            const response = await apiCall(`/permissions/role/${role}/${action}`, {
                method: 'PUT',
                body: JSON.stringify({ can_perform: canPerform })
            });

            if (!response.ok) {
                alert('Failed to update permission');
            }
        } catch (error) {
            console.error('Error saving permission:', error);
        }
    }

    alert('Permissions updated successfully!');
    closePermissionsModal();
}

// Password change modal
function openPasswordModal() {
    document.getElementById('passwordModal').style.display = 'block';
}

function closePasswordModal() {
    document.getElementById('passwordModal').style.display = 'none';
    document.getElementById('passwordForm').reset();
    document.getElementById('passwordError').classList.remove('show');
}
