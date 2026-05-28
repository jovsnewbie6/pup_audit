# PUP Audit System - Setup & Deployment Guide

## 📋 Prerequisites

- Node.js (v14+)
- PostgreSQL (via Neon)
- Git

## 🚀 Local Development Setup

### 1. Clone Repository
```bash
git clone <your-repo-url>
cd "Project - Reimbursement and Liquidation"
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Create Neon Database

1. Visit [https://console.neon.tech](https://console.neon.tech)
2. Create a new project
3. Copy your connection string: `postgresql://user:password@ep-xyz.us-east-1.aws.neon.tech/audit_db`
4. Note: Neon has a free tier with automatic backups and doesn't auto-delete data after 30 days

### 4. Configure Environment
1. Copy `.env.example` to `.env`
2. Update the values:
```env
DATABASE_URL=postgresql://user:password@ep-xyz.us-east-1.aws.neon.tech/audit_db?sslmode=require
JWT_SECRET=your_super_secret_jwt_key_here_change_in_production
PORT=3000
NODE_ENV=development
```

### 5. Run Locally
```bash
npm start
```

The app will run on `http://localhost:3000`

**Default Admin Login:**
- Username: `Admin`
- Password: `Admin123`

## 🌐 Deploy to Render

### 1. Push to GitHub
```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Connect to Render
1. Visit [https://render.com](https://render.com)
2. Sign in with GitHub
3. Click "New +" → "Web Service"
4. Connect your repository
5. Fill in deployment details:
   - **Name:** pup-audit
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free (sufficient for testing)

### 3. Add Environment Variables on Render
1. Go to your web service → Environment
2. Add these variables:
```
DATABASE_URL=postgresql://user:password@ep-xyz.us-east-1.aws.neon.tech/audit_db?sslmode=require
JWT_SECRET=<strong-random-key-here>
NODE_ENV=production
```

### 4. Deploy
- Click "Deploy" and wait for completion
- Your app will be available at `https://pup-audit.onrender.com`

## 🔑 Features

### User Roles

**Audit Supervisor (Admin)**
- Create, read, update, delete records
- Approve/reject records
- Assign records to staff
- Manage staff permissions
- View all audit logs
- Export data & backup

**Staff Auditor**
- Create, read, update records
- View assigned records
- Cannot delete records (permission configurable by Supervisor)
- Cannot approve records
- Limited audit log access

### Role-Based Permissions
The Audit Supervisor can configure what Staff Auditors can do:
- Create records
- Read records
- Update records
- Delete records (disabled by default)
- Approve records
- Export data
- And more...

## 📊 Database Schema

### Users
- `id` - Primary Key
- `username` - Unique username
- `email` - Unique email
- `password_hash` - Bcrypt hashed password
- `role` - 'Audit Supervisor' or 'Staff Auditor'
- `is_active` - Account status
- `created_at`, `updated_at` - Timestamps

### Audit Records
- `id` - Primary Key
- `record_name` - Name of the record
- `record_type` - 'Reimbursement' or 'Liquidation'
- `serial_number` - Unique identifier
- `status` - 'Pending', 'Approved', or 'Rejected'
- `created_by` - User ID who created
- `assigned_to` - User ID assigned to
- `is_deleted` - Soft delete flag
- `deleted_at` - Deletion timestamp

### Permissions
- `id` - Primary Key
- `role` - Role name
- `action` - Permission action
- `can_perform` - Boolean permission status

### Audit Logs
- `id` - Primary Key
- `record_id` - Associated record
- `user_id` - User who performed action
- `action` - Action performed
- `comment` - Additional notes
- `old_value`, `new_value` - For tracking changes
- `created_at` - Timestamp

## 🔄 API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register (Supervisor only)
- `POST /api/auth/change-password` - Change password
- `GET /api/auth/me` - Get current user
- `GET /api/auth/users` - List all users (Supervisor only)

### Audit Records
- `GET /api/audit/records` - Get all records
- `GET /api/audit/records/:recordId` - Get single record
- `POST /api/audit/records` - Create record
- `PUT /api/audit/records/:recordId` - Update record
- `DELETE /api/audit/records/:recordId` - Delete record
- `GET /api/audit/records/:recordId/log` - Get audit log

### Permissions
- `GET /api/permissions/role/:role` - Get role permissions (Supervisor only)
- `PUT /api/permissions/role/:role/:action` - Update permission (Supervisor only)
- `GET /api/permissions/user/:userId` - Get user permissions

## 🛡️ Security Features

- **JWT Authentication** - Secure token-based sessions
- **Password Hashing** - Bcrypt for secure password storage
- **Role-Based Access Control** - Permissions enforced server-side
- **Soft Deletes** - Records archived for 30 days
- **Audit Logging** - Track all user actions
- **SSL/TLS** - Encrypted connections
- **CORS** - Cross-origin restrictions

## 🆘 Troubleshooting

### Database Connection Error
- Verify Neon connection string in `.env`
- Check if Neon project is active
- Ensure PostgreSQL port (5432) is accessible

### Port Already in Use
```bash
# On Windows (PowerShell)
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process

# On Mac/Linux
lsof -ti:3000 | xargs kill -9
```

### Login Fails
- Check if Admin account was created (should auto-create on first run)
- Verify JWT_SECRET is set
- Check browser console for error details

### Render Build Fails
- Ensure `package.json` is in root directory
- Check `npm install` output for errors
- Review Render build logs

## 📞 Support
For issues or questions, contact your development team.

## 📝 License
Internal Use Only
