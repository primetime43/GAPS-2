/* global Handlebars */

/* eslint no-undef: "error" */

import { getContextPath } from './common.min.js';

export function openPlexLibraryConfigurationModel(title, machineIdentifier, key) {
  const obj = {
    title,
    machineIdentifier,
    key,
  };
  const plexLibraryModalTemplate = $('#plexLibraryModalTemplate').html();
  const theTemplate = Handlebars.compile(plexLibraryModalTemplate);
  const theCompiledHtml = theTemplate(obj);
  const plexLibraryConfigurationModal = document.getElementById('plexLibraryConfigurationModal');
  plexLibraryConfigurationModal.innerHTML = theCompiledHtml;
  $('#plexLibraryConfigurationModal').modal('show');
}

export async function savePlexLibraryConfiguration(machineIdentifier, key) {
  const obj = {
    machineIdentifier,
    key,
    enabled: document.getElementById('libraryEnabled').value,
    defaultLibrary: document.getElementById('defaultLibrary').value,
  };

  const response = await fetch(getContextPath('/configuration/update/plex/library'), {
    method: 'put',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(obj),
  });
  await response.json();
  /* const put = await response.json(); */
  /* if (put.code && put.code === Payload.SCHEDULE_UPDATED) {
      hideAllAlertsAndSpinners();
      document.getElementById('scheduleSaveSuccess').style.display = 'block';
  } else {
      hideAllAlertsAndSpinners();
      document.getElementById('scheduleSaveError').style.display = 'block';
  } */
}
