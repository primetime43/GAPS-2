import { getContextPath, getOwnedMoviesForTable } from '../modules/common.min.js';

let libraryTitle;
let noMovieContainer;
let movieContainer;
let movieSearchingContainer;
let plexServers;
let moviesTable;

function switchPlexLibrary(machineIdentifier, key) {
  const plexServer = plexServers[machineIdentifier];
  const plexLibrary = plexServer.plexLibraries.find((tempPlexLibrary) => tempPlexLibrary.key === parseInt(key, 10));
  libraryTitle.text(`${plexServer.friendlyName} - ${plexLibrary.title}`);
  libraryTitle.attr('data-machineIdentifier', machineIdentifier);
  libraryTitle.attr('data-key', key);

  moviesTable.data().clear();
  moviesTable.rows().invalidate().draw();

  // Make an AJAX request to fetch the libraries for the selected server
  $.get(`/fetch_libraries/${machineIdentifier}/${key}`, function(response) {
    // Update the libraries in the HTML
    $('#librariesContainer').html(response);

    // Get the updated elements after updating the libraries
    noMovieContainer = $('#noMovieContainer');
    movieContainer = $('#movieContainer');
    movieSearchingContainer = $('#movieSearchingContainer');
    moviesTable = $('#movies').DataTable({
      // DataTable initialization and configuration
      // ...
    });
  });
}

function searchForMovies() {
  movieSearchingContainer.show();
  noMovieContainer.css({ display: 'none' });
  moviesTable.data().clear();
  moviesTable.rows().invalidate().draw();

  const machineIdentifier = libraryTitle.attr('data-machineIdentifier');
  const key = libraryTitle.attr('data-key');

  $.ajax({
    type: 'GET',
    url: getContextPath(`/plex/movies/${machineIdentifier}/${key}`),
    contentType: 'application/json',
    success(data) {
      movieSearchingContainer.css({ display: 'none' });
      moviesTable.rows.add(data).draw();
      movieContainer.show(100);
    },
  });
}

jQuery(($) => {
  libraryTitle = $('#libraryTitle');
  noMovieContainer = $('#noMovieContainer');
  movieContainer = $('#movieContainer');
  movieSearchingContainer = $('#movieSearchingContainer');
  plexServers = JSON.parse($('#plexServers').val());
  const plexServer = JSON.parse($('#plexServer').val());
  const key = $('#libraryKey').val();

  moviesTable = $('#movies').DataTable({
    deferRender: true,
    ordering: false,
    columns: [
      { data: 'imdbId' },
      { data: 'name' },
      { data: 'year' },
      { data: 'language' },
      { data: 'overview' },
    ],
    columnDefs: [
      {
        targets: [0],
        type: 'html',
        searchable: false,
        render(data, type, row) {
          if (type === 'display') {
            const plexServerData = Object.assign(row);
            plexServerData.address = plexServer.address;
            plexServerData.port = plexServer.port;
            plexServerData.plexToken = plexServer.plexToken;

            const plexServerCard = $('#movieCard').html();
            const theTemplate = Handlebars.compile(plexServerCard);
            return theTemplate(plexServerData);
          }
          return '';
        },
      },
      {
        targets: [1, 2, 3, 4],
        visible: false,
      },
    ],
  });

  getOwnedMoviesForTable(`/libraries/${plexServer.machineIdentifier}/${key}`, movieContainer, noMovieContainer, moviesTable);

  // Exposing function for onClick()
  window.searchForMovies = searchForMovies;
  window.switchPlexLibrary = switchPlexLibrary;
});
