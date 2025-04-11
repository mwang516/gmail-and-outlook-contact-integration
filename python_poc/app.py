import os
import json
from dotenv import load_dotenv

from flask import Flask, redirect, request, session, url_for, jsonify
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import msal
import requests

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', os.urandom(24))

# Google Config
GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID')
GOOGLE_CLIENT_SECRET = os.getenv('GOOGLE_CLIENT_SECRET')
GOOGLE_REDIRECT_URI = 'http://localhost:5001/callback/google'
GOOGLE_SCOPES = ['https://www.googleapis.com/auth/contacts.readonly', 'https://www.googleapis.com/auth/userinfo.profile', 'openid']

# Outlook Config
OUTLOOK_CLIENT_ID = os.getenv('OUTLOOK_CLIENT_ID')
OUTLOOK_CLIENT_SECRET = os.getenv('OUTLOOK_CLIENT_SECRET')
OUTLOOK_REDIRECT_URI = 'http://localhost:5001/callback/outlook'
OUTLOOK_SCOPES = ['https://graph.microsoft.com/Contacts.Read', 'User.Read']
OUTLOOK_AUTHORITY = 'https://login.microsoftonline.com/common'

# Check if essential config is loaded
if not all([GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET]):
    raise ValueError("Essential OAuth client configuration missing. Check .env file.")

# Google Helper Function
def _fetch_google_contacts_data(credentials):
    """Fetches Google contacts using provided credentials."""
    try:
        service = build('people', 'v1', credentials=credentials, static_discovery=False)
        results = service.people().connections().list(
            resourceName='people/me',
            pageSize=50,
            personFields='names,emailAddresses,phoneNumbers,organizations' 
        ).execute()
        return results.get('connections', [])
    except Exception as e:
        print(f'An error occurred fetching Google contacts: {e}')
        raise e 

# Google Auth & Fetch Route
@app.route('/login/google')
def login_google():
    flow = Flow.from_client_config(
        client_config={
            'web': {
                'client_id': GOOGLE_CLIENT_ID,
                'client_secret': GOOGLE_CLIENT_SECRET,
                'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
                'token_uri': 'https://oauth2.googleapis.com/token',
                'redirect_uris': [GOOGLE_REDIRECT_URI]
            }
        },
        scopes=GOOGLE_SCOPES,
        redirect_uri=GOOGLE_REDIRECT_URI
    )

    authorization_url, state = flow.authorization_url(
        access_type='offline', 
        include_granted_scopes='true',
        prompt='consent'
    )
    session['google_oauth_state'] = state
    return redirect(authorization_url)

@app.route('/callback/google')
def callback_google():
    state = session.pop('google_oauth_state', None)
    if state is None or state != request.args.get('state'):
        return 'Invalid state parameter.', 400

    flow = Flow.from_client_config(
         client_config={
            'web': {
                'client_id': GOOGLE_CLIENT_ID,
                'client_secret': GOOGLE_CLIENT_SECRET,
                'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
                'token_uri': 'https://oauth2.googleapis.com/token',
                'redirect_uris': [GOOGLE_REDIRECT_URI]
            }
        },
        scopes=GOOGLE_SCOPES,
        redirect_uri=GOOGLE_REDIRECT_URI,
        state=state
    )

    try:
        flow.fetch_token(authorization_response=request.url)
        credentials = flow.credentials
        connections = _fetch_google_contacts_data(credentials) # Fetch Gmail contacts
        return jsonify(connections)
        
    except Exception as e:
        print(f"Error during Google callback/fetch: {e}")
        return "An error occurred during Google authentication or contact fetching.", 500

# MSAL Helper Functions
def _build_msal_app(cache=None, authority=None):
    return msal.ConfidentialClientApplication(
        OUTLOOK_CLIENT_ID, authority=authority or OUTLOOK_AUTHORITY,
        client_credential=OUTLOOK_CLIENT_SECRET,
        token_cache=cache)

def _load_cache():
    cache = msal.SerializableTokenCache()
    if session.get("msal_token_cache"):
        cache.deserialize(session["msal_token_cache"])
    return cache

def _build_auth_code_flow(authority=None, scopes=None):
    return _build_msal_app(authority=authority).initiate_auth_code_flow(
        scopes or OUTLOOK_SCOPES,
        redirect_uri=OUTLOOK_REDIRECT_URI)

# Outlook Helper Function
def _fetch_outlook_contacts_data(access_token):
    """Fetches Outlook contacts using provided access token."""
    graph_endpoint = 'https://graph.microsoft.com/v1.0/me/contacts'
    headers = {'Authorization': f'Bearer {access_token}'}
    params = {
        '$select': 'displayName,emailAddresses,businessPhones,mobilePhone,companyName,jobTitle',
        '$top': 50 
    }
    try:
        response = requests.get(graph_endpoint, headers=headers, params=params)
        response.raise_for_status() 
        contacts_data = response.json()
        return contacts_data.get('value', [])
    except Exception as e:
        print(f"Error fetching Outlook contacts: {e}")
        raise e

# Outlook Auth & Fetch Routes
@app.route("/login/outlook")
def login_outlook():
    session["msal_auth_flow"] = _build_auth_code_flow(scopes=OUTLOOK_SCOPES)
    return redirect(session["msal_auth_flow"]["auth_uri"])

@app.route("/callback/outlook") 
def callback_outlook():
    access_token = None # Initialize access_token
    try:
        cache = _load_cache()
        result = _build_msal_app(cache=cache).acquire_token_by_auth_code_flow(
            session.get("msal_auth_flow", {}),
            request.args)
            
        if "error" in result:
            print(f"MSAL Error: {result}")
            return f"Login failure: {result.get('error')}: {result.get('error_description')}", 500

        access_token = result.get('access_token')
        if not access_token:
            return "Could not retrieve access token from Microsoft.", 500
            
        contacts = _fetch_outlook_contacts_data(access_token)
        return jsonify(contacts)
        
    except Exception as e:
        print(f"Error during Outlook callback/fetch: {e}")
        return "Error occurred during Outlook authentication or contact fetching.", 500

# Index Route
@app.route('/')
def index():
    google_link = f"<a href='{url_for('login_google')}'>Google</a>"
    outlook_link = f"<a href='{url_for('login_outlook')}'>Outlook</a>"
    return f"""
    <h1>Contact Integration POC</h1>
    <h2>Google:</h2>
    <p>{google_link}</p>
    <h2>Outlook:</h2>
    <p>{outlook_link}</p>
    """

if __name__ == '__main__':
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1' 
    app.run('localhost', 5001, debug=True) 