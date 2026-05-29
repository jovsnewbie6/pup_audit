const API_BASE_URL = window.location.origin + '/api';

// Your script.js is looking for this variable to know if someone is logged in
let currentToken = localStorage.getItem('token');

// Your index.html is looking for this function to start the login screen
function initializeAuth() {
    console.log("Authentication system initialized.");

    // Look for the login form on your screen
    const loginForm = document.getElementById('login-form'); // Change ID if yours is different
    
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Get what the user typed in
            const username = document.getElementById('username').value; // Change ID if yours is different
            const password = document.getElementById('password').value; // Change ID if yours is different

            try {
                // Send it to your Node.js Backend Bouncer
                const response = await fetch(`${API_BASE_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const data = await response.json();

                if (response.ok) {
                    // Success! Save the ID badge (token) in the browser
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('role', data.role);
                    localStorage.setItem('username', data.username);
                    currentToken = data.token;
                    
                    // Reload the page to hide the login screen and show the dashboard
                    window.location.reload();
                } else {
                    // Wrong password or username
                    alert(data.error || 'Login failed. Please check your credentials.');
                }
            } catch (err) {
                console.error('Login error:', err);
                alert('Could not connect to the server.');
            }
        });
    }
}

window.logout = function() {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('username');
    window.location.reload();
};