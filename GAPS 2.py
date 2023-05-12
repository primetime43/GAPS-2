import webbrowser
import json
from flask import Flask, render_template, request, jsonify
from plexapi.myplex import MyPlexPinLogin, MyPlexAccount

app = Flask(__name__)

@app.context_processor
def inject_page_display_names():
    page_display_names = {
        'libraries': 'Libraries',
        'recommended': 'Recommended',
        'rss_check': 'RSS',  # Display as 'RSS' instead of 'rss_check'
        'configuration': 'Configuration',
        'updates': 'Updates',
        'about': 'About'
    }
    return dict(page_display_names=page_display_names)

@app.route('/')
def main_index():
    return render_template('index.html')

@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/configuration')
def configuration():
    return render_template('configuration.html')

@app.route('/emptyState')
def empty_state():
    return render_template('emptyState.html')

@app.route('/error')
def error():
    return render_template('error.html')

@app.route('/libraries')
def libraries():
    return render_template('libraries.html')

@app.route('/mislabeled')
def mislabeled():
    return render_template('mislabeled.html')

@app.route('/recommended')
def recommended():
    return render_template('recommended.html')

@app.route('/rssCheck')
def rss_check():
    return render_template('rssCheck.html')

@app.route('/updates')
def updates():
    return render_template('updates.html')

@app.route('/testTmdbKey', methods=['POST'])
def test_tmdb_key():
    print("In test_tmdb_key")

    # Extract data from request
    data = request.get_json()

    # Perform operations using data
    print(data)

    # Return a response
    return jsonify(result='Success')

@app.route('/saveTmdbKey', methods=['POST'])
def save_tmdb_key():
    print("In save_tmdb_key")

    # Extract data from request
    data = request.get_json()

    # Perform operations using data
    print(data)

    # Return a response
    return jsonify(result='Success')

# Function to be called when the link plex account button is clicked
tokens = {}

@app.route('/link_plex_account', methods=['POST'])
def link_plex_account():
    print("link_plex_account")

    try:
        headers = {'X-Plex-Client-Identifier': 'your_unique_client_identifier'}
        pinlogin = MyPlexPinLogin(headers=headers, oauth=True)
        oauth_url = pinlogin.oauthUrl()
        webbrowser.open(oauth_url)
        pinlogin.run(timeout=120)
        pinlogin.waitForLogin()
        if pinlogin.token:
            plex_account = MyPlexAccount(token=pinlogin.token)
            username = plex_account.username  # Get the username
            resources = [resource for resource in plex_account.resources() if resource.owned]
            servers = [f"{resource.name} ({resource.connections[0].address})" for resource in resources]

            print(f"servers: {servers}")
 
            # Store tokens in the dictionary
            for resource in resources:
                server_name = f"{resource.name} ({resource.connections[0].address})"
                tokens[server_name] = pinlogin.token

            print(f'Logged In As {username}')
            # Return the JSON response
            return jsonify(servers=servers)  # directly return the list, jsonify will convert it to JSON
        else:
            print('Error', 'Could not log in to Plex account')
    except Exception as e:
        print('Error', f'Could not log in to Plex account: {str(e)}')

    # Return an empty JSON response if there was an error
    return jsonify(servers=[])

@app.route('/fetch_libraries/<serverName>')
def fetch_libraries(serverName):
    # Fetch the Plex account using the token
    token = tokens.get(serverName, None)
    if token is None:
        print("Token not found")
        return jsonify(error="Token not found"), 404

    print("Token: " + token)
    plex_account = MyPlexAccount(token=token)

    # Find the server with the matching serverName
    server = None
    for resource in plex_account.resources():
        if f"{resource.name} ({resource.connections[0].address})" == serverName:
            print(f"Attempting to connect to server {serverName}")
            server = resource.connect()
            break

    if server is None:
        print("Server not found")
        return jsonify(error="Server not found"), 404

    # Fetch the libraries
    libraries = [section.title for section in server.library.sections()]

    print(f"Libraries: {libraries}")

    # Return the JSON response
    return jsonify(libraries=libraries, token=token)

if __name__ == '__main__':
    app.run(debug=True)