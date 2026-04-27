# SharePoint Setup for Pricelist Storage

This guide explains how to set up Azure AD app registration to store pricelist Excel files in SharePoint instead of the local filesystem (which gets wiped on Render deploys).

## Benefits

- ✅ **Persistent storage** - Files survive all deployments
- ✅ **Unlimited space** - SharePoint provides 1TB+ storage
- ✅ **Better file management** - Native SharePoint UI for file operations
- ✅ **Version control** - SharePoint keeps file versions automatically

## Step 1: Create Azure AD App Registration

1. Go to **https://portal.azure.com** → **Azure Active Directory** → **App registrations** → **New registration**

2. Fill in:
   - **Name**: `Logivice-Invoice-Storage`
   - **Supported account types**: Accounts in this organizational directory only
   - **Redirect URI**: Leave blank

3. Click **Register**

4. Copy these values (you'll need them):
   - **Application (client) ID**
   - **Directory (tenant) ID**

## Step 2: Create Client Secret

1. In your app registration, go to **Certificates & secrets** → **New client secret**

2. Fill in:
   - **Description**: `Render Deployment`
   - **Expires**: 24 months (or your preference)

3. Click **Add**

4. **IMPORTANT**: Copy the **Value** immediately (you won't see it again!)

## Step 3: Add API Permissions

1. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**

2. Search for and add:
   - `Sites.FullControl.All`

3. Click **Grant admin consent for [your tenant]**

## Step 4: Grant SharePoint Access

Your app needs access to the specific SharePoint site. You have two options:

### Option A: Site-Level Permissions (Recommended)

1. Go to your SharePoint site: `https://unilog2022.sharepoint.com/sites/[yoursite]`

2. Click **Site settings** (gear icon) → **Site permissions**

3. Click **Grant permissions**

4. Enter your app name: `Logivice-Invoice-Storage`

5. Grant **Full Control** permission

### Option B: Use SharePoint App-Only Principal

1. Go to: `https://unilog2022.sharepoint.com/_layouts/15/appinv.aspx`

2. Enter your **App ID** (Client ID from step 1)

3. Click **Lookup**

4. In **App's Permission Request XML**, paste:
   ```xml
   <AppPermissionRequests AllowAppOnlyPolicy="true">
     <AppPermissionRequest Scope="http://sharepoint/content/sitecollection" Right="FullControl" />
   </AppPermissionRequests>
   ```

5. Click **Create**

6. Click **Trust It**

## Step 5: Configure Render Environment Variables

Add these environment variables in Render dashboard:

```
SHAREPOINT_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
SHAREPOINT_CLIENT_SECRET=your-secret-value
SHAREPOINT_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
SHAREPOINT_SITE_URL=https://unilog2022.sharepoint.com
SHAREPOINT_FOLDER_PATH=/sites/[yoursite]/Pricelists
```

## Step 6: Create SharePoint Folder

1. Go to your SharePoint site
2. Navigate to the desired location
3. Create a folder named `Pricelists` (or match your `SHAREPOINT_FOLDER_PATH`)

## Testing

After deployment, check the Render logs for:
```
[SharePoint] Uploaded: Sensos - Template 2026.xlsx
[SharePoint] Downloaded: Sensos - Template 2026.xlsx
```

If you see warnings like `[SharePoint] Missing credentials`, the environment variables aren't set correctly.

## Troubleshooting

### "Unauthorized" errors
- Check that admin consent was granted in Azure AD
- Verify the app has permissions to the SharePoint site

### "File not found" errors
- Check that the folder path in `SHAREPOINT_FOLDER_PATH` matches exactly
- Ensure the folder exists in SharePoint

### Files still being deleted
- If SharePoint isn't configured, the system falls back to local filesystem
- Check logs for `[SharePoint] Missing credentials` warning
