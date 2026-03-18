/**
 * setup-sharepoint-auth.js
 * Run ONCE to authenticate dinadaf@ipd.gob.pe and store refresh token.
 * Usage: node setup-sharepoint-auth.js
 */
require('dotenv').config();
const msal = require('@azure/msal-node');
const fs = require('fs');
const path = require('path');

const pca = new msal.PublicClientApplication({
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: 'https://login.microsoftonline.com/' + process.env.AZURE_TENANT_ID,
  },
  cache: {
    cachePlugin: {
      beforeCacheAccess: async (ctx) => {
        const cachePath = path.join(__dirname, '.token-cache.json');
        if (fs.existsSync(cachePath)) {
          ctx.tokenCache.deserialize(fs.readFileSync(cachePath, 'utf8'));
        }
      },
      afterCacheAccess: async (ctx) => {
        if (ctx.cacheHasChanged) {
          const cachePath = path.join(__dirname, '.token-cache.json');
          fs.writeFileSync(cachePath, ctx.tokenCache.serialize());
          console.log('\n✅ Token guardado en .token-cache.json');
        }
      },
    },
  },
});

const SCOPES = [
  'https://graph.microsoft.com/Files.ReadWrite',
  'offline_access',
];

async function main() {
  console.log('=== Setup SharePoint Auth — Plataforma PMD ===\n');

  const deviceCodeRequest = {
    deviceCodeCallback: (response) => {
      console.log('1. Abre este enlace en tu navegador:');
      console.log('   ' + response.verificationUri);
      console.log('\n2. Ingresa este código:');
      console.log('   ' + response.userCode);
      console.log('\nEsperando autenticación...');
    },
    scopes: SCOPES,
  };

  try {
    const result = await pca.acquireTokenByDeviceCode(deviceCodeRequest);
    console.log('\n✅ Autenticado como:', result.account.username);

    // Test: get OneDrive (personal drive of dinadaf@ipd.gob.pe)
    const res = await fetch(
      'https://graph.microsoft.com/v1.0/me/drive',
      { headers: { Authorization: 'Bearer ' + result.accessToken } }
    );
    const data = await res.json();

    if (data.error) {
      console.error('❌ Error accediendo al drive:', data.error.message);
      return;
    }

    console.log('✅ Drive ID encontrado:', data.id);
    console.log('   Tipo:', data.driveType);
    console.log('   Owner:', data.owner?.user?.displayName);

    // Append to .env
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    if (!envContent.includes('ONEDRIVE_DRIVE_ID')) {
      envContent += `ONEDRIVE_DRIVE_ID=${data.id}\n`;
      fs.writeFileSync(envPath, envContent);
      console.log('✅ ONEDRIVE_DRIVE_ID guardado en .env');
    } else {
      console.log('ℹ️  ONEDRIVE_DRIVE_ID ya existe en .env');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

main();
