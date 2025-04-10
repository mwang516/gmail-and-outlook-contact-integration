const express = require('express');
const { google } = require('googleapis');

const app = express();
const port = 3000;

// Hardcoded credentials and config 
const GOOGLE_CLIENT_ID = '190218594767-o4v1omdt3apbnljmf881aeln58kvkq0e.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback/google';
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/contacts.readonly'];

let googleTokens = null;

// Create Google OAuth2 client
const googleOauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

app.get('/login/google', (req, res) => {
  const authUrl = googleOauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_SCOPES,
  });
  res.redirect(authUrl);
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

app.listen(port, () => {
  console.log(`POC app listening at http://localhost:${port}`);
  console.log(`Visit http://localhost:${port}/login/google to authenticate with Google.`);
}); 