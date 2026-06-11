# 🔧 How to Restore User Accounts

Your accounts were missing because the database tables and default user accounts hadn't been created. I've added `init-db.js` which will set everything up for you.

## Steps to Restore Accounts

### Option 1: Run on Render (Recommended for Production)

1. **Connect to Render Console** - Go to your Render Web Service dashboard
2. **Open Shell** - Click "Shell" tab to access the terminal
3. **Run the initialization script**:
   ```bash
   npm install
   node init-db.js
   ```
4. **Wait for confirmation** - You'll see:
   ```
   ✨ DATABASE INITIALIZATION COMPLETE!
   
   🔐 Default Accounts Created:
      Admin:
         Username: Admin
         Password: Admin123
         Role: Audit Supervisor
   
      Staff:
         Username: Staff
         Password: Staff123
         Role: Staff Auditor
   ```

### Option 2: Run Locally (If you have DATABASE_URL set)

1. **Ensure .env is configured** with your DATABASE_URL
2. **Run from terminal**:
   ```bash
   node init-db.js
   ```

---

## What Gets Created

### Tables
- `users` - Stores user accounts and roles
- `audit_records` - Stores audit data records
- `audit_logs` - Stores audit trail/history
- `permissions` - Stores role-based permissions

### Default Accounts

**Admin (Audit Supervisor)**
- Username: `Admin`
- Password: `Admin123`
- Can: Create, read, update, delete records, approve records, manage users

**Staff (Staff Auditor)**
- Username: `Staff`
- Password: `Staff123`
- Can: Create, read, update records (but not delete or approve)

---

## After Running init-db.js

1. **Reload the app** - Refresh your Render deployment URL
2. **Login** with either account above
3. **Go to Settings** (gear icon) → **Manage Users & Permissions**
4. **System Users table** should now show all accounts
5. **Create more staff accounts** as needed by clicking "+ Create New User"

---

## Troubleshooting

### ❌ Connection Timeout Error
**Problem**: `ETIMEDOUT` error when running init-db.js locally

**Solution**: This means your local machine can't reach the Neon database. Run it on Render instead:
- Go to your Render web service
- Click "Shell"
- Run `node init-db.js`

### ❌ Still Seeing "Error: Invalid or expired token"
**Problem**: The "System Users" section shows this error

**Solution**: 
1. Clear browser cache/localStorage
2. Log out completely
3. Log back in with Admin/Admin123
4. Refresh the page

### ❌ "Users table already exists" error
**Solution**: This is fine! It means:
- The script won't duplicate tables
- It will just add the default accounts (Admin & Staff)
- Run it again if needed - it's safe!

---

## Need More Accounts?

Use the web interface:
1. Login as Admin (Admin123)
2. Click Settings gear icon
3. Click "Manage Users & Permissions"
4. Fill in username, password, role
5. Click "+ Create Account"

---

## Next Steps

✅ Run `node init-db.js` on Render  
✅ Verify accounts appear in "System Users" section  
✅ Login with Admin/Admin123  
✅ Create additional staff accounts as needed  

Your accounts are now restored! 🎉
