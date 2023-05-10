from flask import Flask, render_template, request, jsonify

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

if __name__ == '__main__':
    app.run(debug=True)