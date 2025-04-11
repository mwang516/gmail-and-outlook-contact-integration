const express = require('express');
const { google } = require('googleapis');
const msal = require('@azure/msal-node');
require('isomorphic-fetch');
const graph = require('@microsoft/microsoft-graph-client');

const app = express();
const port = 3000;

// Hardcoded credentials and config 
const GOOGLE_CLIENT_ID = '190218594767-o4v1omdt3apbnljmf881aeln58kvkq0e.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback/google';
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/contacts.readonly'];

// --- Outlook/Microsoft Config ---
const OUTLOOK_CLIENT_ID = '38a05689-1aad-4bbe-9f7f-02e843a7c207';
const OUTLOOK_CLIENT_SECRET = 'BqI8Q~uAtvoudCQl14eHBJkfe-a3jtZrUuZbwb.P';
const OUTLOOK_REDIRECT_URI = 'http://localhost:3000/callback/outlook';
const OUTLOOK_SCOPES = ['https://graph.microsoft.com/Contacts.Read', 'offline_access', 'openid', 'profile'];
const OUTLOOK_AUTHORITY = 'https://login.microsoftonline.com/common';

let googleTokens = null;
let outlookTokens = null;

// Create Google OAuth2 client
const googleOauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

// --- MSAL Setup ---
const msalConfig = {
  auth: {
    clientId: OUTLOOK_CLIENT_ID,
    authority: OUTLOOK_AUTHORITY,
    clientSecret: OUTLOOK_CLIENT_SECRET,
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message, containsPii) {
        // console.log(message);
      },
      piiLoggingEnabled: false,
      logLevel: msal.LogLevel.Warning,
    }
  }
};

const msalClient = new msal.ConfidentialClientApplication(msalConfig);

app.get('/login/google', (req, res) => {
  const authUrl = googleOauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_SCOPES,
  });
  res.redirect(authUrl);
});

// Route to start the Google OAuth flow
app.get('/login/outlook', (req, res) => {
  const authCodeUrlParameters = {
    scopes: OUTLOOK_SCOPES,
    redirectUri: OUTLOOK_REDIRECT_URI,
  };

  msalClient.getAuthCodeUrl(authCodeUrlParameters)
    .then((authCodeUrl) => {
      res.redirect(authCodeUrl);
    })
    .catch((error) => {
      console.log(JSON.stringify(error));
      res.status(500).send('Error building Outlook auth URL.');
    });
});

// Callback route for Google
app.get('/callback/google', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Authorization code missing.');
  }

  try {
    const { tokens: receivedTokens } = await googleOauth2Client.getToken(code);
    googleTokens = receivedTokens;
    googleOauth2Client.setCredentials(googleTokens);
    res.send('Google Authentication successful! You can now fetch contacts at /contacts/google.');
  } catch (error) {
    console.error('Error retrieving Google access token', error);
    res.status(500).send('Error retrieving Google access token.');
  }
});

// --- Callback route to handle the redirect from Microsoft ---
app.get('/callback/outlook', async (req, res) => {
  const tokenRequest = {
    code: req.query.code,
    scopes: OUTLOOK_SCOPES,
    redirectUri: OUTLOOK_REDIRECT_URI,
  };

  try {
    const response = await msalClient.acquireTokenByCode(tokenRequest);
    outlookTokens = response;
    res.send('Outlook Authentication successful! You can now fetch contacts at /contacts/outlook.');
  } catch (error) {
    console.error('Error acquiring Outlook token by code:', error);
    res.status(500).send('Error acquiring Outlook token.');
  }
});

// Route to fetch Google contacts
app.get('/contacts/google', async (req, res) => {
  if (!googleTokens) {
    return res.redirect('/login/google');
  }

  googleOauth2Client.setCredentials(googleTokens);

  const service = google.people({ version: 'v1', auth: googleOauth2Client });

  try {
    const response = await service.people.connections.list({
      resourceName: 'people/me',
      pageSize: 50,
      personFields: 'names,emailAddresses,phoneNumbers,organizations',
    });

    const connections = response.data.connections || [];

    if (connections.length > 0) {
      connections.forEach((person) => {
      });
      res.json(connections);
    } else {
      res.send('No Google connections found.');
    }
  } catch (err) {
    console.error('The Google People API returned an error: ' + err);
    if (err.code === 401) {
        googleTokens = null;
        return res.redirect('/login/google');
    }
    res.status(500).send('Error fetching Google contacts.');
  }
});

// --- Route to fetch Outlook contacts ---
app.get('/contacts/outlook', async (req, res) => {
  if (!outlookTokens) {
    return res.redirect('/login/outlook');
  }

  try {
    const client = graph.Client.init({
      authProvider: (done) => {
        done(null, outlookTokens.accessToken);
      }
    });

    const result = await client
      .api('/me/contacts')
      .select('displayName,emailAddresses,businessPhones,mobilePhone,companyName,jobTitle')
      .top(50)
      .get();

    const contacts = result.value || [];

    if (contacts.length > 0) {
      res.json(contacts);
    } else {
      res.send('No Outlook contacts found.');
    }

  } catch (error) {
    console.error('Microsoft Graph API returned an error:', error);
    if (error.statusCode === 401) {
        outlookTokens = null;
        return res.redirect('/login/outlook');
    }
    res.status(500).send('Error fetching Outlook contacts.');
  }
});

app.listen(port, () => {
  console.log(`POC app listening at http://localhost:${port}`);
  console.log(`Visit http://localhost:${port}/login/google to authenticate with Google.`);
  console.log(`Visit http://localhost:${port}/login/outlook to authenticate with Outlook.`);
}); 