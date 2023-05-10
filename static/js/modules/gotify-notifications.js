/*
 * Copyright 2020 Jason H House
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 */

import getNotificationTypes from './notification-types.min.js';
import Payload from './payload.min.js';
import hideAllAlertsAndSpinners from './alerts-manager.min.js';
import { getContextPath } from './common.min.js';

export async function testGotifyNotifications() {
  hideAllAlertsAndSpinners();
  document.getElementById('gotifySpinner').style.display = 'block';

  const response = await fetch(getContextPath('/notifications/test/3'), {
    method: 'put',
  });
  const put = await response.json();
  if (put.code && put.code === Payload.NOTIFICATION_TEST_SUCCEEDED) {
    hideAllAlertsAndSpinners();
    document.getElementById('gotifyTestSuccess').style.display = 'block';
  } else {
    hideAllAlertsAndSpinners();
    document.getElementById('gotifyTestError').style.display = 'block';
  }
}

export async function saveGotifyNotifications() {
  hideAllAlertsAndSpinners();

  const body = {};
  body.address = document.getElementById('gotifyAddress').value;
  body.token = document.getElementById('gotifyToken').value;
  body.enabled = document.getElementById('gotifyEnabled').value;
  body.notificationTypes = getNotificationTypes(
    document.getElementById('gotifyTmdbApiConnectionNotification').checked,
    document.getElementById('gotifyPlexServerConnectionNotification').checked,
    document.getElementById('gotifyPlexMetadataUpdateNotification').checked,
    document.getElementById('gotifyPlexLibraryUpdateNotification').checked,
    document.getElementById('gotifyGapsMissingCollectionsNotification').checked,
  );

  const response = await fetch(getContextPath('/notifications/gotify'), {
    method: 'put',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const put = await response.json();
  if (put.code && put.code === Payload.GOTIFY_NOTIFICATION_UPDATE_SUCCEEDED) {
    hideAllAlertsAndSpinners();
    document.getElementById('gotifySaveSuccess').style.display = 'block';
  } else {
    hideAllAlertsAndSpinners();
    document.getElementById('gotifySaveError').style.display = 'block';
  }
}
