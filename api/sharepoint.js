/**
 * sharepoint.js — OneDrive upload utility (Plataforma PMD)
 * Uses cached MSAL token to upload files to dinadaf's OneDrive /pad-data/
 */
require('dotenv').config();
const msal = require('@azure/msal-node');
const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, '.token-cache.json');
const SCOPES = ['https://graph.microsoft.com/Files.ReadWrite', 'offline_access'];
const DRIVE_ID = process.env.ONEDRIVE_DRIVE_ID;
const FOLDER = process.env.SHAREPOINT_FOLDER || 'pad-data';

const cachePlugin = {
  beforeCacheAccess: async (ctx) => {
    if (fs.existsSync(CACHE_PATH)) {
      ctx.tokenCache.deserialize(fs.readFileSync(CACHE_PATH, 'utf8'));
    }
  },
  afterCacheAccess: async (ctx) => {
    if (ctx.cacheHasChanged) {
      fs.writeFileSync(CACHE_PATH, ctx.tokenCache.serialize());
    }
  },
};

const pca = new msal.PublicClientApplication({
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: 'https://login.microsoftonline.com/' + process.env.AZURE_TENANT_ID,
  },
  cache: { cachePlugin },
});

async function getToken() {
  // Load cache first
  if (fs.existsSync(CACHE_PATH)) {
    pca.getTokenCache().deserialize(fs.readFileSync(CACHE_PATH, 'utf8'));
  }
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (!accounts.length) throw new Error('No hay sesión guardada. Ejecuta setup-sharepoint-auth.js primero.');
  const result = await pca.acquireTokenSilent({ account: accounts[0], scopes: SCOPES });
  return result.accessToken;
}

/**
 * Upload a JSON object to OneDrive /pad-data/{filename}
 * @param {string} filename - e.g. 'kpi.json'
 * @param {object} data - JS object to serialize as JSON
 */
async function uploadJSON(filename, data) {
  const token = await getToken();
  const content = JSON.stringify(data, null, 2);
  const url = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:/${FOLDER}/${filename}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: content,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Upload failed [${filename}]: ${err.error?.message || res.status}`);
  }
  const file = await res.json();
  return file.webUrl;
}

module.exports = { uploadJSON };
