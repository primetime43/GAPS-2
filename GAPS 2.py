import json, webbrowser, requests
from flask import Flask, render_template, request, jsonify
from plexapi.myplex import MyPlexPinLogin, MyPlexAccount, PlexServer
from PlexAccountData import PlexAccountData

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
    if currentActiveServer.selected_server in stored_plexAccounts:
        libraries = currentActiveServer.libraries
        return render_template('libraries.html', plexServer=currentActiveServer.selected_server, libraries=libraries, currentActiveServer=currentActiveServer)
    
    # Handle case when PlexAccountData is not found
    return render_template('error.html', error='Data not found')


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
            plex_data = PlexAccountData()  # Create a new PlexAccountData object
            plex_account = MyPlexAccount(token=pinlogin.token)
            username = plex_account.username  # Get the username
            resources = [resource for resource in plex_account.resources() if resource.owned]
            servers = [f"{resource.name} ({resource.connections[0].address})" for resource in resources]

            print(f"servers: {servers}")
 
            # Store tokens in the dictionary
            for resource in resources:
                server_name = f"{resource.name} ({resource.connections[0].address})"
                tokens[server_name] = pinlogin.token
                print("server name: " + server_name + " token: " + pinlogin.token) 
                plex_data.add_token(server_name, pinlogin.token)

            print(f'Logged In As {username}')
            plex_data.set_servers(servers)

            # Store the PlexAccountData object in the array
            plex_data_array.append(plex_data)

            # Return the JSON response with servers and token
            return jsonify(servers=servers, token=pinlogin.token)
        else:
            print('Error', 'Could not log in to Plex account')
    except Exception as e:
        print('Error', f'Could not log in to Plex account: {str(e)}')
    
    # Return an empty JSON response if there was an error
    return jsonify(servers=[], token=None)

@app.route('/fetch_libraries/<serverName>')
def fetch_libraries(serverName):
    # Find the PlexAccountData object with the matching serverName
    plex_data = next((data for data in plex_data_array if serverName in data.tokens), None)

    if plex_data is None:
        print("PlexAccountData not found")
        return jsonify(error="PlexAccountData not found"), 404

    token = plex_data.tokens.get(serverName)

    print("Token: " + token)
    plex_account = MyPlexAccount(token=token)

    server = None
    for resource in plex_account.resources():
        if f"{resource.name} ({resource.connections[0].address})" == serverName:
            print(f"Attempting to connect to server {serverName}")
            server = resource.connect()
            break

    if server is None:
        print("Server not found")
        return jsonify(error="Server not found"), 404

    libraries = [section.title for section in server.library.sections()]

    print(f"Libraries: {libraries}")

    plex_data.set_libraries(libraries)
    
    # Store the libraries in a global variable
    global stored_libraries
    stored_libraries[serverName] = libraries

    # Return the JSON response
    return jsonify(libraries=libraries, token=token)


@app.route('/save_plex_data', methods=['POST'])
def save_plex_data():
    try:
        # Extract data from request
        data = request.get_json()
        selectedServer = data.get('server')
        token = data.get('token')

        # Create a new PlexAccountData object
        plex_data = PlexAccountData()

        # Update the PlexAccountData object with the selected server information
        plex_data.set_selected_server(selectedServer)
        plex_data.set_token(token)

        # Fetch the libraries for the selected server
        fetch_libraries(selectedServer)

        # Get the libraries from the response
        libraries = stored_libraries

        # Update the PlexAccountData object with the libraries
        plex_data.set_libraries(libraries)

        # Store the PlexAccountData object in the dictionary with the server name as the key
        stored_plexAccounts[selectedServer] = plex_data

        # Set the libraries to currentActiveServer.libraries
        currentActiveServer.libraries = libraries

        # Set the selected_server and token when saving
        currentActiveServer.selected_server = selectedServer
        currentActiveServer.token = token

        print('currentActiveServer:', currentActiveServer)  # Remove the conversion to string

        return jsonify(result='Success')
    except Exception as e:
        return jsonify(result='Error', error=str(e))

@app.route('/get_active_server', methods=['GET'])
def get_active_server():
    try:
        global currentActiveServer
        if currentActiveServer:
            return jsonify(server=currentActiveServer.selected_server, token=currentActiveServer.token)
        else:
            return jsonify(error='No active server found')
    except Exception as e:
        return jsonify(error=str(e))

def get_movies_from_plex_library(token, server_name, library_name):
    try:
        # Connect to the Plex server using the token
        server = PlexServer(token=token)
        
        # Get the library by name
        library = server.library.section(library_name)
        
        # Retrieve all movies from the library
        movies = library.search(libtype='movie')
        
        # Extract movie titles
        movie_titles = [movie.title for movie in movies]
        
        return movie_titles
    except Exception as e:
        print('Error:', str(e))
        return []

stored_libraries = {} #dictionary to get the libraries later. Key is the Plex serverName
stored_plexAccounts = {}
tokens = {}
# Create an array to store PlexAccountData objects
plex_data_array = []
# Create an instance of PlexAccountData as a global variable
currentActiveServer = PlexAccountData()

if __name__ == '__main__':
    app.run(debug=True)