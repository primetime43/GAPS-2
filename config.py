# config.py

# Define the page display names
PAGE_DISPLAY_NAMES = {
    'libraries': 'Libraries',
    'recommended': 'Recommended',
    'configuration': 'Configuration',
    'updates': 'Updates',
    'about': 'About'
}

# Define the base URLs
TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500"

# Define the response messages
RESPONSE_MESSAGES = {
    "api_key_success": "API key is working!",
    "api_key_failure": "Failed to connect to API, status code: ",
    "data_not_found": "Data not found",
    "plex_account_error": "Could not log in to Plex account",
    "plex_data_not_found": "PlexAccountData not found",
    "server_not_found": "Server not found",
    "server_resource_not_found": "Server resource not found",
    "invalid_token": "Invalid token",
    "api_key_saved":"Successfully saved API key"
}