import json, webbrowser, requests
from flask import Flask, render_template, request, jsonify
from plexapi.myplex import MyPlexPinLogin, MyPlexAccount, PlexServer
from PlexAccountData import PlexAccountData

app = Flask(__name__)

# Configuration
app.config.from_pyfile('config.py')  # Assuming you have a config.py file

@app.context_processor
def inject_page_display_names():
    return dict(page_display_names=app.config['PAGE_DISPLAY_NAMES'])

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
    return render_template('error.html', error=app.config['RESPONSE_MESSAGES']['data_not_found'])

@app.route('/recommended')
def recommended():
    return render_template('recommended.html')

@app.route('/updates')
def updates():
    return render_template('updates.html')

@app.route('/testTmdbKey', methods=['POST'])
def test_tmdb_key():
    api_key = request.json.get('api_key')  # Get the API key from the request body
    url = f"https://api.themoviedb.org/3/configuration?api_key={api_key}"  # Include the API key in the URL

    response = requests.get(url)

    if response.status_code == 200:
        return {'message': app.config['RESPONSE_MESSAGES']['api_key_success']}
    else:
        return {'message': app.config['RESPONSE_MESSAGES']['api_key_failure'] + str(response.status_code)}, response.status_code

@app.route('/saveTmdbKey', methods=['POST'])
def save_tmdb_key():
    # Extract data from request
    data = request.get_json()

    # Test the API key
    api_key = data.get('key')
    url = f"https://api.themoviedb.org/3/configuration?api_key={api_key}"
    response = requests.get(url)

    if response.status_code == 200:
        # If the API key is valid, save it and return a success message
        return {'message': app.config['RESPONSE_MESSAGES']['api_key_saved']}
    else:
        # If the API key is not valid, return an error message
        return {'message': app.config['RESPONSE_MESSAGES']['api_key_failure'] + str(response.status_code)}, response.status_code

@app.route('/fetch_servers', methods=['POST'])
def fetch_servers():
    if globalPin.checkLogin():  # Assumes that checkLogin() returns True if the user is authenticated
        plex_data = PlexAccountData()  # Create a new PlexAccountData object
        plex_account = MyPlexAccount(token=globalPin.token)
        username = plex_account.username  # Get the username
        resources = [resource for resource in plex_account.resources() if resource.owned and resource.connections]
        servers = [f"{resource.name} ({resource.connections[0].address})" for resource in resources if resource.connections]

        # Store tokens in the dictionary
        for resource in resources:
            if resource.connections:
                server_name = f"{resource.name} ({resource.connections[0].address})"
                tokens[server_name] = globalPin.token
                plex_data.add_token(server_name, globalPin.token)

        plex_data.set_servers(servers)

        # Store the PlexAccountData object in the array
        plex_data_array.append(plex_data)

        # Return the JSON response with servers and token
        return jsonify(servers=servers, token=globalPin.token)
    else:
        return jsonify({'message': 'User is not authenticated', 'servers': [], 'token': None})

globalPin = None
@app.route('/authenticate_plex_acc', methods=['POST'])
def authenticate_plex_acc():
    global globalPin
    globalPin = MyPlexPinLogin(oauth=True)
    oauth_url = globalPin.oauthUrl()
    return jsonify({'oauth_url': oauth_url})

@app.route('/fetch_libraries/<serverName>')
def fetch_libraries(serverName):
    # Find the PlexAccountData object with the matching serverName
    plex_data = next((data for data in plex_data_array if serverName in data.tokens), None)

    if plex_data is None:
        #print("PlexAccountData not found")
        return {'message': app.config['RESPONSE_MESSAGES']['plex_data_not_found']}

    token = plex_data.tokens.get(serverName)

    #print("Token: " + token)
    plex_account = MyPlexAccount(token=token)

    server = None
    for resource in plex_account.resources():
        if f"{resource.name} ({resource.connections[0].address})" == serverName:
            #print(f"Attempting to connect to server {serverName}")
            server = resource.connect()
            break

    if server is None:
        #print("Server not found")
        return jsonify(error=app.config['RESPONSE_MESSAGES']['server_not_found']), 404

    libraries = [section.title for section in server.library.sections()]

    #print(f"Libraries: {libraries}")

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
        libraries = data.get('libraries')

        # Create a new PlexAccountData object
        plex_data = PlexAccountData()

        # Update the PlexAccountData object with the selected server information
        plex_data.set_selected_server(selectedServer)
        plex_data.set_token(token)

        # Fetch the libraries for the selected server
        fetch_libraries(selectedServer)

        # Get the libraries from the response
        libraries = stored_libraries #this makes the key for libraries be the server name: stored_libraries[serverName] = libraries

        # Update the PlexAccountData object with the libraries
        plex_data.set_libraries(libraries)

        # Store the PlexAccountData object in the dictionary with the server name as the key
        stored_plexAccounts[selectedServer] = plex_data

        # Set the selected_server and token when saving
        currentActiveServer.selected_server = selectedServer
        currentActiveServer.token = token
        currentActiveServer.libraries = libraries

        #print('Calling get_movies_from_plex_library')
        #get_movies_from_plex_library()

        return jsonify(result='Success')
    except Exception as e:
        return jsonify(result='Error', error=str(e))

@app.route('/get_active_server', methods=['GET'])
def get_active_server():
    try:
        global currentActiveServer
        #print(f"get_active_server libraries: {currentActiveServer.libraries}")
        if currentActiveServer:
            return jsonify(server=currentActiveServer.selected_server, token=currentActiveServer.token, libraries=currentActiveServer.libraries)
        else:
            return jsonify(error='No active server found')
    except Exception as e:
        return jsonify(error=str(e))

@app.route('/get_movies', methods=['GET'])
def get_movies_from_plex_library():
    global moviesFromSelectedLibrary  # Declare this variable as global

    try:
        # Retrieve the library name from the query parameter
        library_name = request.args.get('library_name')

        # Check if data for the library already exists in global variable
        if library_name in moviesFromSelectedLibrary:
            return jsonify(movies=moviesFromSelectedLibrary[library_name])

        # Connect to the Plex account using the token
        plex_account = MyPlexAccount(token=currentActiveServer.token)

        # Find the server resource associated with the selected server
        server_resource = None
        resources = [resource for resource in plex_account.resources() if resource.owned]
        for resource in resources:
            if f"{resource.name} ({resource.connections[0].address})" == currentActiveServer.selected_server:
                #print(f"resource: {resource.name} ({resource.connections[0].address}) == {currentActiveServer.selected_server}")
                server_resource = resource
                break

        if server_resource is None:
            return jsonify(error=app.config['RESPONSE_MESSAGES']['server_resource_not_found'])

        # Connect to the server using the server resource
        server = server_resource.connect()

        # Get the library by name
        library = server.library.section(library_name)

        # Retrieve all movies from the library
        movies = library.search(libtype='movie')

        # Extract movie data
        movie_data = []
        tmdb_ids = []
        for movie in movies:
            imdb_id = None
            tmdb_id = None
            tvdb_id = None

            for guid in movie.guids:
                if 'imdb' in guid.id:
                    imdb_id = guid.id.replace('imdb://', '')
                elif 'tmdb' in guid.id:
                    tmdb_id = int(guid.id.replace('tmdb://', ''))
                elif 'tvdb' in guid.id:
                    tvdb_id = guid.id.replace('tvdb://', '')

            movie_info = {
                'name': movie.title,
                'year': movie.year,
                'overview': movie.summary,
                'posterUrl': movie.posterUrl,
                'imdbId': imdb_id,
                'tmdbId': tmdb_id,
                'tvdbId': tvdb_id
            }
            movie_data.append(movie_info)
            if tmdb_id:
                tmdb_ids.append(tmdb_id)

        # store the data globally so if the html page is refreshed, 
        # it doesnt have to make another request to get the data 
        # (do this instead of storing locally as thats limited to 5 MB)
        moviesFromSelectedLibrary[library_name] = {
            'movies': movie_data,
            'tmdbIds': tmdb_ids
        }

        return jsonify(movies=movie_data)

    except Exception as e:
        return jsonify(error=str(e))

# Uses themoviedb api to get recommended movies, removes movies from the recommended list already in the library
@app.route('/recommendations', methods=['GET'])
def get_recommendations():
    global global_recommendations
    movie_id = request.args.get('movieId', default = 11, type = int) 
    api_key = request.args.get('apiKey', default = "", type = str)
    library_name = request.args.get('libraryName')  # Get the library name from the request
    showExistingMovies = request.args.get('showExisting')

    url = f"{app.config['TMDB_BASE_URL']}/movie/{movie_id}/recommendations"
    params = {"api_key": api_key}
    
    response = requests.get(url, params=params)

    if response.status_code != 200:
        return {'message': 'API request failed with status code ' + str(response.status_code)}, response.status_code

    data = response.json()

    if not showExistingMovies: 
        # Get the list of TMDB IDs from the current library
        library = moviesFromSelectedLibrary.get(library_name, {'tmdbIds': []})
        existing_tmdb_ids = set(library['tmdbIds'])
    else:
        existing_tmdb_ids = set()  # Set to empty set

    base_image_url = "https://image.tmdb.org/t/p/w500"
    """ recommendations = [{'id': i['id'],
                         'title': i['title'],
                           'release_date': i['release_date'],
                             'overview': i['overview'],
                               'poster_path': base_image_url + i['poster_path']} for i in data['results']] """
    recommendations = [{'tmdbId': i['id'], 
                        'name': i['title'], 
                        'year': i['release_date'][:4], 
                        'posterUrl': base_image_url + i['poster_path'],
                        'overview': i['overview']} 
                        for i in data['results'] if i['id'] not in existing_tmdb_ids]
    
    global_recommendations = recommendations

    return jsonify(recommendations)

# Retrieve the recommended movies from python storage to use on the recommended page
@app.route("/get_recommendated_movies", methods=["GET"])
def get_recommendated_movies():
    return jsonify(global_recommendations)

stored_libraries = {} #dictionary to get the libraries later. Key is the Plex serverName
stored_plexAccounts = {}
tokens = {}
# Create an array to store PlexAccountData objects
plex_data_array = []
# Create an instance of PlexAccountData as a global variable
currentActiveServer = PlexAccountData()
moviesFromSelectedLibrary = {}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)